import {wallEquipmentBox,moveWallEquipment} from './exhibitionWallEquipment.ts';
import { annotationLocalBounds } from './exhibitionAnnotationPath.ts';
import { layoutObjects, resizeLayoutObject, surfaceHeight, selectionBounds, objectLocked, type LayoutObject, type LayoutPoint } from './exhibitionLayoutModel.ts';
import type { RoomLayout, LayoutWork } from './exhibitionTypes.ts';
export type ResizeCorner = 'nw'|'ne'|'se'|'sw';
export const cornerFactors: Record<ResizeCorner,{x:number;y:number}> = {nw:{x:0,y:0},ne:{x:1,y:0},se:{x:1,y:1},sw:{x:0,y:1}};
export function layoutFrame(room:RoomLayout,view:string,o:LayoutObject) {
  const p=o.source;
  if(o.kind==='opening')return {x:p.offset,y:surfaceHeight(room,view)-p.bottom-p.height,width:p.width,height:p.height,rotation:0};
  if(o.kind==='annotation'){const b=annotationLocalBounds(p),angle=(p.rotation??0)*Math.PI/180;return{x:p.x+b.x*Math.cos(angle)-b.y*Math.sin(angle),y:p.y+b.x*Math.sin(angle)+b.y*Math.cos(angle),width:b.width,height:b.height,rotation:p.rotation??0};}
  if((o.kind==='table'||o.kind==='board')&&p.attachment&&view!=='floor')return{...wallEquipmentBox(room,p,view)!,rotation:0};
  return {x:p.x,y:p.y,width:p.width,height:o.kind==='table'?p.depth:p.height,rotation:p.rotation??0};
}
export function framePoint(frame:ReturnType<typeof layoutFrame>,x:number,y:number):LayoutPoint {
  const a=frame.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return {x:frame.x+x*c-y*s,y:frame.y+x*s+y*c};
}
/** Resize in the object's own axes. The diagonal corner stays fixed, including after rotation. */
export function resizeLayoutFromCorner(room:RoomLayout,works:LayoutWork[],view:string,id:string,corner:ResizeCorner,dx:number,dy:number,proportional=false) {
  const o=layoutObjects(room,works,view).find(o=>o.id===id);if(!o||!o.resizable)throw new Error('この項目の実寸は変更できません。');
  const f=layoutFrame(room,view,o),k=cornerFactors[corner],a=-f.rotation*Math.PI/180;
  const lx=dx*Math.cos(a)-dy*Math.sin(a),ly=dx*Math.sin(a)+dy*Math.cos(a);
  let width=Math.max(1,f.width+(k.x?lx:-lx)),height=Math.max(1,f.height+(k.y?ly:-ly));
  if(proportional){const factor=Math.abs(width/f.width-1)>Math.abs(height/f.height-1)?width/f.width:height/f.height;width=Math.max(1,f.width*factor);height=Math.max(1,f.height*factor);}
  const fixed=framePoint(f,(1-k.x)*f.width,(1-k.y)*f.height),angle=f.rotation*Math.PI/180;
  resizeLayoutObject(room,works,view,id,width,height);
  const resized=layoutFrame(room,view,o);width=resized.width;height=resized.height;const actualX=fixed.x-(1-k.x)*width*Math.cos(angle)+(1-k.y)*height*Math.sin(angle),actualY=fixed.y-(1-k.x)*width*Math.sin(angle)-(1-k.y)*height*Math.cos(angle);
  if(o.kind==='opening'){o.source.offset=actualX;o.source.bottom=surfaceHeight(room,view)-actualY-height;}else if(o.kind==='annotation'){const bounds=annotationLocalBounds(o.source),offset=framePoint({...f,x:0,y:0},bounds.x,bounds.y);o.source.x=actualX-offset.x;o.source.y=actualY-offset.y;}else if(o.source.attachment){moveWallEquipment(room,o.source,view,actualX-resized.x,actualY-resized.y);}else {o.source.x=actualX;o.source.y=actualY;}
  return {before:f,after:{...f,x:actualX,y:actualY,width,height}};
}

/** Physical works and boards are excluded; rotated selections retain their proportions. */
export function resizeLayoutSelectionFromCorner(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],corner:ResizeCorner,dx:number,dy:number,proportional=false) {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id));
  if(!objects.length||objects.length!==new Set(ids).size||objects.some(o=>!o.resizable||objectLocked(room,o.id)))throw new Error('図形・文字・展示台だけを選択してください。作品の実寸は変更できません。');
  if(objects.length===1)return resizeLayoutFromCorner(room,works,view,ids[0],corner,dx,dy,proportional);
  const bounds=selectionBounds(objects),before={...bounds,rotation:0},k=cornerFactors[corner],fixed={x:bounds.x+(1-k.x)*bounds.width,y:bounds.y+(1-k.y)*bounds.height};
  let sx=Math.max(1/bounds.width,(bounds.width+(k.x?dx:-dx))/bounds.width),sy=Math.max(1/bounds.height,(bounds.height+(k.y?dy:-dy))/bounds.height);
  if(proportional||objects.some(o=>Math.abs(o.rotation%180)>.001)){sx=sy=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;}
  const old=objects.map(o=>({o,frame:layoutFrame(room,view,o)}));
  for(const {o,frame:f} of old){resizeLayoutObject(room,works,view,o.id,f.width*sx,f.height*sy);const x=fixed.x+(f.x-fixed.x)*sx,y=fixed.y+(f.y-fixed.y)*sy;
    if(o.kind==='opening'){o.source.offset=x;o.source.bottom=surfaceHeight(room,view)-y-o.source.height;}
    else if(o.kind==='annotation'){const b=annotationLocalBounds(o.source),offset=framePoint({...f,x:0,y:0},b.x,b.y);o.source.x=x-offset.x;o.source.y=y-offset.y;}
    else if(o.source.attachment){const current=layoutFrame(room,view,o);moveWallEquipment(room,o.source,view,x-current.x,y-current.y);}else{o.source.x=x;o.source.y=y;}
  }
  return{before,after:{x:fixed.x+(bounds.x-fixed.x)*sx,y:fixed.y+(bounds.y-fixed.y)*sy,width:bounds.width*sx,height:bounds.height*sy,rotation:0}};
}
