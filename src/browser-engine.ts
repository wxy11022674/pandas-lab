export const browserMode = import.meta.env.VITE_BROWSER_PANDAS === '1';
export type EngineReply = {status:number;data?:unknown;error?:string;binary?:string;mediaType?:string;filename?:string};
let worker: Worker | undefined;
let serial = 0;
const pending = new Map<number,{resolve:(value:EngineReply)=>void;reject:(error:Error)=>void}>();
export async function browserRequest(url:string, body?:unknown):Promise<EngineReply> {
  if (!worker) {
    worker = new Worker(`${import.meta.env.BASE_URL}pandas-worker.js`, {type:'module'});
    worker.onmessage = ({data}) => {
      if(data.diagnostic){console.warn(data.diagnostic);return;}
      if (data.phase) { window.dispatchEvent(new CustomEvent('pandas-engine-phase',{detail:data.phase})); return; }
      pending.get(data.id)?.resolve(data.result); pending.delete(data.id);
    };
    worker.onerror = () => { for(const request of pending.values()) request.reject(new Error('BROWSER_ENGINE_LOAD_FAILED')); pending.clear(); worker?.terminate(); worker=undefined; };
  }
  const request:any = {url,method:body===undefined?'GET':'POST',body};
  if(body instanceof FormData) {
    request.body=undefined; request.form={};
    for(const [key,value] of body.entries()) {
      if(value instanceof File) {
        if(value.size>10*1024*1024) return {status:400,error:'FILE_TOO_LARGE'};
        const bytes=new Uint8Array(await value.arrayBuffer()); let binary='';
        for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        request.file={filename:value.name,data:btoa(binary)};
      } else request.form[key]=value;
    }
  }
  const id=++serial;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker!.postMessage({id,request});});
}
