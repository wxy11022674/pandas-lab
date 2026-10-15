import type {Condition,DataVersion,Lang} from './workbench-model';

export function describeCondition(c:Condition,field:(s:string)=>string,lang:Lang){
 const operators:Record<string,[string,string]>={eq:['等于','equals'],ne:['不等于','does not equal'],gt:['大于','greater than'],gte:['大于等于','at least'],lt:['小于','less than'],lte:['小于等于','at most'],contains:['包含','contains'],in:['属于','is in'],is_null:['为空','is blank'],not_null:['不为空','is not blank']};
 const operator=operators[c.operator]?.[lang==='zh'?0:1]||c.operator;
 return `${field(c.column)} ${operator}${['is_null','not_null'].includes(c.operator)?'':` ${String(c.value??'')}`}`;
}

export function validFilter(p:{conditions?:Condition[];logic?:string},v:DataVersion){
 return !!p.conditions?.length&&p.conditions.every(c=>{
  const column=v.columns.find(x=>x.name===c.column);
  if(!column)return false;
  if(['is_null','not_null'].includes(c.operator))return true;
  if(c.value===null||c.value===undefined||String(c.value).trim()==='')return false;
  return column.kind!=='numeric'||c.operator==='contains'||c.operator==='in'||Number.isFinite(Number(c.value));
 });
}

export default function FilterFeedback({v,lang,field,onEdit,onUndo}:{v:DataVersion;lang:Lang;field:(s:string)=>string;onEdit:()=>void;onUndo:()=>void}){
 const t=(z:string,e:string)=>lang==='zh'?z:e;
 const steps=v.history.map((step,index)=>({step,index})).filter(({step})=>step.operation?.type==='filter_multi');
 if(!steps.length)return null;
 const latest=v.operation?.type==='filter_multi';
 return <section className="applied-filter-summary" aria-label={t('已应用的筛选','Applied filters')}>
  <div className="filter-summary-heading"><strong>{latest?t('筛选已生效','Filter applied'):t('已应用的筛选条件','Applied filter conditions')}</strong><span>{t(`当前表格 ${v.rows} 行`,`Current table: ${v.rows} rows`)}</span></div>
  {steps.map(({step,index})=>{const p=step.operation!.params as {logic:string;conditions:Condition[]};const before=v.history[index-1]?.rows??step.rows;return <div className="filter-summary-step" key={step.id}><p>{p.conditions.map(c=>describeCondition(c,field,lang)).join(p.logic==='or'?t('，或者 ',' OR '):t('，并且 ',' AND '))}</p><span>{t(`筛选前 ${before} 行 → 保留 ${step.rows} 行，排除 ${before-step.rows} 行`,`Before: ${before} rows → kept ${step.rows}, excluded ${before-step.rows}`)}</span>{before===step.rows&&<small>{t('所有记录都符合条件，所以行数没有变化。','Every record matches, so the row count is unchanged.')}</small>}{step.rows===0&&<small>{t('没有记录符合这组条件。可以修改条件，或撤销筛选恢复数据。','No records match. Edit the conditions or undo the filter to restore the data.')}</small>}</div>;})}
  {latest&&<div className="filter-summary-actions"><button className="wb-btn" onClick={onEdit}>{t('修改这次筛选','Edit this filter')}</button><button className="wb-btn" onClick={onUndo}>{t('撤销这次筛选','Undo this filter')}</button></div>}
 </section>;
}
