// Serialized requests keep pandas versions and IndexedDB commits consistent.
let engine;
let initialized;
let queue = Promise.resolve();
const phase = value => self.postMessage({ phase: value });
async function start() {
  phase('runtime');
  const base = new URL('./', self.location.href);
  const { loadPyodide } = await import(new URL('pyodide/pyodide.mjs', base).href);
  engine = await loadPyodide({ indexURL: new URL('pyodide/', base).href });
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
