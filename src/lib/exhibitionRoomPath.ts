import type { RoomLayout, VectorNode } from './exhibitionTypes.ts';
import { compileVectorPath, pointAtLength, segmentLength, segmentTangent, nearestSegmentT, simpleClosedPath, cornerLimit, scale, add, subtract, type VectorSegment } from './exhibitionVector.ts';
export type RoomWall = { id:string; index:number; label:string; height:number; nodeIndex:number; corner:boolean; segment:VectorSegment; length:number };
const cache=new WeakMap<RoomLayout,{key:string;path:ReturnType<typeof compileVectorPath>;walls:RoomWall[]}>();
function compiled(room:RoomLayout) {
  const key=JSON.stringify([room.vertices,room.wallIds,room.wallHeights,room.wallNames]),prior=cache.get(room);if(prior?.key===key)return prior;
  const path=compileVectorPath({nodes:room.vertices,closed:true}),walls:RoomWall[]=path.edges.map(({index,segment})=>{const id=room.wallIds?.[index]??`legacy-wall:${index}`;return{id,index,label:room.wallNames?.[id]||`壁${index+1}`,height:room.wallHeights[index],nodeIndex:index,corner:false,segment,length:segmentLength(segment)};});
  for(const c of path.corners){const id=`corner:${room.vertices[c.index].id??`legacy-${c.index}`}`;walls.push({id,index:walls.length,label:room.wallNames?.[id]||`角${c.index+1}（曲面）`,height:room.vertices[c.index].cornerHeight??Math.min(room.wallHeights[c.index],room.wallHeights[(c.index-1+room.vertices.length)%room.vertices.length]),nodeIndex:c.index,corner:true,segment:c.segment,length:segmentLength(c.segment)});}
  const result={key,path,walls};cache.set(room,result);return result;
}
export const roomWalls=(room:RoomLayout)=>compiled(room).walls;
export const roomOutline=(room:RoomLayout)=>compiled(room).path;
export const wallHeight=(room:RoomLayout,index:number)=>roomWalls(room)[index]?.height??0;
export const roomWallLength=(room:RoomLayout,index:number)=>roomWalls(room)[index]?.length??0;
export const roomWallById=(room:RoomLayout,id:string)=>roomWalls(room).find(w=>w.id===id);
export function roomWallPoint(room:RoomLayout,index:number,offset:number) {
  const wall=roomWalls(room)[index];if(!wall)throw new Error('壁が見つかりません。');
  // Out-of-wall placements still have a useful position for the warning and editor.
  const clamped=Math.max(0,Math.min(wall.length,offset)),p=pointAtLength(wall.segment,clamped),t=clamped===0?0:clamped===wall.length?1:nearestSegmentT(wall.segment,p),v=segmentTangent(wall.segment,t),delta=offset-clamped;
  return {...add(p,scale(v,delta)),tangent:v,angle:Math.atan2(v.y,v.x)*180/Math.PI};
}
export const roomWallOffset=(room:RoomLayout,index:number,p:{x:number;y:number})=>{const wall=roomWalls(room)[index];return wall?segmentLength(wall.segment,0,nearestSegmentT(wall.segment,p)):0;};
export const validRoomPath=(room:RoomLayout)=>room.vertices.length>=3&&room.vertices.length<=32&&simpleClosedPath({nodes:room.vertices,closed:true})&&roomWalls(room).every(w=>w.length>=1);
/** Only call for a user edit. Reading a legacy exhibition never assigns IDs or writes data. */
export function ensureRoomPath(room:RoomLayout) {
  const before=roomWalls(room).map(w=>w.id);
  room.geometryVersion=2;room.vertices.forEach(p=>p.id??=crypto.randomUUID());room.wallIds??=room.vertices.map(()=>crypto.randomUUID());
  const after=roomWalls(room),map=new Map(before.map((id,i)=>[id,after[i]?.id]));
  for(const p of [...room.placements,...room.openings])p.wallId=p.wallId?map.get(p.wallId)??p.wallId:after[p.wall]?.id;
  for(const p of room.titleBoards??[])if(p.surface.startsWith('wall:'))p.wallId=p.wallId?map.get(p.wallId)??p.wallId:after[Number(p.surface.slice(5))]?.id;
  for(const p of [...room.annotations??[],...room.dimensions??[]])if(p.surface?.startsWith('wall:'))p.surfaceWallId=p.surfaceWallId?map.get(p.surfaceWallId)??p.surfaceWallId:after[Number(p.surface.slice(5))]?.id;
  for(const d of room.dimensions??[]){if(d.wallId)d.wallId=map.get(d.wallId)??d.wallId;for(const p of [d.a,d.b])if(p.kind==='wall')p.wallId=map.get(p.wallId)??p.wallId;}
}
export function syncRoomWallReferences(room:RoomLayout) {
  const walls=roomWalls(room),find=(id:string)=>{const w=walls.find(w=>w.id===id);if(!w)throw new Error('変更する壁に配置物があります。別の壁に再配置してから変更してください。');return w.index;};
  for(const p of [...room.placements,...room.openings])if(p.wallId)p.wall=find(p.wallId);
  for(const p of room.titleBoards??[])if(p.wallId)p.surface=`wall:${find(p.wallId)}`;
  for(const p of room.annotations??[])if(p.surfaceWallId)p.surface=`wall:${find(p.surfaceWallId)}`;
  room.dimensions=room.dimensions?.filter(d=>(!d.wallId||walls.some(w=>w.id===d.wallId))&&(!d.surfaceWallId||walls.some(w=>w.id===d.surfaceWallId))&&[d.a,d.b].every(a=>a.kind!=='wall'||walls.some(w=>w.id===a.wallId))&&[d.a,d.b].every(a=>a.kind!=='vertex'||room.vertices.some(n=>n.id===a.nodeId)));
  for(const d of room.dimensions??[])if(d.surfaceWallId)d.surface=`wall:${find(d.surfaceWallId)}`;
  if(room.wallNames){room.wallNames=Object.fromEntries(Object.entries(room.wallNames).filter(([id])=>walls.some(w=>w.id===id)));if(!Object.keys(room.wallNames).length)delete room.wallNames;}
}
export function setRoomWallName(room:RoomLayout,index:number,name:string){
  const value=name.trim();if([...value].length>150||/[\x00-\x1f\x7f]/.test(value))throw new Error('壁の名前は改行を含まない150文字以内で入力してください。');
  ensureRoomPath(room);const wall=roomWalls(room)[index];if(!wall)throw new Error('名前を変更する壁を選択してください。');
  if(value)(room.wallNames??={})[wall.id]=value;else if(room.wallNames){delete room.wallNames[wall.id];if(!Object.keys(room.wallNames).length)delete room.wallNames;}
}
export function setRoomCornerRadius(room:RoomLayout,index:number,radius:number) {
  const next=structuredClone(room);ensureRoomPath(next);const node=next.vertices[index];if(!node)throw new Error('頂点を選択してください。');
  const limit=cornerLimit({nodes:next.vertices,closed:true},index);if(!Number.isFinite(radius)||radius<0||radius>limit+.001)throw new Error(`角丸の半径は0〜${limit.toFixed(1)}mmです。`);
  node.radius=radius;syncRoomWallReferences(next);if(!validRoomPath(next))throw new Error('角丸の壁が交差します。');return next;
}
export function moveVectorNode(node:VectorNode,dx:number,dy:number) {node.x+=dx;node.y+=dy;}
export function roomFromPenPath(nodes:VectorNode[],name='展示室1'):RoomLayout {
  const vertices=structuredClone(nodes);if(vertices.length<3||vertices.length>32||vertices.some(n=>[n,n.in,n.out].filter(Boolean).some(p=>![p!.x,p!.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=100000))))throw new Error('展示室は±100000mm以内、3〜32頂点で描いてください。');
  const room:RoomLayout={id:crypto.randomUUID(),name,vertices,wallHeights:vertices.map(()=>3000),openings:[],placements:[],tables:[],books:[],annotations:[]};ensureRoomPath(room);
  if(!validRoomPath(room)||vertices.some((n,i)=>(n.radius??0)>cornerLimit({nodes:vertices,closed:true},i)+.01))throw new Error('展示室の壁が交差しています。連続した1つの外周になるように描いてください。');return room;
}
export function setRoomWallHeight(room:RoomLayout,index:number,height:number) {const wall=roomWalls(room)[index];if(!wall||!Number.isFinite(height)||height<1||height>100000)throw new Error('壁の高さを確認してください。');if(wall.corner)room.vertices[wall.nodeIndex].cornerHeight=height;else room.wallHeights[wall.nodeIndex]=height;}
export function scaleRoomWall(room:RoomLayout,index:number,newLength:number,fixed:'a'|'b'='a') {
  const next=structuredClone(room);ensureRoomPath(next);const wall=roomWalls(next)[index];if(!wall||!Number.isFinite(newLength)||newLength<1||newLength>100000)throw new Error('壁長は1〜100000mmです。');
  const origin=fixed==='a'?wall.segment.a:wall.segment.b,base=structuredClone(next),n=next.vertices.length;
  const generate=(parameters:number[])=>{const result=structuredClone(base),factor=parameters[0],translation={x:parameters[1],y:parameters[2]},i=wall.nodeIndex;
    if(wall.corner){const node=result.vertices[i],old=base.vertices[i],p=add(add(origin,scale(subtract(old,origin),factor)),translation),delta=subtract(p,old);Object.assign(node,p);node.radius=(old.radius??0)*factor;const neighbor=fixed==='a'?(i+1)%n:(i-1+n)%n;Object.assign(result.vertices[neighbor],add(result.vertices[neighbor],delta));}
    else {const a=result.vertices[i],b=result.vertices[(i+1)%n];for(const node of [a,b])Object.assign(node,add(add(origin,scale(subtract(node,origin),factor)),translation));if(a.out)a.out=scale(a.out,factor);if(a.arc)a.arc.radius*=factor;if(b.in)b.in=scale(b.in,factor);}
    return result;};
  const residual=(p:number[])=>{const result=generate(p),w=roomWalls(result).find(w=>w.id===wall.id);if(!w)throw new Error('曲面の長さを確認してください。');const endpoint=fixed==='a'?w.segment.a:w.segment.b;return[endpoint.x-origin.x,endpoint.y-origin.y,w.length-newLength];};
  let p=[newLength/wall.length,0,0];
  for(let iteration=0;iteration<18;iteration++){const r=residual(p);if(Math.max(...r.map(Math.abs))<.005)break;
    const h=[1e-5,.05,.05],columns=h.map((step,j)=>{const q=p.slice();q[j]+=step;return residual(q).map((v,i)=>(v-r[i])/step);}),matrix=r.map((value,i)=>[columns[0][i],columns[1][i],columns[2][i],-value]);
    for(let j=0;j<3;j++){let pivot=j;for(let i=j+1;i<3;i++)if(Math.abs(matrix[i][j])>Math.abs(matrix[pivot][j]))pivot=i;[matrix[j],matrix[pivot]]=[matrix[pivot],matrix[j]];if(Math.abs(matrix[j][j])<1e-10)throw new Error('この基準では壁長を変更できません。');const factor=matrix[j][j];for(let k=j;k<4;k++)matrix[j][k]/=factor;for(let i=0;i<3;i++)if(i!==j){const f=matrix[i][j];for(let k=j;k<4;k++)matrix[i][k]-=f*matrix[j][k];}}
    p=p.map((value,i)=>value+matrix[i][3]);if(p[0]<=0||p[0]>1000||p.some(v=>!Number.isFinite(v)))throw new Error('指定した壁長に変更できません。');
  }
  const result=generate(p);if(Math.max(...residual(p).map(Math.abs))>.05||!validRoomPath(result))throw new Error('壁長の変更で部屋が交差します。');
  for(let i=0;i<result.vertices.length;i++)if((result.vertices[i].radius??0)>cornerLimit({nodes:result.vertices,closed:true},i)+.01)throw new Error('壁長の変更で角丸が隣の壁を超えます。');
  syncRoomWallReferences(result);return result;
}
