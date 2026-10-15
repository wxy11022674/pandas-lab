// Execute the real WebAssembly Python interpreter, without a web server.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {loadPyodide} from 'pyodide';
import {gunzipSync} from 'node:zlib';
const wasmBytes=gunzipSync(await readFile('public/pyodide/pyodide.asm.wasm.gz'));
assert.deepEqual(wasmBytes,await readFile('public/pyodide/pyodide.asm.wasm'));
const py = await loadPyodide({indexURL:path.resolve('public/pyodide')+path.sep});
await py.loadPackage(['pandas','pydantic']);
const sitePackages=py.runPython("import sysconfig; sysconfig.get_path('purelib')");
for(const name of JSON.parse(await readFile('public/pyodide/extra-wheels.json','utf8'))){
  py.unpackArchive(new Uint8Array(await readFile('public/pyodide/'+name)), 'zip', {extractDir:sitePackages});
}
py.FS.mkdirTree('/app/backend');
for(const name of JSON.parse(await readFile('public/browser-python/manifest.json','utf8'))){
  py.FS.writeFile('/app/backend/'+name,await readFile('public/browser-python/backend/'+name,'utf8'));
}
await py.runPythonAsync("import sys, os, json\nsys.path.insert(0, '/app')\nos.environ['PANDAS_LAB_DATA_DIR']='/app/data'\nfrom backend.main import app\n");
let calls=0;
async function request(url,body,extra={}){
  py.globals.set('_request',JSON.stringify({url,method:body===undefined?'GET':'POST',body,...extra}));
  const response=JSON.parse(await py.runPythonAsync('await app.dispatch(json.loads(_request))'));
  assert.equal(response.status,200,`${url}: ${JSON.stringify(response)}`);calls++;
  return response.binary?response:response.data;
}
const pack=await request('/workspace/bootstrap');
assert.deepEqual((await request('/workspace/bootstrap')).examples,pack.examples);
const raw=await request('/versions/'+pack.examples.energy_2025);
assert.deepEqual([raw.rows,raw.duplicates,raw.total_missing],[99,3,15]);
const ready=await request('/versions/'+pack.default_version);
assert.deepEqual([ready.rows,ready.total_missing],[96,0]);
const operate=(id,type,params)=>request(`/versions/${id}/operations`,{type,params});
for(const [value,count] of [[40000,32],[1000000,0]]){
  const v=await operate(raw.id,'filter_multi',{logic:'and',conditions:[{column:'electricity_kwh',operator:'gt',value}]});
  assert.equal(v.rows,count);
  assert.equal((await request(`/versions/${v.id}/query`,{})).total,count);
}
let v=await operate(raw.id,'deduplicate',{columns:[]});
for(const column of ['electricity_kwh','water_m3','temperature_c','occupancy_pct']) v=await operate(v.id,'fill_missing',{column,method:'median'});
v=await operate(v.id,'text',{column:'meter_status',method:'strip'});
v=await operate(v.id,'merge',{right_version:pack.examples.buildings,left_on:'building_id',right_on:'building_id',how:'left',validate:'many_to_one'});
for(const [name,right] of [['energy_per_m2','area_m2'],['energy_per_person','capacity']])v=await operate(v.id,'calculate',{name,left:'electricity_kwh',right,operator:'divide'});
assert.equal(v.rows,96);assert.equal(v.total_missing,0);
assert.equal((await request(`/versions/${v.id}/export.csv`)).binary,(await request(`/versions/${ready.id}/export.csv`)).binary);
for(const type of ['bar','line','area','scatter','histogram','boxplot']){
  const visual=await request(`/versions/${v.id}/visual`,{type,x:['scatter','histogram','boxplot'].includes(type)?'electricity_kwh':'building_name',y:'water_m3',color:'',aggregate:'sum',bins:12});
  assert.equal(visual.type,type);
}
await request(`/versions/${v.id}/statistics`);
assert.equal((await request(`/versions/${raw.id}/profile?column=electricity_kwh`)).missing,6);
const preview=await request(`/versions/${v.id}/preview`,{type:'rename',params:{column:'building_id',name:'id'}});
assert(preview.columns.some(c=>c.name==='id'));
assert((await request(`/versions/${v.id}`)).columns.some(c=>c.name==='building_id'));
for(const [type,params] of [
 ['sort_multi',{columns:['electricity_kwh'],ascending:false}],
 ['drop_columns',{columns:['meter_status']}],['convert',{column:'electricity_kwh',target:'string'}],
 ['clip',{column:'electricity_kwh',lower:0,upper:50000}],['date_extract',{column:'date',part:'month',name:'month_number'}],
 ['resample',{column:'date',value:'electricity_kwh',rule:'MS',aggregate:'sum'}],
 ['aggregate',{groups:['building_id'],metrics:[{column:'electricity_kwh',aggregate:'sum'}]}],
 ['pivot',{rows:['building_id'],columns:['date'],value:'electricity_kwh',aggregate:'sum'}],
 ['melt',{ids:['building_id'],values:['electricity_kwh','water_m3'],variable:'metric',value_name:'amount'}],
 ['concat',{right_version:ready.id}]
]) await operate(ready.id,type,params);
await request('/compare',{version_id:raw.id,column:'electricity_kwh',aggregate:'mean',a:{type:'fill_missing',params:{column:'electricity_kwh',method:'drop'}},b:{type:'fill_missing',params:{column:'electricity_kwh',method:'median'}}});
const walker=await request(`/versions/${ready.id}/walker`,{workflow:[{type:'view',query:[{op:'aggregate',groupBy:['building_name'],measures:[{field:'electricity_kwh',agg:'sum',asFieldKey:'total'}]}]}]});
assert.equal(walker.length,8);
assert(Math.abs(walker.reduce((s,r)=>s+r.total,0)-3365213.34)<0.001);
for(const [filename,bytes,count] of [['test.csv',Buffer.from('name,amount\na,2\nb,3\n'),2],['test.json',Buffer.from('[{"value":3}]'),1],['campus.xlsx',await readFile('examples/campus/campus-data.xlsx'),99]]){
  const file={filename,data:bytes.toString('base64')};
  if(filename.endsWith('.xlsx'))assert((await request('/upload/sheets',{}, {file})).sheets.length>=5);
  const imported=await request('/upload',{}, {file,form:filename.endsWith('.xlsx')?{sheet:'energy_2025'}:{}});
  assert.equal(imported.rows,count);
}
const recipe=await request(`/versions/${v.id}/recipe.json`);assert(recipe.operations.length>=8);
const code=Buffer.from((await request(`/versions/${v.id}/export.py`)).binary,'base64').toString();
assert(code.includes('import pandas'));
py.globals.set('_code',code);
await py.runPythonAsync("exec(_code, {})\nimport pandas as pd\nfrom backend.main import frame, business\npd.testing.assert_frame_equal(pd.read_csv('processed.csv'), business(frame('"+v.id+"')).reset_index(drop=True), check_dtype=False)");
console.log(`Browser pandas engine verified: ${calls} requests; full cleaning pipeline, filtering, six charts, operations, Excel/CSV/JSON import and reproducible exports.`);
