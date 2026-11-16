import { wallSurface, wallSurfacePart, wallSurfaceContains, sameWallSurface, rebaseWallAttachments } from "./exhibitionWallSurfaces.ts";
import {roomWallPoint,roomWallById,roomWallOffset} from './exhibitionRoomPath.ts';
import {boardSurface} from './exhibitionBoards.ts';
import type {RoomLayout,WallAttachment,BoardGroup} from './exhibitionTypes.ts';
type Equipment=RoomLayout['tables'][number]|BoardGroup;
const width=(item:Equipment)=>'panels'in item?boardSurface(item,'A').width:item.width;
const height=(item:Equipment)=>'panels'in item?Math.max(...item.panels.map(p=>p.height)):item.height??700;
const depth=(item:Equipment)=>'panels'in item?Math.max(...item.panels.map(p=>p.thickness)):item.depth;
const inward=(room:RoomLayout)=>room.vertices.reduce((s,p,i)=>{const q=room.vertices[(i+1)%room.vertices.length];return s+p.x*q.y-q.x*p.y;},0)>=0?1:-1;
export function wallEquipmentBox(room:RoomLayout,item:Equipment,view:string){const attachment=item.attachment;if(!attachment)return;const wall=roomWallById(room,attachment.wallId);if(!wall||!sameWallSurface(room,view,`wall:${wall.index}`))return;const surface=wallSurface(room,wall.index)!,part=wallSurfacePart(room,wall.index)!;return{x:part.left+attachment.offset,y:surface.height-(attachment.bottom??0)-height(item),width:width(item),height:height(item)};}
/** The attachment is the source of truth; x/y are the matching floor coordinates. */
export function syncWallEquipment(room:RoomLayout){
 rebaseWallAttachments(room);
 for(const item of [...room.tables,...room.boardGroups??[]]){const a=item.attachment;if(!a)continue;const wall=roomWallById(room,a.wallId);if(!wall)throw new Error('設備が連動する壁が削除されています。先に壁との連動を解除してください。');const w=width(item),h=height(item),d=depth(item);const surface=wallSurface(room,wall.index)!,part=wallSurfacePart(room,wall.index)!,x=part.left+a.offset,y=surface.height-(a.bottom??0)-h;if(a.distance<0||!wallSurfaceContains(surface,[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]))throw new Error('壁に連動する設備の位置・寸法を壁の内側に設定してください。');
  const middle=roomWallPoint(room,wall.index,a.offset+w/2),angle=middle.angle*Math.PI/180,sign=inward(room),normal={x:-Math.sin(angle)*sign,y:Math.cos(angle)*sign};
  if('panels'in item){item.rotation=middle.angle;item.x=middle.x-Math.cos(angle)*w/2+normal.x*(a.distance+d/2);item.y=middle.y-Math.sin(angle)*w/2+normal.y*(a.distance+d/2);}
  else{const rotation=middle.angle+(sign<0?180:0),r=rotation*Math.PI/180;item.rotation=rotation;item.x=middle.x-Math.cos(r)*w/2+normal.x*a.distance;item.y=middle.y-Math.sin(r)*w/2+normal.y*a.distance;}
  item.x=Math.round(item.x*1000)/1000;item.y=Math.round(item.y*1000)/1000;item.rotation=Math.round(item.rotation*1000)/1000;a.offset=Math.round(a.offset*1000)/1000;a.distance=Math.round(a.distance*1000)/1000;
 }
}
export function attachEquipment(room:RoomLayout,item:Equipment,wallId:string,offset:number,distance=0){item.attachment={wallId,offset,distance,bottom:0};syncWallEquipment(room);}
export function moveWallEquipment(room:RoomLayout,item:Equipment,view:string,dx:number,dy:number){const a=item.attachment;if(!a)return false;if(view!=='floor'){a.offset+=dx;a.bottom=(a.bottom??0)-dy;}else{const wall=roomWallById(room,a.wallId);if(!wall)throw new Error('連動する壁がありません。');const middle=roomWallPoint(room,wall.index,a.offset+width(item)/2),next={x:middle.x+dx,y:middle.y+dy};a.offset=roomWallOffset(room,wall.index,next)-width(item)/2;const at=roomWallPoint(room,wall.index,a.offset+width(item)/2),angle=at.angle*Math.PI/180;a.distance+=(dx*-Math.sin(angle)+dy*Math.cos(angle))*inward(room);}
 syncWallEquipment(room);return true;
}
export function wallEquipmentHeight(item:Equipment){return height(item);}
