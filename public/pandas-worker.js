// Serialized requests keep pandas versions and IndexedDB commits consistent.
let engine;
let initialized;
let queue = Promise.resolve();
const phase = value => self.postMessage({ phase: value });
const warnOriginal = console.warn.bind(console);
let failRuntime;
console.warn = (...messages) => {
  warnOriginal(...messages);
  const diagnostic=messages.map(String).join(' ');
  self.postMessage({diagnostic});
  if(diagnostic.includes('wasm instantiation failed')) failRuntime?.(new Error('Python engine could not load'));
};
async function start() {
  phase('runtime');
  const base = new URL('./', self.location.href);
  const { loadPyodide } = await import(new URL('pyodide/pyodide.mjs', base).href);
  const fetchOriginal = self.fetch.bind(self);
  const wasmURL = new URL('pyodide/pyodide.asm.wasm', base).href;
  if (typeof DecompressionStream !== 'undefined') {
    // GitHub Pages does not consistently compress WASM. Decompress just this
    // self-hosted resource while preserving Pyodide's own instantiation glue.
    self.fetch = async (input,init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== wasmURL) return fetchOriginal(input,init);
      const response = await fetchOriginal(wasmURL+'.gz',init);
      if (!response.ok) throw new Error('Missing compressed Python engine');
      const body=response.headers.get('Content-Encoding')?.includes('gzip')
        ? response.body : response.body.pipeThrough(new DecompressionStream('gzip'));
      return new Response(body,
        {headers:{'Content-Type':'application/wasm'}});
    };
  }
  try {
    const failed = new Promise((_,reject) => {failRuntime=reject;});
    engine = await Promise.race([loadPyodide({indexURL:new URL('pyodide/',base).href}),failed]);
  } finally { self.fetch = fetchOriginal; failRuntime=undefined; }
  phase('packages');
  await engine.loadPackage(['pandas', 'pydantic']);
  const wheels = await (await fetch(new URL('pyodide/extra-wheels.json', base))).json();
  const sitePackages = engine.runPython("import sysconfig; sysconfig.get_path('purelib')");
  for (const name of wheels) {
    const response = await fetch(new URL('pyodide/' + name, base));
    if (!response.ok) throw new Error('Missing Excel support');
    engine.unpackArchive(await response.arrayBuffer(), 'zip', {extractDir:sitePackages});
  }
  const files = await (await fetch(new URL('browser-python/manifest.json', base))).json();
  engine.FS.mkdirTree('/app/backend');
  await Promise.all(files.map(async name => {
    const response = await fetch(new URL('browser-python/backend/' + name, base));
    if (!response.ok) throw new Error('Missing Python source');
    engine.FS.writeFile('/app/backend/' + name, await response.text());
  }));
  phase('storage');
  engine.FS.mkdirTree('/app/data');
  engine.FS.mount(engine.FS.filesystems.IDBFS, {}, '/app/data');
  await sync(true);
  await engine.runPythonAsync("import sys, os, json\nsys.path.insert(0, '/app')\nos.environ['PANDAS_LAB_DATA_DIR'] = '/app/data'\nfrom backend.main import app\n");
  phase('ready');
}
function sync(populate) { return new Promise((resolve, reject) => engine.FS.syncfs(populate, error => error ? reject(error) : resolve())); }
self.onmessage = ({ data }) => {
  queue = queue.catch(() => {}).then(async () => {
    try {
      initialized ??= start();
      await initialized;
      engine.globals.set('_request_json', JSON.stringify(data.request));
      const result = JSON.parse(await engine.runPythonAsync('await app.dispatch(json.loads(_request_json))'));
      if (result.status < 400 && (data.request.method === 'POST' || data.request.url === '/workspace/bootstrap')) await sync(false);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      console.error(error);
      self.postMessage({ id: data.id, result: { status: 500, error: engine ? 'BROWSER_ENGINE_ERROR' : 'BROWSER_ENGINE_LOAD_FAILED' } });
    }
  });
};
