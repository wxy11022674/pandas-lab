import {useState,type AnchorHTMLAttributes} from 'react';
import {browserMode,browserRequest} from './browser-engine';
export default function DownloadLink({href='',children,...props}:AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [busy,setBusy]=useState(false);
  const example=href.startsWith('/api/examples/download/');
  const target=browserMode&&example?`${import.meta.env.BASE_URL}examples/campus/${href.split('/').pop()}`:href;
  return <a {...props} href={target} aria-busy={busy} onClick={async event=>{
    if(!browserMode||example)return;
    event.preventDefault();if(busy)return;setBusy(true);
    try {
      const result=await browserRequest(href.replace(/^\/api/,''));
      if(result.error)throw new Error(result.error);
      const bytes=result.binary?Uint8Array.from(atob(result.binary),c=>c.charCodeAt(0)):JSON.stringify(result.data,null,2);
      const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([bytes],{type:result.mediaType||'application/json'}));
      link.download=result.filename||href.split('/').pop()||'download';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    }catch(error){window.dispatchEvent(new CustomEvent('pandas-download-error',{detail:error instanceof Error?error.message:'BROWSER_ENGINE_ERROR'}));}
    finally{setBusy(false);}
  }}>{children}</a>;
}
