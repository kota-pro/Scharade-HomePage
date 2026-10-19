import type { DimensionAnchor, LayoutDimension, RoomLayout, VectorPoint } from './exhibitionTypes.ts';
import { roomWalls, roomWallById, roomWallPoint } from './exhibitionRoomPath.ts';
import { distance, add, subtract, scale, unitVector, pointBounds } from './exhibitionVector.ts';
import {boardSurface} from './exhibitionBoards.ts';
import {polygonMeasurementPoint,type MeasurementPolygon} from './exhibitionMeasurementGeometry.ts';
type MeasurementObject={id:string;box:{x:number;y:number;width:number;height:number};source?:any;measurementPolygons?:MeasurementPolygon[]};
export function dimensionPoint(room:RoomLayout,d:LayoutDimension,a:DimensionAnchor,objects:MeasurementObject[]):VectorPoint|undefined {
  if(a.kind==='free')return{x:a.x,y:a.y};
  if(a.kind==='vertex'){const n=room.vertices.find(n=>n.id===a.nodeId);return n?{x:n.x,y:n.y}:undefined;}
  if(a.kind==='wall'){const w=roomWallById(room,a.wallId);if(!w)return;if(d.surface==='floor')return roomWallPoint(room,w.index,w.length*a.ratio);if(d.surface===`wall:${w.index}`)return{x:w.length*a.ratio,y:0};return;}
  if(a.kind==='panel'||a.kind==='surface'){if(d.surface.startsWith('wall:')&&a.kind==='surface'){const w=roomWalls(room)[Number(d.surface.slice(5))];return w?{x:w.length*a.u,y:w.height*a.v}:undefined;}const group=room.boardGroups?.find(g=>g.id===d.surface.split(':')[1]);if(!group)return;const s=boardSurface(group,d.surface.endsWith(':B')?'B':'A');if(a.kind==='surface')return{x:s.width*a.u,y:s.height*a.v};const panel=s.panels.find(p=>p.panel.id===a.panelId);return panel?{x:panel.left+panel.panel.width*a.u,y:panel.top+panel.panel.height*a.v}:undefined;}
  const o=objects.find(o=>o.id===a.objectId);return a.feature?polygonMeasurementPoint(o?.measurementPolygons,a.feature):o?{x:o.box.x+o.box.width*a.u,y:o.box.y+o.box.height*a.v}:undefined;
}
export function dimensionGeometry(room:RoomLayout,d:LayoutDimension,objects:MeasurementObject[]) {
  const a=dimensionPoint(room,d,d.a,objects),b=dimensionPoint(room,d,d.b,objects);if(!a||!b)return;
  const wall=d.wallId?roomWallById(room,d.wallId):undefined,vector=unitVector(subtract(b,a)),normal={x:-vector.y,y:vector.x},p=add(a,scale(normal,d.offset)),q=add(b,scale(normal,d.offset)),mid=scale(add(p,q),.5);
  return {a,b,p,q,mid,value:wall?.length??distance(a,b),box:pointBounds([a,b,p,q]),wall};
}
export function dimensionSvg(room:RoomLayout,d:LayoutDimension,objects:MeasurementObject[],unit=1,interactive=false) {
  const g=dimensionGeometry(room,d,objects);if(!g)return'';const {a,b,p,q,mid}=g,color=d.color??'#777777';
  const label=`${g.value.toFixed(1)} mm`,width=(label.length*7+12)*unit;
  return `<g data-layout-dimension-line="${d.id}" fill="none" stroke="${color}"><path d="M${a.x} ${a.y}L${p.x} ${p.y}M${b.x} ${b.y}L${q.x} ${q.y}M${p.x} ${p.y}L${q.x} ${q.y}" stroke-width="1" vector-effect="non-scaling-stroke"/><circle cx="${p.x}" cy="${p.y}" r="${2*unit}" fill="${color}" vector-effect="non-scaling-stroke"/><circle cx="${q.x}" cy="${q.y}" r="${2*unit}" fill="${color}" vector-effect="non-scaling-stroke"/><g ${interactive?`data-layout-distance="${d.id}" tabindex="0" role="button" aria-label="距離 ${g.value.toFixed(1)}mmを変更"`:''}><text x="${mid.x}" y="${mid.y-7*unit}" fill="${color}" stroke="none" text-anchor="middle" font-size="${12*unit}">${label}</text>${interactive?`<rect x="${mid.x-width/2}" y="${mid.y-23*unit}" width="${width}" height="${23*unit}" fill="transparent" stroke="none" pointer-events="all"/>`:''}</g></g>`;
}
export const wallDimension=(room:RoomLayout,index:number,surface='floor'):LayoutDimension=>{const wall=roomWalls(room)[index];return{id:crypto.randomUUID(),surface,a:{kind:'wall',wallId:wall.id,ratio:0},b:{kind:'wall',wallId:wall.id,ratio:1},wallId:wall.id,offset:-100,color:'#777777',...(surface.startsWith('wall:')?{surfaceWallId:wall.id}:{})};};
