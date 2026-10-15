import {useCallback,useEffect,useMemo,useRef} from 'react';
import {GraphicWalker,type IDataQueryPayload,type IGWHandler,type IMutField,type VizSpecStore} from '@kanaries/graphic-walker';
import '@kanaries/graphic-walker/dist/style.css';
import {api} from './api';
import type {DataVersion,Lang} from './workbench-model';
export default function Walker({v,lang,field}:{v:DataVersion;lang:Lang;field:(s:string)=>string}) {
 const ref=useRef<IGWHandler>(null);
 const storeRef=useRef<VizSpecStore>(null);
 const fields=useMemo<IMutField[]>(()=>v.columns.map(c=>({fid:c.name,name:field(c.name),semanticType:c.kind==='numeric'?'quantitative':c.kind==='date'?'temporal':'nominal',analyticType:c.kind==='numeric'?'measure':'dimension'})),[v.id,lang]);
 const computation=useCallback((payload:IDataQueryPayload)=>api<Record<string,any>[]>(`/versions/${v.id}/walker`,payload),[v.id]);
 useEffect(()=>{
  const store=storeRef.current;if(!store)return;
  const labels:Record<string,string>={gw_count_fid:lang==='zh'?'行数':'Row count',gw_mea_key_fid:lang==='zh'?'度量名称':'Measure names',gw_mea_val_fid:lang==='zh'?'度量值':'Measure values',...Object.fromEntries(fields.map(f=>[f.fid,f.name||f.fid]))};
  for(const channel of ['dimensions','measures'] as const){store.currentEncodings[channel].forEach((f,index)=>{if(labels[f.fid]&&f.name!==labels[f.fid])store.renameFieldInChart(channel,index,labels[f.fid]);});}
  store.vizList.forEach((chart,index)=>{if(/^(Chart |图表 )\d+$/.test(chart.name||''))store.setVisName(index,`${lang==='zh'?'图表':'Chart'} ${index+1}`);});
 },[fields,lang]);
 return <div className="walker-panel"><div className="walker-intro"><strong>{lang==='zh'?'拖字段到行、列、颜色或筛选区域':'Drag fields to rows, columns, color or filters'}</strong><span>{lang==='zh'?'统计由本地 pandas 计算。新增计算列请使用顶部“计算”；窄窗口可横向滚动。':'Statistics run in local pandas. Create fields in Calculate; scroll horizontally in narrow windows.'}</span></div><div className="walker-editor"><GraphicWalker ref={ref} storeRef={storeRef} fields={fields} computation={computation} i18nLang={lang==='zh'?'zh-CN':'en-US'} appearance="light" keepAlive={`pandas-${v.id}`} hideSegmentNav experimentalFeatures={{computedField:false}} /></div></div>;
}

