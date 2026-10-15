import {BarChart3,LineChart,AreaChart,ScatterChart,BarChartHorizontal,BoxSelect,LoaderCircle,Play,SlidersHorizontal} from 'lucide-react';
import type {DataVersion,Lang} from './workbench-model';
import {aggNames} from './workbench-model';

export type ChartConfig={type:string;x:string;y:string;color:string;aggregate:string;bins:number};
const chartTypes=[
 ['bar','柱状图','Bar',BarChart3],['line','折线图','Line',LineChart],
 ['area','面积图','Area',AreaChart],['scatter','散点图','Scatter',ScatterChart],
 ['histogram','直方图','Histogram',BarChartHorizontal],['boxplot','箱线图','Box plot',BoxSelect],
] as const;

export default function ChartControls({config,v,lang,field,onChange,onGenerate,loading,auto,onAuto,dirty,onExport}:{
 config:ChartConfig;v:DataVersion;lang:Lang;field:(s:string)=>string;
 onChange:(config:ChartConfig)=>void;onGenerate:()=>void;loading:boolean;auto:boolean;
 onAuto:(value:boolean)=>void;dirty:boolean;onExport:()=>void;
}){
 const t=(z:string,e:string)=>lang==='zh'?z:e;
 const numeric=v.columns.filter(c=>c.kind==='numeric');
 const set=(key:string,value:string|number)=>onChange({...config,[key]:value});
 return <section className="inline-settings inline-chart" aria-label={t('图表设置','Chart settings')}>
  <div className="side-heading"><SlidersHorizontal size={16}/><strong>{t('图表设置','Chart settings')}</strong><span className="control-status">{loading?t('计算中','Computing'):dirty?t('待更新','Pending'):t('已就绪','Ready')}</span></div>
  <div className="chart-settings">
   <div className="chart-type-picker" role="group" aria-label={t('图表类型','Chart type')}>
    {chartTypes.map(([type,z,e,Icon])=><button key={type} type="button" aria-pressed={config.type===type} className={config.type===type?'selected':''} onClick={()=>onChange({...config,type,x:['histogram','scatter'].includes(type)?numeric[0]?.name||'':config.x,y:type==='scatter'?numeric[1]?.name||numeric[0]?.name||'':config.y})}><Icon size={21} strokeWidth={1.6}/><span>{t(z,e)}</span></button>)}
   </div>
   <div className="setting-section-label">{t('数据映射','DATA MAPPING')}</div>
   {(['x','y','color'] as const).filter(key=>!(config.type==='histogram'&&key==='y')&&!(key==='color'&&['scatter','histogram','boxplot'].includes(config.type))).map(key=><label className="wb-control mapping-control" key={key}><span><i>{key==='color'?'●':key.toUpperCase()}</i>{key==='x'?config.type==='histogram'?t('数值字段','Numeric field'):t('横轴','X axis'):key==='y'?t('纵轴','Y axis'):t('颜色分组','Color group')}</span><select value={config[key]} onChange={e=>set(key,e.target.value)}>{key!=='x'&&<option value="">{key==='y'?t('记录数量','Row count'):t('不分组','No grouping')}</option>}{v.columns.filter(c=>key==='y'||(key==='x'&&['scatter','histogram'].includes(config.type))?c.kind==='numeric':true).map(c=><option key={c.name} value={c.name}>{field(c.name)}</option>)}</select></label>)}
   {!['scatter','histogram','boxplot'].includes(config.type)&&<label className="wb-control">{t('统计方式','Aggregation')}<select value={config.aggregate} onChange={e=>set('aggregate',e.target.value)}>{['sum','mean','median','count','min','max'].map(k=><option key={k} value={k}>{aggNames[k][lang==='zh'?0:1]}</option>)}</select></label>}
   {config.type==='histogram'&&<label className="wb-control">{t('区间数量','Number of bins')}<input type="number" min={2} max={60} value={config.bins} onChange={e=>set('bins',Number(e.target.value))}/></label>}
   <div className="chart-update-controls"><label className="live-toggle"><input type="checkbox" checked={auto} onChange={e=>onAuto(e.target.checked)}/><span className="toggle-track"/><span>{t('自动更新图表','Auto-update chart')}</span></label><p>{auto?t('调整字段后，图表自动刷新。','The chart updates when fields change.'):t('调整完成后，点击下方按钮更新。','Apply your settings with the button below.')}</p><button className="wb-btn primary full" disabled={loading||!config.x||(['scatter','boxplot'].includes(config.type)&&!config.y)} onClick={onGenerate}>{loading?<LoaderCircle size={15} className="spin"/>:<Play size={14}/>} {loading?t('正在生成','Generating'):t('生成图表','Generate chart')}</button></div>
   <button className="chart-config-export" onClick={onExport}>{t('导出图表配置','Export chart configuration')}</button>
  </div>
 </section>;
}
