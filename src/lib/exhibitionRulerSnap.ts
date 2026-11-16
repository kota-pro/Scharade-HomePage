import { wallSurfacePart } from "./exhibitionWallSurfaces.ts";
import {layoutObjects,objectHidden} from './exhibitionLayoutModel.ts';
import {roomWalls,roomWallPoint,ensureRoomPath} from './exhibitionRoomPath.ts';
import {roomSurfaces} from './exhibitionSurface.ts';
import {nearestSegmentT,segmentPoint,segmentLength,type VectorSegment} from './exhibitionVector.ts';
import type {RoomLayout,LayoutWork,VectorPoint,DimensionAnchor} from './exhibitionTypes.ts';
type Snap={point:VectorPoint;anchor:DimensionAnchor;snapped:boolean};
type Candidate=Snap&{priority:number};
const distance=(a:VectorPoint,b:VectorPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a:VectorPoint,b:VectorPoint)=>a.x*b.y-a.y*b.x;
export function rulerSnap(room:RoomLayout,works:LayoutWork[],view:string,mouse:VectorPoint,options:{tolerance:number;grid?:number;alt?:boolean;shift?:boolean;start?:VectorPoint}):Snap{
  ensureRoomPath(room);const free=(p:VectorPoint):DimensionAnchor=>{const part=wallSurfacePart(room,view);return{kind:'free',x:p.x-(part?.left??0),y:p.y-(part?.top??0)};};const {start}=options,angle=start&&options.shift?Math.round(Math.atan2(mouse.y-start.y,mouse.x-start.x)/(Math.PI/4))*Math.PI/4:undefined,dir=angle===undefined?undefined:{x:Math.cos(angle),y:Math.sin(angle)},radius=start?distance(mouse,start):0;
  const p=dir&&start?{x:start.x+radius*dir.x,y:start.y+radius*dir.y}:mouse,candidates:Candidate[]=[];
  const add=(point:VectorPoint,anchor:DimensionAnchor,priority:number)=>{if(distance(point,p)>options.tolerance||dir&&start&&(Math.abs(cross({x:point.x-start.x,y:point.y-start.y},dir))>.01||(point.x-start.x)*dir.x+(point.y-start.y)*dir.y<-.01))return;candidates.push({point,anchor,priority,snapped:true});};
  const edge=(segment:VectorSegment,anchor:(t:number)=>DimensionAnchor)=>{
    const ratios:number[]=[];if(!dir||!start)ratios.push(nearestSegmentT(segment,p));else{
      const side=(t:number)=>{const q=segmentPoint(segment,t);return cross({x:q.x-start.x,y:q.y-start.y},dir);};
      for(let i=0;i<32;i++){let a=i/32,b=(i+1)/32,fa=side(a),fb=side(b);if(Math.abs(fa)<.001&&Math.abs(fb)<.001){ratios.push(nearestSegmentT(segment,p));break;}if(fa*fb>0)continue;for(let j=0;j<25;j++){const m=(a+b)/2,fm=side(m);if(fa*fm<=0){b=m;fb=fm;}else{a=m;fa=fm;}}ratios.push((a+b)/2);}
    }for(const t of ratios)add(segmentPoint(segment,t),anchor(t),1);
  };
  const rectangle=(x:number,y:number,w:number,h:number,anchor:(u:number,v:number)=>DimensionAnchor)=>{const points=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],uv=[[0,0],[1,0],[1,1],[0,1]];for(let i=0;i<4;i++){add(points[i],anchor(...uv[i] as [number,number]),0);const j=(i+1)%4;edge({a:points[i],b:points[j]},t=>anchor(uv[i][0]+(uv[j][0]-uv[i][0])*t,uv[i][1]+(uv[j][1]-uv[i][1])*t));}};
  if(!options.alt){
    if(view==='floor'){for(const node of room.vertices)add({x:node.x,y:node.y},{kind:'vertex',nodeId:node.id!},0);for(const wall of roomWalls(room))edge(wall.segment,t=>({kind:'wall',wallId:wall.id,ratio:segmentLength(wall.segment,0,t)/wall.length}));}
    else{const surface=roomSurfaces(room).find(s=>s.key===view);if(surface){if(surface.walls){for(const p of surface.walls)rectangle(p.left,p.top,p.wall.length,p.wall.height,(u,v)=>free({x:p.left+p.wall.length*u,y:p.top+p.wall.height*v}));}else rectangle(0,0,surface.width,surface.height,(u,v)=>({kind:'surface',u,v}));for(const panel of surface.panels??[])rectangle(panel.left,panel.top,panel.panel.width,panel.panel.height,(u,v)=>({kind:'panel',panelId:panel.panel.id,u,v}));}}
    for(const object of layoutObjects(room,works,view).filter(o=>o.kind!=='dimension'&&!objectHidden(room,o.id)))for(const polygon of object.measurementPolygons??[]){for(let i=0;i<polygon.points.length;i++){const a=polygon.points[i],b=polygon.points[(i+1)%polygon.points.length],anchor=(ratio:number):DimensionAnchor=>({kind:'object',objectId:object.id,u:0,v:0,feature:{key:polygon.key,edge:i,ratio}});add(a,anchor(0),0);edge({a,b},anchor);}}
    candidates.sort((a,b)=>a.priority-b.priority||distance(a.point,p)-distance(b.point,p)||JSON.stringify(a.anchor).localeCompare(JSON.stringify(b.anchor)));if(candidates.length)return candidates[0];
  }
  const grid=options.grid??0,point=grid&&!options.alt&&!dir?{x:Math.round(p.x/grid)*grid,y:Math.round(p.y/grid)*grid}:p;return{point,anchor:free(point),snapped:false};
}
