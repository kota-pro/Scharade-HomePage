import type {RoomLayout,LayoutWork,VectorPoint} from './exhibitionTypes.ts';
import {layoutObjects,objectHidden} from './exhibitionLayoutModel.ts';
import {annotationWorldPoint} from './exhibitionAnnotationPath.ts';
export type ConstructionGuide={a:VectorPoint;b:VectorPoint};
const distance=(a:VectorPoint,b:VectorPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const directions=[{x:1,y:0},{x:0,y:1},{x:Math.SQRT1_2,y:Math.SQRT1_2},{x:Math.SQRT1_2,y:-Math.SQRT1_2}];
const cross=(a:VectorPoint,b:VectorPoint)=>a.x*b.y-a.y*b.x;
export function constructionReferencePoints(room:RoomLayout,works:LayoutWork[],view:string,excludeObjects:string[]=[],excludeNodes:string[]=[]):VectorPoint[]{
 const points:VectorPoint[]=view==='floor'?room.vertices.filter(n=>!excludeNodes.includes(n.id??'')).map(n=>({x:n.x,y:n.y})):[];
 for(const o of layoutObjects(room,works,view).filter(o=>o.kind!=='dimension'&&!excludeObjects.includes(o.id)&&!objectHidden(room,o.id))){
  if(o.kind==='annotation'&&o.source.path)points.push(...o.source.path.nodes.filter((n:any)=>!excludeNodes.includes(n.id??'')).map((n:any)=>annotationWorldPoint(o.source,n)));
  for(const p of o.measurementPolygons??[])points.push(...p.points);
  points.push({x:o.box.x+o.box.width/2,y:o.box.y+o.box.height/2});
 }
 return points;
}
/** Keep the chosen 45-degree direction exact, including after reference/grid snapping. */
export function snapConstructionPoint(mouse:VectorPoint,origin:VectorPoint|undefined,references:VectorPoint[],options:{shift:boolean;alt?:boolean;grid?:number;tolerance:number;referencesEnabled?:boolean;direction?:VectorPoint;absoluteGrid?:boolean;orthogonalReferences?:boolean}){
 const grid=options.grid??0,plain=()=>grid&&!options.alt?{x:Math.round(mouse.x/grid)*grid,y:Math.round(mouse.y/grid)*grid}:{x:mouse.x,y:mouse.y};
 if(options.alt||!options.shift)return{point:plain(),guides:[] as ConstructionGuide[]};
 const refs=options.referencesEnabled===false?[]:references,candidates:{point:VectorPoint;reference:VectorPoint;priority:number;distance:number}[]=[];
 const add=(point:VectorPoint,reference:VectorPoint,priority:number,base:VectorPoint)=>{const d=distance(point,base);if(d<=options.tolerance)candidates.push({point,reference,priority,distance:d});};
 let base={x:mouse.x,y:mouse.y},direction:VectorPoint|undefined;
 if(origin){const angle=Math.round(Math.atan2(mouse.y-origin.y,mouse.x-origin.x)/(Math.PI/4))*Math.PI/4,given=options.direction,norm=given?Math.hypot(given.x,given.y):0;direction=given&&norm>1e-9?{x:given.x/norm,y:given.y/norm}:{x:Math.cos(angle),y:Math.sin(angle)};const length=Math.max(0,(mouse.x-origin.x)*direction.x+(mouse.y-origin.y)*direction.y);base={x:origin.x+length*direction.x,y:origin.y+length*direction.y};}
 for(const reference of refs){
  if(origin&&direction){const delta={x:reference.x-origin.x,y:reference.y-origin.y};if(Math.abs(cross(delta,direction))<.001&&delta.x*direction.x+delta.y*direction.y>=0)add(reference,reference,0,base);
   for(const d of options.orthogonalReferences?directions.slice(0,2):directions){const den=cross(direction,d);if(Math.abs(den)<1e-9)continue;const t=cross(delta,d)/den;if(t<0)continue;add({x:origin.x+t*direction.x,y:origin.y+t*direction.y},reference,1,base);}
  }else{add(reference,reference,0,base);for(const d of options.orthogonalReferences?directions.slice(0,2):directions){const t=(mouse.x-reference.x)*d.x+(mouse.y-reference.y)*d.y;add({x:reference.x+t*d.x,y:reference.y+t*d.y},reference,1,base);}}
 }
 candidates.sort((a,b)=>a.priority-b.priority||a.distance-b.distance||a.reference.x-b.reference.x||a.reference.y-b.reference.y);const best=candidates[0];let point=best?.point??base;
 if(!best&&grid){if(origin&&direction){const axis=Math.abs(direction.x)>=Math.abs(direction.y)?'x':'y',step=grid/Math.abs(direction[axis]),t=options.absoluteGrid?Math.max(0,(Math.round(base[axis]/grid)*grid-origin[axis])/direction[axis]):Math.max(0,Math.round(((base.x-origin.x)*direction.x+(base.y-origin.y)*direction.y)/step)*step);point={x:origin.x+t*direction.x,y:origin.y+t*direction.y};}else point=plain();}
 const guides:ConstructionGuide[]=[];if(origin)guides.push({a:origin,b:point});if(best&&(!origin||distance(best.reference,origin)>.001))guides.push({a:best.reference,b:point});return{point:{x:point.x,y:point.y},guides};
}
export function constructionGuidesSvg(guides:ConstructionGuide[],unit:number){if(!guides.length)return '';const end=guides.at(-1)!.b;return `<g pointer-events="none" fill="none" stroke="#b14d93">${guides.map(g=>`<path d="M${g.a.x} ${g.a.y}L${g.b.x} ${g.b.y}" stroke-dasharray="${4*unit} ${3*unit}" vector-effect="non-scaling-stroke"/>`).join('')}<circle cx="${end.x}" cy="${end.y}" r="${4*unit}" fill="white" vector-effect="non-scaling-stroke"/></g>`;}
