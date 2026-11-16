import {constructionReferencePoints,snapConstructionPoint,type ConstructionGuide} from './exhibitionConstructionSnap.ts';
import {layoutObjects,snapLayoutMovement,type LayoutBox} from './exhibitionLayoutModel.ts';
import {cornerFactors,framePoint,resizeSelectionFrame,resizeFrameTarget,type ResizeCorner} from './exhibitionTransforms.ts';
import {roomOutline} from './exhibitionRoomPath.ts';
import {roomSurfaces} from './exhibitionSurface.ts';
import type {RoomLayout,LayoutWork,VectorPoint} from './exhibitionTypes.ts';
type Options={grid:number;smart:boolean;tolerance:number;alt?:boolean};
function references(room:RoomLayout,works:LayoutWork[],view:string,ids:string[]) {
  const result=constructionReferencePoints(room,works,view,ids),surface=roomSurfaces(room).find(s=>s.key===view);
  const rect=(x:number,y:number,width:number,height:number)=>result.push({x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height});
  if(surface){if(surface.walls)for(const p of surface.walls)rect(p.left,p.top,p.wall.length,p.wall.height);else if(surface.panels)for(const p of surface.panels)rect(p.left,p.top,p.panel.width,p.panel.height);else rect(0,0,surface.width,surface.height);}
  return result;
}
/** Shift locks translation to one of eight directions; guides/grid never bend that ray. */
export function snapLayoutTranslation(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],box:LayoutBox,dx:number,dy:number,options:Options) {
  const origin={x:box.x,y:box.y},targets=options.smart&&!options.alt?references(room,works,view,ids):[];
  const offsets=[0,.5,1].flatMap(x=>[0,.5,1].map(y=>({x:box.width*x,y:box.height*y})));
  const refs=targets.flatMap(actual=>offsets.map(offset=>({point:{x:actual.x-offset.x,y:actual.y-offset.y},actual,offset})));
  const found=snapConstructionPoint({x:box.x+dx,y:box.y+dy},origin,refs.map(r=>r.point),{shift:true,grid:options.alt?0:options.grid,tolerance:options.tolerance,referencesEnabled:options.smart&&!options.alt,absoluteGrid:true});
  const guide=found.guides.at(-1),match=guide&&refs.find(r=>r.point===guide.a);
  const guides:ConstructionGuide[]=[{a:origin,b:found.point}];
  if(match)guides.push({a:match.actual,b:{x:found.point.x+match.offset.x,y:found.point.y+match.offset.y}});
  return {dx:found.point.x-box.x,dy:found.point.y-box.y,guides};
}
/** Normal resize snaps corners/edges; Shift keeps proportions and Option releases snapping. */
export function snapLayoutResize(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],corner:ResizeCorner,dx:number,dy:number,proportional:boolean,options:Options) {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id));if(!objects.length)throw new Error('拡大縮小する項目を選択してください。');const {frame,uniform}=resizeSelectionFrame(room,view,objects);
  return snapFrameResize(frame,corner,dx,dy,uniform||proportional,options.smart?references(room,works,view,ids):[],options);
}
export function snapLayoutRoomResize(room:RoomLayout,works:LayoutWork[],corner:ResizeCorner,dx:number,dy:number,proportional:boolean,options:Options) {
  const frame={...roomOutline(room).bounds,rotation:0},refs=options.smart?constructionReferencePoints(room,works,'floor',[],room.vertices.flatMap(n=>n.id?[n.id]:[])):[];
  return snapFrameResize(frame,corner,dx,dy,proportional,refs,options);
}
function snapFrameResize(frame:ReturnType<typeof resizeFrameTarget>,corner:ResizeCorner,dx:number,dy:number,keep:boolean,refs:VectorPoint[],options:Options) {
  if(options.alt)return{dx,dy,guides:[] as ConstructionGuide[]};
  const k=cornerFactors[corner],initial=framePoint(frame,k.x*frame.width,k.y*frame.height),fixed=framePoint(frame,(1-k.x)*frame.width,(1-k.y)*frame.height),target=resizeFrameTarget(frame,corner,dx,dy,keep),desired=framePoint(target,k.x*target.width,k.y*target.height);
  let point:VectorPoint,guides:ConstructionGuide[]=[];
  if(keep){const found=snapConstructionPoint(desired,fixed,refs,{shift:true,direction:{x:initial.x-fixed.x,y:initial.y-fixed.y},grid:options.grid,tolerance:options.tolerance,referencesEnabled:options.smart,absoluteGrid:true,orthogonalReferences:true});point=found.point;guides=found.guides;}
  else {
    const found=snapLayoutMovement({...desired,width:0,height:0},refs.map(p=>({...p,width:0,height:0})),0,0,options.tolerance,options.grid);
    point={x:desired.x+found.dx,y:desired.y+found.dy};
    for(const [axis,value] of [['x',found.xGuide],['y',found.yGuide]] as const){const ref=refs.find(p=>value!==undefined&&Math.abs(p[axis]-value)<1e-7);if(ref)guides.push({a:ref,b:point});}
  }
  const delta={dx:point.x-initial.x,dy:point.y-initial.y},actual=resizeFrameTarget(frame,corner,delta.dx,delta.dy,keep),endpoint=framePoint(actual,k.x*actual.width,k.y*actual.height);
  // A minimum-size clamp must not display a guide for an unreachable point.
  if(Math.hypot(endpoint.x-point.x,endpoint.y-point.y)>.01)return{dx:desired.x-initial.x,dy:desired.y-initial.y,guides:[]};
  return{...delta,guides};
}
