import { richTextLayout, annotationRuns } from './exhibitionRichText.ts';
import type { RoomAnnotation, VectorPath, VectorNode } from './exhibitionTypes.ts';
import { compileVectorPath, pointBounds } from './exhibitionVector.ts';
const node=(x:number,y:number):VectorNode=>({id:crypto.randomUUID(),x,y});
/** Conversion is explicit: old primitives render unchanged until their anchors are edited. */
export function annotationPath(a:RoomAnnotation):VectorPath {
  if(a.path)return a.path;
  const w=a.width,h=a.height,k=.5522847498307936;
  if(a.kind==='ellipse')return{closed:true,nodes:[{...node(w,h/2),in:{x:0,y:-k*h/2},out:{x:0,y:k*h/2}},{...node(w/2,h),in:{x:k*w/2,y:0},out:{x:-k*w/2,y:0}},{...node(0,h/2),in:{x:0,y:k*h/2},out:{x:0,y:-k*h/2}},{...node(w/2,0),in:{x:-k*w/2,y:0},out:{x:k*w/2,y:0}}]};
  if(a.kind==='door')return{closed:true,nodes:[{...node(w,0),in:{x:0,y:k*h}},{...node(0,0)},{...node(0,h),out:{x:k*w,y:0}}]};
  return{closed:true,nodes:[node(0,0),node(w,0),node(w,h),node(0,h)]};
}
export function annotationIntrinsicBounds(a:RoomAnnotation) {
  if(a.path){const b=compileVectorPath(a.path).bounds,pad=(a.strokeWidth??0)/2;return{x:b.x-pad,y:b.y-pad,width:Math.max(1,b.width+pad*2),height:Math.max(1,b.height+pad*2)};}
  if(a.kind==='text'){const b=richTextLayout(annotationRuns(a),a.fontSize);return{x:0,y:0,width:b.width*(a.textScaleX??1),height:b.height*(a.textScaleY??1)};}
  return{x:0,y:0,width:a.width,height:a.height};
}
/** Reflect about the fixed local origin so anchor edits never move other nodes. */
export function annotationLocalBounds(a:RoomAnnotation) {
  const b=annotationIntrinsicBounds(a);
  return {...b,x:a.flipX?-b.x-b.width:b.x,y:a.flipY?-b.y-b.height:b.y};
}
export function annotationWorldVector(a:RoomAnnotation,p:{x:number;y:number}) {
  const angle=a.rotation*Math.PI/180,x=(a.flipX?-1:1)*p.x,y=(a.flipY?-1:1)*p.y;
  return {x:x*Math.cos(angle)-y*Math.sin(angle),y:x*Math.sin(angle)+y*Math.cos(angle)};
}
export function annotationWorldPoint(a:RoomAnnotation,p:{x:number;y:number}) {
  const q=annotationWorldVector(a,p);return{x:a.x+q.x,y:a.y+q.y};
}
export function annotationLocalPoint(a:RoomAnnotation,p:{x:number;y:number}) {
  const angle=-a.rotation*Math.PI/180,x=p.x-a.x,y=p.y-a.y;
  return{x:(x*Math.cos(angle)-y*Math.sin(angle))*(a.flipX?-1:1),y:(x*Math.sin(angle)+y*Math.cos(angle))*(a.flipY?-1:1)};
}
export function annotationWorldBounds(a:RoomAnnotation) {
  const b=annotationLocalBounds(a),angle=a.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return pointBounds([{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>({x:a.x+p.x*c-p.y*s,y:a.y+p.x*s+p.y*c})));
}
