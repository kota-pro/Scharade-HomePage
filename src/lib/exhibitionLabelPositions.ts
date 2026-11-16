import {sameWallSurface} from "./exhibitionWallSurfaces.ts";
import {roomWalls} from './exhibitionRoomPath.ts';
import type {RoomLayout} from './exhibitionTypes.ts';
export function setLayoutLabelPosition(room:RoomLayout,surface:string,target:string,dx:number,dy:number){
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.max(Math.abs(dx),Math.abs(dy))>100000)throw new Error('ラベルの位置を確認してください。');
  const positions=room.labelPositions??=[],previous=positions.find(p=>sameWallSurface(room,p.surface,surface)&&p.target===target);
  const next={id:previous?.id??crypto.randomUUID(),surface:previous?.surface??surface,target,dx,dy};room.labelPositions=[...positions.filter(p=>p.target!==target||!sameWallSurface(room,p.surface,surface)),next];return next;
}
export function cleanLayoutLabelPositions(room:RoomLayout){
  const refs=new Set([...room.placements.map(p=>`work:${p.workId}`),...(room.boardPlacements??[]).map(p=>`work:${p.workId}`),...room.books.map(p=>`book:${p.workId}`),...room.tables.map(p=>`table:${p.id}`),...(room.boardGroups??[]).map(p=>`board:${p.id}`)]);
  for(const p of room.labelPositions??[])if(p.target.startsWith('work:')&&p.surface!=='floor'){const id=p.target.slice(5),wall=room.placements.find(p=>p.workId===id),board=room.boardPlacements?.find(p=>p.workId===id);p.surface=wall?`wall:${wall.wall}`:board?`board:${board.groupId}:${board.face}`:p.surface;}
  room.labelPositions=(room.labelPositions??[]).filter(p=>refs.has(p.target)&&(p.surface==='floor'||p.surface.startsWith('wall:')&&roomWalls(room)[Number(p.surface.slice(5))]||p.surface.startsWith('board:')&&room.boardGroups?.some(g=>g.id===p.surface.split(':')[1])));
}
