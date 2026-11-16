import {compileVectorPath,nearestSegmentT,segmentPoint,type VectorSegment} from './exhibitionVector.ts';
import {annotationPath,annotationLocalPoint,annotationWorldPoint} from './exhibitionAnnotationPath.ts';
import {layoutObjects,objectHidden} from './exhibitionLayoutModel.ts';
import {roomWalls} from './exhibitionRoomPath.ts';
import {roomSurfaces} from './exhibitionSurface.ts';
import type {RoomLayout,LayoutWork,RoomAnnotation,VectorPoint} from './exhibitionTypes.ts';
const cache=new WeakMap<RoomAnnotation,{key:string;path:ReturnType<typeof compileVectorPath>}>();
const distance=(a:VectorPoint,b:VectorPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const closest=(s:VectorSegment,p:VectorPoint)=>{if(s.arc||s.c1)return nearestSegmentT(s,p);const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y;return Math.max(0,Math.min(1,((p.x-s.a.x)*dx+(p.y-s.a.y)*dy)/Math.max(1e-20,dx*dx+dy*dy)));};
/** Placement snaps to physical contours, excluding names, notes and hidden objects. */
export function snapShapePlacement(room:RoomLayout,works:LayoutWork[],view:string,mouse:VectorPoint,options:{tolerance:number;grid?:number;alt?:boolean;enabled?:boolean}){
 const candidates:{point:VectorPoint;priority:number;distance:number}[]=[];
 const add=(point:VectorPoint,priority:number)=>{const d=distance(point,mouse);if(d<=options.tolerance)candidates.push({point,priority,distance:d});};
 const segment=(s:VectorSegment)=>{add(s.a,0);add(s.b,0);add(segmentPoint(s,closest(s,mouse)),1);};
 const rectangle=(x:number,y:number,width:number,height:number)=>{const p=[{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}];p.forEach((a,i)=>segment({a,b:p[(i+1)%4]}));};
 if(!options.alt&&options.enabled!==false){
  if(view==='floor')for(const wall of roomWalls(room))segment(wall.segment);
  else{const surface=roomSurfaces(room).find(s=>s.key===view);if(surface){if(surface.walls)for(const p of surface.walls)rectangle(p.left,p.top,p.wall.length,p.wall.height);else rectangle(0,0,surface.width,surface.height);for(const p of surface.panels??[])rectangle(p.left,p.top,p.panel.width,p.panel.height);}}
  for(const o of layoutObjects(room,works,view).filter(o=>o.kind!=='dimension'&&!objectHidden(room,o.id))){
   if(o.kind==='annotation'&&!['text','image'].includes(o.source.kind)){
    const a=o.source as RoomAnnotation,key=JSON.stringify([a.kind,a.width,a.height,a.path]);let saved=cache.get(a);if(saved?.key!==key){saved={key,path:compileVectorPath(annotationPath(a))};cache.set(a,saved);}const local=annotationLocalPoint(a,mouse);
    for(const {segment:s}of saved.path.ordered){add(annotationWorldPoint(a,s.a),0);add(annotationWorldPoint(a,s.b),0);add(annotationWorldPoint(a,segmentPoint(s,closest(s,local))),1);}
   }else for(const polygon of o.measurementPolygons??[]){polygon.points.forEach((a,i)=>segment({a,b:polygon.points[(i+1)%polygon.points.length]}));}
  }
 }
 candidates.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.point.x-b.point.x||a.point.y-b.point.y);
 const grid=options.alt?0:options.grid??0;return candidates[0]?{point:candidates[0].point,snapped:true}:{point:grid?{x:Math.round(mouse.x/grid)*grid,y:Math.round(mouse.y/grid)*grid}:{...mouse},snapped:false};
}
