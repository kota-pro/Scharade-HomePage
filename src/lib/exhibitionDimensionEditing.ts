import type {RoomLayout,LayoutWork,LayoutDimension,DimensionAnchor} from './exhibitionTypes.ts';
import {dimensionGeometry} from './exhibitionDimensions.ts';
import {layoutObjects,translateLayoutObjects,editorMetadata,objectLocked} from './exhibitionLayoutModel.ts';
import {scaleRoomWall,roomWallById,validRoomPath,syncRoomWallReferences} from './exhibitionRoomPath.ts';
export function changeDimension(room:RoomLayout,works:LayoutWork[],id:string,value:number,fixed:'a'|'b') {
  const next=structuredClone(room),d=next.dimensions?.find(d=>d.id===id);if(!d||!Number.isFinite(value)||value<1||value>100000)throw new Error('距離は1〜100000mmで入力してください。');
  if(objectLocked(next,`dimension:${id}`))throw new Error('寸法レイヤーのロックを解除してください。');
  if(d.wallId){const wall=roomWallById(next,d.wallId);if(!wall)throw new Error('壁が見つかりません。');return scaleRoomWall(next,wall.index,value,fixed);}
  const objects=layoutObjects(next,works,d.surface),g=dimensionGeometry(next,d,objects);if(!g)throw new Error('測定対象が見つかりません。');
  const held=fixed==='a'?g.a:g.b,moving=fixed==='a'?g.b:g.a,anchor=fixed==='a'?d.b:d.a,other=fixed==='a'?d.a:d.b,length=Math.hypot(moving.x-held.x,moving.y-held.y);
  if(length<.001)throw new Error('方向の異なる2点を測定してください。');const delta={x:(moving.x-held.x)*(value/length-1),y:(moving.y-held.y)*(value/length-1)};
  if(anchor.kind==='free'){anchor.x+=delta.x;anchor.y+=delta.y;}
  else if(anchor.kind==='vertex'){const node=next.vertices.find(n=>n.id===anchor.nodeId);if(!node)throw new Error('頂点が見つかりません。');node.x+=delta.x;node.y+=delta.y;if(!validRoomPath(next))throw new Error('壁が交差するため距離を変更できません。');syncRoomWallReferences(next);}
  else if(anchor.kind==='object'){
    let ids=[anchor.objectId];const group=editorMetadata(next).groups.find(g=>g.objectIds.includes(anchor.objectId));
    if(group&&!(other.kind==='object'&&group.objectIds.includes(other.objectId)))ids=group.objectIds.filter(id=>objects.some(o=>o.id===id));
    if(other.kind==='object'&&other.objectId===anchor.objectId)throw new Error('同じ物の寸法は四隅のハンドルかプロパティから変更してください。');
    if(ids.some(id=>objectLocked(next,id)))throw new Error('移動する項目のロックを解除してください。');translateLayoutObjects(next,works,d.surface,ids,delta.x,delta.y);
  }else throw new Error('壁の長さは壁全体の寸法から変更してください。');
  const after=dimensionGeometry(next,d,layoutObjects(next,works,d.surface));if(!after||Math.abs(after.value-value)>.05)throw new Error('この方向では対象を移動できません。');return next;
}
