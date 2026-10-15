import {useEffect,useRef} from 'react';
import * as echarts from 'echarts/core';
import {BarChart,LineChart,ScatterChart,HeatmapChart,BoxplotChart} from 'echarts/charts';
import {DataZoomComponent,GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,ToolboxComponent,BrushComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
echarts.use([BarChart,LineChart,ScatterChart,HeatmapChart,BoxplotChart,DataZoomComponent,GridComponent,TooltipComponent,LegendComponent,VisualMapComponent,ToolboxComponent,BrushComponent,CanvasRenderer]);
export default function WorkbenchChart({option,label,onClick,onBrush,height=320,downloadRef}:{option:any;label:string;onClick?:(p:any)=>void;onBrush?:(p:any)=>void;height?:number;downloadRef?:React.RefObject<(()=>void)|null>}) {
 const div=useRef<HTMLDivElement>(null), chart=useRef<echarts.EChartsType|null>(null);
 const click=useRef(onClick),brush=useRef(onBrush);click.current=onClick;brush.current=onBrush;
 useEffect(()=>{if(!div.current)return;const instance=echarts.init(div.current);chart.current=instance;
  instance.on('click',p=>click.current?.(p));instance.on('brushEnd',p=>brush.current?.(p));
  const observer=new ResizeObserver(()=>instance.resize());observer.observe(div.current);
  if(downloadRef)downloadRef.current=()=>{const a=document.createElement('a');a.download='analysis-chart.png';a.href=instance.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#fff'});a.click();};
  return()=>{observer.disconnect();instance.dispose();chart.current=null;if(downloadRef)downloadRef.current=null;};
 },[]);
 useEffect(()=>{chart.current?.setOption({color:['#4676e8','#18a18c','#e6a440','#9467c4','#e47777','#619bb5'],textStyle:{fontFamily:'system-ui'},...option},true);},[option]);
 return <div ref={div} className="wb-chart" style={{height}} role="img" aria-label={label}/>;
}
