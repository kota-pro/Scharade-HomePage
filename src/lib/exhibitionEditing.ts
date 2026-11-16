import { layoutBounds, wallLength } from "./exhibitionGeometry.ts";
import {ensureRoomPath, syncRoomWallReferences, roomWalls,roomOutline, validRoomPath, scaleRoomWall} from './exhibitionRoomPath.ts';
import {splitPathEdge, nearestSegmentT, nodeSegment,materializeVectorPath,cornerLimit} from './exhibitionVector.ts';
import type { PhotoLayout, RoomLayout } from "./exhibitionTypes.ts";
export const paperSizes = [
  { id: "A1", width: 594, height: 841 }, { id: "A2", width: 420, height: 594 },
  { id: "A3", width: 297, height: 420 }, { id: "A4", width: 210, height: 297 }, { id: "A5", width: 148, height: 210 },
  { id: "B1", label: "JIS B1", width: 728, height: 1030 }, { id: "B2", label: "JIS B2", width: 515, height: 728 }, { id: "B3", label: "JIS B3", width: 364, height: 515 },
  { id: "B4", label: "JIS B4", width: 257, height: 364 }, { id: "B5", label: "JIS B5", width: 182, height: 257 },
  { id: "L", width: 89, height: 127 }, { id: "2L", width: 127, height: 178 },
];
export const roundMm = (value: number) => Math.round(value * 10) / 10;
export function snapMm(value: number, interval: number) { return roundMm(interval > 0 ? Math.round(value / interval) * interval : value); }
export function snapPhotoEdges(photos:PhotoLayout[],selected:number[],dx:number,dy:number,tolerance:number) {
  const others=photos.map((p,i)=>({i,box:layoutBounds([p])})).filter(p=>!selected.includes(p.i));
  let bestX=tolerance+.0001,bestY=tolerance+.0001,xGuide:number|undefined,yGuide:number|undefined,adjustX=0,adjustY=0;
  for(const index of selected) {
    const box=layoutBounds([photos[index]]);
    for(const other of others) {
      for(const moving of [box.x+dx,box.x+box.width+dx]) for(const target of [other.box.x,other.box.x+other.box.width]) if(Math.abs(target-moving)<bestX) {bestX=Math.abs(target-moving);adjustX=target-moving;xGuide=target;}
      for(const moving of [box.y+dy,box.y+box.height+dy]) for(const target of [other.box.y,other.box.y+other.box.height]) if(Math.abs(target-moving)<bestY) {bestY=Math.abs(target-moving);adjustY=target-moving;yGuide=target;}
    }
  }
  return {dx:dx+adjustX,dy:dy+adjustY,xGuide,yGuide};
}
export function paperSizeId(photo: PhotoLayout) {
  return paperSizes.find(size => (Math.abs(photo.width - size.width) < .05 && Math.abs(photo.height - size.height) < .05) || (Math.abs(photo.width - size.height) < .05 && Math.abs(photo.height - size.width) < .05))?.id ?? "custom";
}
export function photoGaps(reference: PhotoLayout, photo: PhotoLayout) {
  const a = layoutBounds([reference]), b = layoutBounds([photo]);
  const right = b.x + b.width / 2 >= a.x + a.width / 2, below = b.y + b.height / 2 >= a.y + a.height / 2;
  return { x: roundMm(right ? b.x - a.x - a.width : a.x - b.x - b.width), y: roundMm(below ? b.y - a.y - a.height : a.y - b.y - b.height), right, below };
}
export function setPhotoGap(reference: PhotoLayout, photo: PhotoLayout, axis: "x" | "y", gap: number) {
  const current = photoGaps(reference, photo), positive = axis === "x" ? current.right : current.below;
  return { ...photo, [axis]: roundMm(photo[axis] + (positive ? 1 : -1) * (gap - current[axis])) };
}
export function arrangePhotos(photos: PhotoLayout[], indices: number[], mode: "grid" | "horizontal" | "vertical", columns: number, gapX: number, gapY: number) {
  const selected = [...new Set(indices)].filter(i => Number.isInteger(i) && photos[i]).sort((a,b) => a-b);
  if (!selected.length) return photos.map(p => ({ ...p }));
  if (![gapX,gapY].every(n => Number.isFinite(n) && n >= 0 && n <= 100000)) throw new Error("間隔は0〜100000mmで入力してください。");
  if (mode === "grid" && (!Number.isInteger(columns) || columns < 1 || columns > 1000)) throw new Error("列数は1〜1000の整数で入力してください。");
  const boxes = selected.map(i => layoutBounds([photos[i]])), cols = mode === "vertical" ? 1 : mode === "horizontal" ? selected.length : Math.max(1, Math.min(selected.length, Math.floor(columns)));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(...boxes.filter((_,i) => i % cols === c).map(b => b.width)));
  const rows = Math.ceil(selected.length / cols), heights = Array.from({ length: rows }, (_, r) => Math.max(...boxes.slice(r*cols, (r+1)*cols).map(b => b.height)));
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  const result = photos.map(p => ({ ...p }));
  selected.forEach((i,n) => {
    const c = n % cols, r = Math.floor(n/cols), x = left + widths.slice(0,c).reduce((a,b) => a+b,0) + c*gapX, y = top + heights.slice(0,r).reduce((a,b) => a+b,0) + r*gapY;
    result[i].x = roundMm(photos[i].x + x - boxes[n].x); result[i].y = roundMm(photos[i].y + y - boxes[n].y);
  });
  return result;
}
function wallUsed(room: RoomLayout, wall: number) { return room.openings.some(o => o.wall === wall) || room.placements.some(p => p.wall === wall) || room.titleBoards?.some(p=>p.surface===`wall:${wall}`) || room.annotations?.some(p=>p.surface===`wall:${wall}`); }
export function insertRoomVertex(room: RoomLayout, wall: number, point?: {x:number;y:number}) {
  if (room.vertices.length >= 32) throw new Error("頂点は32個までです。");
  if (wallUsed(room,wall)) throw new Error("この壁の扉・窓・作品を別の壁へ再配置してから頂点を追加してください。");
  const next = structuredClone(room);ensureRoomPath(next);const physical=roomWalls(next)[wall];
  if(physical?.corner){const walls=roomWalls(next),order=roomOutline(next).ordered,ids=order.map(e=>walls.find(w=>w.nodeIndex===e.index&&w.corner===('radius' in e))!.id),heights=new Map(walls.map(w=>[w.id,w.height]));next.vertices=materializeVectorPath({nodes:next.vertices,closed:true}).nodes;next.wallIds=ids;next.wallHeights=ids.map(id=>heights.get(id)!);syncRoomWallReferences(next);wall=roomWalls(next).find(w=>w.id===physical.id)!.index;}
  if(next.vertices.length>=32)throw new Error('角丸を含め、頂点は32個までです。');
  const a = next.vertices[wall], b = next.vertices[(wall+1)%next.vertices.length];
  if (!a || !b) throw new Error("壁を選択してください。");
  const path=splitPathEdge({nodes:next.vertices,closed:true},wall,point?nearestSegmentT(nodeSegment(a,b),point):.5);next.vertices=path.nodes;
  next.wallIds!.splice(wall+1,0,crypto.randomUUID());
  next.wallHeights.splice(wall+1,0,next.wallHeights[wall]);
  syncRoomWallReferences(next);
  if (!validRoomPath(next)||next.vertices.some((n,i)=>(n.radius??0)>cornerLimit({nodes:next.vertices,closed:true},i)+.01)) throw new Error("交差しない部屋の形にしてください。角丸の半径も確認してください。");
  return next;
}
export function removeRoomVertex(room: RoomLayout, index: number) {
  if (room.vertices.length <= 3) throw new Error("頂点は3個以上必要です。");
  const previous = (index-1+room.vertices.length)%room.vertices.length;
  if (wallUsed(room,index) || wallUsed(room,previous)) throw new Error("隣接する壁の扉・窓・作品を再配置してから頂点を削除してください。");
  const corner=roomWalls(room).find(w=>w.corner&&w.nodeIndex===index);if(corner&&wallUsed(room,corner.index))throw new Error('角の壁面にある配置物を再配置してから頂点を削除してください。');
  const next = structuredClone(room);ensureRoomPath(next);
  next.vertices.splice(index,1); next.wallHeights.splice(index,1);
  next.wallIds!.splice(index,1);const prior=next.vertices[previous>=next.vertices.length?next.vertices.length-1:previous];delete prior.out;delete prior.arc;delete next.vertices[index%next.vertices.length].in;
  syncRoomWallReferences(next);
  if (!validRoomPath(next)) throw new Error("交差しない部屋の形にしてください。");
  return next;
}
export function setRoomWall(room: RoomLayout, wall: number, length: number, angle: number) {
  if (!Number.isFinite(length) || length < 1 || length > 100000 || !Number.isFinite(angle)) throw new Error("壁長は1〜100000mm、角度は数値で入力してください。");
  const next = scaleRoomWall(room,wall,length), physical=roomWalls(next)[wall];
  const actual=Math.atan2(physical.segment.b.y-physical.segment.a.y,physical.segment.b.x-physical.segment.a.x),difference=angle*Math.PI/180-actual,turn=Math.atan2(Math.sin(difference),Math.cos(difference));
  if(physical.corner&&Math.abs(turn)>.01*Math.PI/180)throw new Error('角の向きは直接選択で隣の頂点を動かして変更してください。');
  const a = next.vertices[physical.nodeIndex], target = (physical.nodeIndex+1)%next.vertices.length;
  // Use the unrounded geometry, so entering the displayed angle removes tiny
  // residual turns instead of preserving them or rotating through a full turn.
  if(Math.abs(turn)>1e-12){const b=next.vertices[target],dx=b.x-a.x,dy=b.y-a.y;Object.assign(b,{x:a.x+dx*Math.cos(turn)-dy*Math.sin(turn),y:a.y+dx*Math.sin(turn)+dy*Math.cos(turn)});for(const h of [a.out,b.in])if(h){const x=h.x,y=h.y;h.x=x*Math.cos(turn)-y*Math.sin(turn);h.y=x*Math.sin(turn)+y*Math.cos(turn);}}
  if (!validRoomPath(next)) throw new Error("部屋の壁が交差します。数値を確認してください。");
  syncRoomWallReferences(next);
  return next;
}
export function roomWallAngle(room: RoomLayout, wall: number) { const w=roomWalls(room)[wall];return w?roundMm(Math.atan2(w.segment.b.y-w.segment.a.y,w.segment.b.x-w.segment.a.x)*180/Math.PI):0; }
export { wallLength };
