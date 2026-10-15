export const cartesian=(labels:string[],series:any[],type='bar')=>({
 tooltip:{trigger:series.length>12?'item':'axis'},
 legend:{type:'scroll',top:0,left:20,right:20},
 grid:{left:70,right:24,top:45,bottom:labels.length>20?95:65},
 xAxis:{type:'category',data:labels,axisLabel:{hideOverlap:true}},
 yAxis:{type:'value'},
 dataZoom:labels.length>20?[
  {type:'slider',xAxisIndex:0,filterMode:'none',bottom:12,startValue:0,endValue:19},
  {type:'inside',xAxisIndex:0,filterMode:'none',startValue:0,endValue:19},
 ]:[],
 series:series.map(s=>({...s,type:type==='area'?'line':type,
  ...(type==='area'?{areaStyle:{opacity:.13}}:{}),barMaxWidth:40,smooth:false})),
});
