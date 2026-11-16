/** Read-only hover hints. Never capture the pointer or alter selection/layout data. */
export function createLayoutDimensionHover(canvas:SVGSVGElement){
 const stage=canvas.closest<HTMLElement>('.layout-stage')!,tip=document.createElement('div');
 tip.className='layout-dimension-tooltip';tip.dataset.layoutDimensionTooltip='';tip.setAttribute('role','tooltip');tip.hidden=true;stage.append(tip);
 const frame=document.createElementNS('http://www.w3.org/2000/svg','rect');
 for(const [key,value] of Object.entries({'data-layout-hover-frame':'',fill:'none',stroke:'#0db49b','stroke-width':'1','stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke','pointer-events':'none'}))frame.setAttribute(key,value);
 frame.style.display='none';canvas.append(frame);
 const hide=()=>{tip.hidden=true;frame.style.display='none';};
 const move=(event:PointerEvent,enabled:boolean)=>{
  const target=(event.target instanceof Element?event.target.closest('[data-layout-size-label]'):null)??document.elementsFromPoint(event.clientX,event.clientY).filter(el=>canvas.contains(el)).map(el=>el.closest('[data-layout-size-label]')).find(Boolean);
  const text=target?.getAttribute('data-layout-size-label');
  if(!enabled||event.buttons||event.pointerType==='touch'||!text){hide();return;}
  if(tip.textContent!==text)tip.textContent=text;
  tip.hidden=false;
  const area=stage.getBoundingClientRect(),bounds=canvas.getBoundingClientRect(),w=tip.offsetWidth,h=tip.offsetHeight;
  let x=event.clientX-area.left+14,y=event.clientY-area.top+18;
  if(x+w>bounds.right-area.left-8)x=event.clientX-area.left-w-14;
  if(y+h>bounds.bottom-area.top-8)y=event.clientY-area.top-h-14;
  tip.style.left=`${Math.max(8,Math.min(x,area.width-w-8))}px`;
  tip.style.top=`${Math.max(8,Math.min(y,bounds.bottom-area.top-h-8))}px`;
  const box=target?.getAttribute('data-layout-size-box')?.split(' ').map(Number);
  if(box?.length===4&&box.every(Number.isFinite)){
   const matrix=canvas.getScreenCTM(),pad=matrix?3/Math.max(.000001,Math.hypot(matrix.a,matrix.b)):0;
   for(const [key,value] of Object.entries({x:box[0]-pad,y:box[1]-pad,width:box[2]+2*pad,height:box[3]+2*pad}))frame.setAttribute(key,String(value));
   frame.style.display='';
  }else frame.style.display='none';
 };
 for(const type of ['pointerleave','pointerdown','pointercancel','wheel','keydown','blur'])canvas.addEventListener(type,hide);
 return {move,hide};
}
