import type {RoomLayout,Opening,VectorPath,VectorPoint} from './exhibitionTypes.ts';
import {roomWallPoint} from './exhibitionRoomPath.ts';
import {compileVectorPath,pointBounds} from './exhibitionVector.ts';
export function openingPath(room:RoomLayout,o:Opening):VectorPath {
  if(o.visualPath)return o.visualPath;
  const w=o.width,area=room.vertices.reduce((sum,p,i)=>{const q=room.vertices[(i+1)%room.vertices.length];return sum+p.x*q.y-q.x*p.y;},0),sign=(area>0?1:-1)*(o.swingSide==='outward'?-1:1);
  if(o.kind==='window')return{closed:false,nodes:[{id:crypto.randomUUID(),x:0,y:0},{id:crypto.randomUUID(),x:w,y:0}]};
  const angle=(o.swingAngle??90)*Math.PI/180,k=4/3*Math.tan(angle/4),x=w*Math.cos(angle),y=sign*w*Math.sin(angle);
  const path:VectorPath={closed:true,nodes:[{id:crypto.randomUUID(),x:0,y:0},{id:crypto.randomUUID(),x:w,y:0,out:{x:0,y:sign*k*w}},{id:crypto.randomUUID(),x,y,in:{x:k*w*Math.sin(angle),y:-sign*k*w*Math.cos(angle)}}]};
  if(o.hingeSide==='end')for(const n of path.nodes){n.x=w-n.x;for(const h of [n.in,n.out])if(h)h.x=-h.x;}
  return path;
}
export function setDoorOpening(o:Opening,hingeSide:'start'|'end',swingSide:'inward'|'outward') {
  if(o.kind!=='door')throw new Error('ドアを選択してください。');
  o.hingeSide=hingeSide;o.swingSide=swingSide;delete o.visualPath;
}
export function openingPathWorld(room:RoomLayout,o:Opening,p:VectorPoint,inverse=false) {
  const origin=roomWallPoint(room,o.wall,o.offset),angle=(inverse?-1:1)*origin.angle*Math.PI/180,x=inverse?p.x-origin.x:p.x,y=inverse?p.y-origin.y:p.y;
  return{x:(inverse?0:origin.x)+x*Math.cos(angle)-y*Math.sin(angle),y:(inverse?0:origin.y)+x*Math.sin(angle)+y*Math.cos(angle)};
}
export function openingPathBounds(room:RoomLayout,o:Opening){const b=compileVectorPath(openingPath(room,o)).bounds;return pointBounds([{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x+b.width,y:b.y+b.height},{x:b.x,y:b.y+b.height}].map(p=>openingPathWorld(room,o,p)));}
export function resizeOpeningPath(o:Opening,width:number){if(o.visualPath){const factor=width/o.width;for(const n of o.visualPath.nodes){n.x*=factor;n.y*=factor;for(const key of ['in','out'] as const)if(n[key]){n[key]!.x*=factor;n[key]!.y*=factor;}if(n.radius)n.radius*=factor;if(n.arc)n.arc.radius*=factor;}}}
