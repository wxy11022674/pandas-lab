import {CheckCircle2,Info} from 'lucide-react';
import type {DataVersion,Lang} from './workbench-model';

export default function MissingOverview({v,lang,field,onSelect}:{v:DataVersion;lang:Lang;field:(s:string)=>string;onSelect:(column:string)=>void}){
 const t=(z:string,e:string)=>lang==='zh'?z:e;
 const missing=v.columns.reduce((sum,c)=>sum+c.missing,0);
 const affected=v.columns.filter(c=>c.missing>0).length;
 return <section className="missing-overview" aria-label={t('字段缺失值统计','Missing values by field')}>
  <h3>{t('字段缺失值统计','Missing values by field')}</h3>
  <p>{t(`统计每列有多少个未填写的单元格，当前共 ${v.rows} 条记录。`,`Counts blank cells in each field across ${v.rows} records.`)}</p>
  <div className={`missing-summary ${v.rows&&missing===0?'complete':''}`} role="status">
   {v.rows&&missing===0?<CheckCircle2 size={18}/>:<Info size={18}/>}
   <div><strong>{!v.rows?t('当前没有记录','No records in this version'):missing===0?t(`全部 ${v.columns.length} 个字段均无缺失值`,`All ${v.columns.length} fields have no missing values`):t(`${affected} 个字段共有 ${missing} 个缺失单元格`,`${missing} missing cells across ${affected} fields`)}</strong>
   <span>{!v.rows?t('请先调整筛选条件或加载数据，再检查完整性。','Adjust filters or load data before checking completeness.'):missing===0?t('缺失值为 0，表示每条记录都有填写；不表示数据的数值为 0。','Zero missing values means every record has a value; it does not mean the values are zero.'):t('点击有缺失的字段，查看对应记录。','Select a field with missing values to see those records.')}</span></div>
  </div>
  <details open={missing>0}><summary>{t('查看各字段明细','View field details')} · {v.columns.length}</summary>
   <div className="missing-field-list">{v.columns.map(c=><button key={c.name} disabled={!v.rows||c.missing===0} onClick={()=>onSelect(c.name)} title={c.missing?t('查看缺失记录','View missing records'):t('这一列没有缺失值','This field has no missing values')}>
    <span className="missing-field-name">{field(c.name)}</span><span className="missing-counts">{t(`有效 ${v.rows-c.missing} · 缺失 ${c.missing}`,`Present ${v.rows-c.missing} · Missing ${c.missing}`)}</span>
    <span className="missing-track" aria-hidden="true"><i style={{width:`${v.rows?c.missing/v.rows*100:0}%`}}/></span><small>{v.rows?`${(c.missing/v.rows*100).toFixed(1)}% ${t('缺失','missing')}`:'—'}</small>
   </button>)}</div>
  </details>
 </section>;
}
