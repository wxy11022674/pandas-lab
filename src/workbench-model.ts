import type { Dataset, Version } from './types';
export type Lang = 'zh' | 'en';
export type DataSet = Dataset & {example_key?:string; labels?:string[]};
export type DataVersion = Version & {example_key?:string};
export type Condition = {column:string;operator:string;value?:unknown};
export type Bootstrap = {datasets:DataSet[];default_version:string;examples:Record<string,string>;fields:Record<string,string[]>};
export const names:Record<string,[string,string]> = {
 filter_multi:['组合筛选','Filter rows'],sort_multi:['多列排序','Sort columns'],rename:['重命名列','Rename column'],drop_columns:['删除列','Remove columns'],convert:['转换类型','Convert type'],
 deduplicate:['去除重复行','Remove duplicates'],fill_missing:['填补或删除空值','Handle missing values'],text:['文本整理','Clean text'],clip:['限制数值范围','Clip values'],
 calculate:['新增计算列','Calculated column'],date_extract:['提取日期','Extract date parts'],resample:['按时间汇总','Time aggregation'],
 aggregate:['分组统计','Group statistics'],pivot:['数据透视','Pivot table'],melt:['宽表转长表','Unpivot'],merge:['关联两张表','Join tables'],concat:['追加另一张表','Append rows'],
};
export const aggNames:Record<string,[string,string]>={sum:['求和','Sum'],mean:['平均值','Mean'],median:['中位数','Median'],count:['计数','Count'],min:['最小值','Minimum'],max:['最大值','Maximum'],std:['标准差','Std. deviation'],nunique:['不同值数量','Distinct count']};
export const errors:Record<string,[string,string]>={
 NETWORK_ERROR:['连接失败，请检查本地服务是否正在运行。','Connection failed. Check that the local server is running.'],
 INVALID_VALUE:['参数不正确，请检查字段、类型与输入值。','Check the selected fields, types and input values.'],INVALID_COLUMN:['所选字段不存在或列名不合法。','The selected column is unavailable or invalid.'],
 COLUMN_EXISTS:['新列名为空、重复或与已有列冲突。','The new column name is blank or already exists.'],
 NUMERIC_REQUIRED:['这个操作需要数值列，请选择数字字段或先转换类型。','Choose a numeric column or convert its type first.'],
 ALL_MISSING:['这一列全是空值，无法计算均值或中位数；可以填入固定值。','This column has no values. Use a constant instead of a mean or median.'],
 CONVERSION_FAILED:['有值无法转换。可选择将无法转换的值设为空值并预览。','Some values cannot be converted. Preview with invalid values set to null.'],
 SCHEMA_MISMATCH:['追加的两张表必须具有相同的列名。','Both tables must have the same column names to append.'],
 DUPLICATE_JOIN_KEY:['匹配列存在重复，不能按所选关系关联。请先检查重复键。','Duplicate keys violate the selected relationship. Check the join columns.'],
 NULL_JOIN_KEY:['关联字段有空值，请先处理，避免把缺失标识当作同一对象。','Join keys contain blanks. Handle them before joining.'],
 FILE_TOO_LARGE:['文件超过 10 MB。','The file exceeds 10 MB.'],TOO_MANY_ROWS:['结果超过 50,000 行，请缩小数据范围。','The result exceeds 50,000 rows. Narrow the data.'],TOO_MANY_COLUMNS:['结果超过 100 列，请减少展开类别。','The result exceeds 100 columns. Reduce the categories.'],
 INVALID_CSV:['CSV 格式不正确。','Invalid CSV format.'],INVALID_FILE:['无法读取文件或工作表，请检查文件格式。','Unable to read the file or worksheet.'],ENCODING_ERROR:['无法解码 CSV，可尝试 GB18030 编码。','Cannot decode the CSV. Try GB18030.'],EMPTY_FILE:['文件没有可读取的数据。','The file contains no data.'],RESERVED_COLUMN:['_row_id 是内部保留列名，请修改后导入。','Rename the reserved _row_id column before importing.'],
 NOT_FOUND:['找不到这份数据或版本。','Dataset or version not found.'],INVALID_OPERATION:['不支持这个操作。','Unsupported operation.'],INVALID_AGGREGATE:['请选择有效的统计方式。','Choose a valid aggregation.'],
 UNSUPPORTED_QUERY:['此拖拽查询暂不支持。基础分组、筛选、排序与统计可用；复杂公式请在“计算”中建立字段。','This drag-and-drop query is unsupported. Use basic grouping, filtering, sorting and aggregation; create complex fields in Calculate.'],
};
export function defaults(kind:string,v:DataVersion,selected:string,right:string) {
 const numeric=v.columns.filter(c=>c.kind==='numeric').map(c=>c.name), col=selected||v.columns[0]?.name||'', n=numeric.includes(col)?col:numeric[0]||col;
 const category=v.columns.find(c=>c.kind!=='numeric')?.name||col;
 const all:Record<string,any>={
 filter_multi:{logic:'and',conditions:[{column:col,operator:'eq',value:''}]},sort_multi:{columns:[col],ascending:true},rename:{column:col,name:`${col}_new`},drop_columns:{columns:[col]},convert:{column:col,target:'numeric',errors:'raise'},
 deduplicate:{columns:[]},fill_missing:{column:col,method:v.columns.find(c=>c.name===col)?.kind==='numeric'?'median':'constant',value:''},text:{column:col,method:'strip',find:'',replacement:'',separator:'-',position:0,name:`${col}_part`},clip:{column:n,lower:0,upper:100},
 calculate:{left:n,operator:'divide',right:numeric.find(c=>c!==n)||n,right_kind:'column',constant:1,name:'calculated'},date_extract:{column:v.columns.find(c=>c.kind==='date'||/date|month|日期|月份/i.test(c.name))?.name||col,part:'month',name:'month_number'},
 aggregate:{groups:[category],metrics:[{column:n,aggregate:'sum'}]},pivot:{rows:[category],columns:[v.columns.find(c=>c.name!==category&&c.kind!=='numeric')?.name||''],value:n,aggregate:'sum'},melt:{ids:[category],values:numeric.slice(0,2),variable:'variable',value_name:'value'},
 merge:{right_version:right,left_on:v.columns.find(c=>/id$|编号/.test(c.name))?.name||col,right_on:'',how:'left',validate:'many_to_one'},concat:{right_version:right},resample:{column:v.columns.find(c=>/date|month|日期|月份/i.test(c.name))?.name||col,value:n,rule:'MS',aggregate:'sum'},
 }; return all[kind]||{};
}
