import {snapConstructionPoint,constructionGuidesSvg,type ConstructionGuide} from '../lib/exhibitionConstructionSnap.ts';
import type {VectorNode} from '../lib/exhibitionTypes.ts';
import {compileVectorPath} from '../lib/exhibitionVector.ts';
type Options={svg:()=>SVGSVGElement;active:()=>boolean;point:(e:{clientX:number;clientY:number})=>{x:number;y:number};snap:(p:{x:number;y:number},alt:boolean)=>{x:number;y:number};unit:()=>number;grid?:()=>number;create:(nodes:VectorNode[])=>boolean;paint:()=>void;gesture:(cancel:(()=>void)|undefined)=>void;message:(text:string,error?:boolean)=>void};
export function createEmptyRoomDrawing(b:Options){
  let guides:ConstructionGuide[]=[];
  let nodes:VectorNode[]=[],future:VectorNode[]=[],hover:{x:number;y:number}|undefined;
  const copy=()=>structuredClone(nodes);
  function snapPoint(p:{x:number;y:number},e:{altKey:boolean;shiftKey:boolean},origin=nodes.at(-1),references=nodes){const result=snapConstructionPoint(p,origin,references,{shift:e.shiftKey,alt:e.altKey,grid:b.grid?.()??0,tolerance:8*b.unit()});guides=result.guides;return e.shiftKey?result.point:b.snap(p,e.altKey);}
  function cancel(){guides=[];nodes=[];future=[];hover=undefined;b.paint();}
  function finish(){if(nodes.length<3){b.message('3点以上の頂点で展示室を閉じてください。',true);return false;}if(!b.create(copy()))return false;guides=[];nodes=[];future=[];hover=undefined;b.paint();return true;}
  function undo(redo=false){if(redo){const node=future.pop();if(!node)return false;nodes.push(node);}else{const node=nodes.pop();if(!node)return false;future.push(node);}b.paint();return true;}
  function pointerDown(e:PointerEvent){if(!b.active()||e.button!==0)return false;
    const target=e.target as Element;if(target.closest('[data-empty-room-node]')){finish();return true;}
    if(nodes.length>=32){b.message('頂点は32個までです。',true);return true;}
    const before=copy(),p=snapPoint(b.point(e),e),node:VectorNode={id:crypto.randomUUID(),...p};nodes.push(node);future=[];hover=p;b.paint();
    const canvas=b.svg(),matrix=canvas.getScreenCTM()!.inverse();let ended=false;canvas.setPointerCapture(e.pointerId);canvas.dataset.dragging='true';
    const block=(event:Event)=>{if(event.cancelable)event.preventDefault();};
    const move=(event:PointerEvent)=>{if(event.pointerId!==e.pointerId)return;event.preventDefault();const q=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix),at=snapPoint(q,event,p,nodes.slice(0,-1)),dx=at.x-p.x,dy=at.y-p.y;if(Math.hypot(dx,dy)>2*b.unit()){node.out={x:dx,y:dy};node.in={x:-dx,y:-dy};node.mode='symmetric';b.paint();}};
    const stop=(cancelled:boolean)=>{if(ended)return;ended=true;window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',abort,true);window.removeEventListener('blur',blur);window.removeEventListener('pagehide',blur);window.removeEventListener('wheel',block,true);canvas.removeEventListener('lostpointercapture',abort);if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);delete canvas.dataset.dragging;b.gesture(undefined);if(cancelled)nodes=before;b.paint();};
    const up=(event:PointerEvent)=>{if(event.pointerId===e.pointerId)stop(false);},abort=(event:PointerEvent)=>{if(event.pointerId===e.pointerId)stop(true);},blur=()=>stop(true);
    b.gesture(blur);window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',abort,true);window.addEventListener('blur',blur);window.addEventListener('pagehide',blur);window.addEventListener('wheel',block,{capture:true,passive:false});canvas.addEventListener('lostpointercapture',abort);return true;
  }
  function overlay(){if(!nodes.length)return '';const u=b.unit();return `<g data-empty-construction-guides>${constructionGuidesSvg(guides,u)}</g><path data-empty-room-preview pointer-events="none" d="${compileVectorPath({nodes,closed:false}).svg}${hover?`L${hover.x} ${hover.y}`:''}" fill="none" stroke="#0db49b" vector-effect="non-scaling-stroke"/>${nodes.map((n,i)=>`<circle data-empty-room-node="${i}" cx="${n.x}" cy="${n.y}" r="${6*u}" fill="white" stroke="#0db49b" vector-effect="non-scaling-stroke"><title>クリックして展示室を閉じる</title></circle>`).join('')}`;}
  return{pointerDown,overlay,finish,cancel,undo,hasDraft:()=>nodes.length>0,canUndo:()=>nodes.length>0,canRedo:()=>future.length>0,pointerMove:(event:PointerEvent)=>{if(!b.active()||!nodes.length)return;hover=snapPoint(b.point(event),event);b.svg().querySelector('[data-empty-construction-guides]')?.replaceChildren();const g=b.svg().querySelector('[data-empty-construction-guides]');if(g)g.innerHTML=constructionGuidesSvg(guides,b.unit());b.svg().querySelector('[data-empty-room-preview]')?.setAttribute('d',`${compileVectorPath({nodes,closed:false}).svg}L${hover.x} ${hover.y}`);}};
}
