// Self-host the pinned Python runtime and wheels on GitHub Pages.
import { mkdir, readFile, writeFile, copyFile, readdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const version = '314.0.7';
const target = path.resolve('public/pyodide');
await mkdir(target, { recursive: true });
for (const name of await readdir('node_modules/pyodide')) {
  if (/\.(m?js|wasm|zip|json)$/.test(name)) await copyFile(`node_modules/pyodide/${name}`, path.join(target, name));
}
async function download(url, name, hash) {
  const file = path.join(target, name);
  try { const bytes = await readFile(file); if (!hash || createHash('sha256').update(bytes).digest('hex') === hash) return; } catch {}
  console.log(`Downloading ${name}…`);
  const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`Download failed: ${name} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash && createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Integrity mismatch: ${name}`);
  await writeFile(file, bytes);
  console.log(`Saved ${name}: ${(bytes.length/1048576).toFixed(1)} MB`);
}
const cdn = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;
await download(cdn + 'pyodide-lock.json', 'pyodide-lock.json');
const lock = JSON.parse(await readFile(path.join(target, 'pyodide-lock.json'), 'utf8'));
const needed = new Set();
function include(name) { name=name.toLowerCase().replace(/[_\.]+/g,'-'); if (needed.has(name)) return; needed.add(name); for (const dep of lock.packages[name].depends) include(dep); }
for (const name of ['pandas', 'pydantic']) include(name);
await Promise.all([...needed].map(name => { const p = lock.packages[name]; return download(cdn + p.file_name, p.file_name, p.sha256); }));
const wheels = [];
for (const [name, release] of [['openpyxl', '3.1.5'], ['et-xmlfile', '2.0.0']]) {
  const response = await fetch(`https://pypi.org/pypi/${name}/${release}/json`);
  if (!response.ok) throw new Error(`Missing package metadata: ${name}`);
  const metadata = await response.json();
  const wheel = metadata.urls.find(f => f.filename.endsWith('py3-none-any.whl'));
  if (!wheel) throw new Error(`Missing pure Python wheel: ${name}`);
  await download(wheel.url, wheel.filename, wheel.digests.sha256);
  wheels.push(wheel.filename);
}
await writeFile(path.join(target, 'extra-wheels.json'), JSON.stringify(wheels));
await mkdir('public/browser-python/backend', { recursive: true });
const sources = ['__init__.py', 'main.py', 'advanced.py', 'extended_api.py', 'demo_pack.py', 'browser_transport.py'];
for (const name of sources) await copyFile(`backend/${name}`, `public/browser-python/backend/${name}`);
await writeFile('public/browser-python/manifest.json', JSON.stringify(sources));
await cp('examples', 'public/examples', { recursive: true });
console.log(`Prepared Pyodide ${version}, ${needed.size} packages, Excel support and shared pandas source.`);
