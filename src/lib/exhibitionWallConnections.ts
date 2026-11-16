import type {RoomLayout,VectorNode} from './exhibitionTypes.ts';
import {ensureRoomPath,roomWalls,syncRoomWallReferences,validRoomPath} from './exhibitionRoomPath.ts';
import {cornerLimit} from './exhibitionVector.ts';
export type WallConnectionChoice={direction:'forward'|'backward';label:string;replacedWallIds:string[];room?:RoomLayout;error?:string};
const clone=<T>(v:T):T=>structuredClone(v);
export function reverseConnectionNodes(nodes:VectorNode[]):VectorNode[]{return nodes.slice().reverse().map((n,i)=>{const previous=nodes[nodes.length-2-i];return{...clone(n),in:n.out?clone(n.out):undefined,out:n.in?clone(n.in):undefined,arc:previous?.arc?{...clone(previous.arc),sweep:!previous.arc.sweep}:undefined};});}
function forwardRoute(room:RoomLayout,from:number,to:number){const indices:number[]=[];for(let i=from;i!==to;i=(i+1)%room.vertices.length)indices.push(i);return indices;}
function used(room:RoomLayout,ids:Set<string>){
  const walls=roomWalls(room),has=(index:number,id?:string)=>ids.has(id??walls[index]?.id);
  return [...room.placements,...room.openings].some(p=>has(p.wall,p.wallId))
    ||room.titleBoards?.some(p=>p.surface.startsWith('wall:')&&has(Number(p.surface.slice(5)),p.wallId))
    ||room.annotations?.some(p=>p.surface?.startsWith('wall:')&&has(Number(p.surface.slice(5)),p.surfaceWallId))
    ||[...room.tables,...room.boardGroups??[]].some(p=>p.attachment&&ids.has(p.attachment.wallId));
}
/** Return both possible replacements; callers choose the shared edge or ask the editor. */
export function wallConnectionChoices(source:RoomLayout,nodes:VectorNode[],startId:string,endId:string):WallConnectionChoice[]{
  const room=clone(source);ensureRoomPath(room);const start=room.vertices.findIndex(n=>n.id===startId),end=room.vertices.findIndex(n=>n.id===endId);
  if(start<0||end<0||start===end)throw new Error('異なる2つの壁の頂点に接続してください。');
  if(nodes.length<2||nodes.some(n=>![n.x,n.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=100000)))throw new Error('壁の頂点を±100000mm以内で接続してください。');
  if(Math.hypot(nodes[0].x-room.vertices[start].x,nodes[0].y-room.vertices[start].y)>.01||Math.hypot(nodes.at(-1)!.x-room.vertices[end].x,nodes.at(-1)!.y-room.vertices[end].y)>.01)throw new Error('接続線の両端を壁の頂点に合わせてください。');
  return(['forward','backward'] as const).map(direction=>{
    const from=direction==='forward'?start:end,to=direction==='forward'?end:start,route=forwardRoute(room,from,to),path=direction==='forward'?clone(nodes):reverseConnectionNodes(nodes),walls=roomWalls(room),replacedWallIds=route.map(i=>room.wallIds![i]);
    const choice:WallConnectionChoice={direction,label:route.map(i=>walls[i].label).join(' → '),replacedWallIds};
    try{
      const removed=new Set(replacedWallIds);for(const i of [from,to]){const corner=walls.find(w=>w.corner&&w.nodeIndex===i);if(corner)removed.add(corner.id);}
      if(used(room,removed))throw new Error('置き換える壁の作品・扉・設備を別の壁へ再配置してから接続してください。');
      const next=clone(room),first=clone(room.vertices[from]),last=clone(room.vertices[to]);
      delete first.out;delete first.arc;delete first.radius;delete last.in;delete last.radius;
      if(path[0].out)first.out=clone(path[0].out);if(path[0].arc)first.arc=clone(path[0].arc);if(path.at(-1)!.in)last.in=clone(path.at(-1)!.in);
      const inserted=path.slice(1,-1).map(n=>({...clone(n),id:crypto.randomUUID()}));
      next.vertices=[first,...inserted,last];next.wallIds=[room.wallIds![from],...inserted.map(()=>crypto.randomUUID()),room.wallIds![to]];next.wallHeights=[room.wallHeights[from],...inserted.map(()=>room.wallHeights[from]),room.wallHeights[to]];
      for(let i=(to+1)%room.vertices.length;i!==from;i=(i+1)%room.vertices.length){next.vertices.push(clone(room.vertices[i]));next.wallIds.push(room.wallIds![i]);next.wallHeights.push(room.wallHeights[i]);}
      const original=next.vertices.findIndex(n=>n.id===room.vertices[0].id);if(original>0){const rotate=<T>(items:T[])=>items.push(...items.splice(0,original));rotate(next.vertices);rotate(next.wallIds);rotate(next.wallHeights);}
      if(next.vertices.length>32||!validRoomPath(next)||next.vertices.some((n,i)=>(n.radius??0)>cornerLimit({nodes:next.vertices,closed:true},i)+.01))throw new Error('壁が交差するか、連続した1つの外周になりません。頂点は32個以内で接続してください。');
      syncRoomWallReferences(next);choice.room=next;
    }catch(error){choice.error=error instanceof Error?error.message:'壁を連続した外周にできません。';}
    return choice;
  });
}
