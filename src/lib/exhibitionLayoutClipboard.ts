import { wallSurface, wallSurfacePart, wallSurfaceAt, wallViewSource, storeWallViewAnnotation } from "./exhibitionWallSurfaces.ts";
import type {RoomLayout,LayoutWork,DimensionAnchor,VectorPath} from './exhibitionTypes.ts';
import {layoutObjects,ensureEditorMetadata,cleanEditorMetadata,type LayoutObject} from './exhibitionLayoutModel.ts';
import {dimensionGeometry} from './exhibitionDimensions.ts';
import {roomWalls,ensureRoomPath} from './exhibitionRoomPath.ts';
import {syncWallEquipment,wallEquipmentHeight} from './exhibitionWallEquipment.ts';
import {boardSurface} from './exhibitionBoards.ts';
import {reusableRoom} from './exhibitionRoomReuse.ts';
export type LayoutClipboard={room:RoomLayout;view:string;ids:string[];wholeRoom:boolean;points:Record<string,{a:{x:number;y:number};b:{x:number;y:number}}>};
const kinds=new Set(['annotation','table','board','opening','dimension']);
const clone=<T>(v:T):T=>structuredClone(v),uid=()=>crypto.randomUUID();
export function copyLayoutSelection(room:RoomLayout,works:LayoutWork[],view:string,selected:LayoutObject[],wholeRoom=false):LayoutClipboard|undefined{
  const ids=selected.filter(o=>kinds.has(o.kind)).map(o=>o.id);if(!wholeRoom&&!ids.length)return;
  const points:LayoutClipboard['points']={};
  for(const d of room.dimensions??[]){const g=dimensionGeometry(room,d,layoutObjects({...room,dimensions:[]},works,d.surface));if(g)points[d.id]={a:g.a,b:g.b};}
  return{room:clone(room),view,ids,wholeRoom,points};
}
export const pasteLayoutRoom=(clipboard:LayoutClipboard)=>reusableRoom(clipboard.room,`${clipboard.room.name.slice(0,140)}（複製）`,true);
/** New venue identities; submitted works and their title boards never duplicate. */
export function pasteLayoutSelection(room:RoomLayout,view:string,clipboard:LayoutClipboard,offset=100){
  if(clipboard.wholeRoom)throw new Error('展示室として追加してください。');
  const next=clone(room),source=clipboard.room,ids=new Set(clipboard.ids),map=new Map<string,string>(),selected:string[]=[];
  ensureRoomPath(next);
  const owned=(key:string)=>key.startsWith('board:')&&ids.has(`board:${key.split(':')[1]}`);
  for(const a of source.annotations??[])if(owned(a.surface??'floor'))ids.add(`annotation:${a.id}`);
  for(const d of source.dimensions??[])if(owned(d.surface))ids.add(`dimension:${d.id}`);
  for(const id of ids)map.set(id,`${id.split(':')[0]}:${uid()}`);
  const fresh=(path:VectorPath|undefined)=>{if(path)path.nodes.forEach(n=>n.id=uid());};
  const surface=(key:string)=>owned(key)?`${map.get(`board:${key.split(':')[1]}`)}:${key.split(':')[2]}`:view;
  const wall=view.startsWith('wall:')?roomWalls(next)[Number(view.slice(5))]:undefined;
  const chooseWall=(index:number,id?:string)=>wall??roomWalls(next).find(w=>w.id===id)??roomWalls(next)[Math.min(index,roomWalls(next).length-1)];
  for(const old of source.boardGroups??[])if(ids.has(`board:${old.id}`))for(const p of old.panels)map.set(`panel:${p.id}`,`panel:${uid()}`);
  for(const id of ids){const [kind,value]=id.split(':'),newId=map.get(id)!.split(':')[1];
    if(kind==='annotation'){
      const old=source.annotations?.find(a=>a.id===value);if(!old)throw new Error('元の図形が見つかりません。');const a=clone({...wallViewSource(source,old.surface??'floor',old,['x','y'])}),attached=owned(a.surface??'floor');
      a.id=newId;a.surface=surface(a.surface??'floor');delete a.surfaceWallId;if(a.surface.startsWith('wall:'))a.surfaceWallId=wall!.id;
      if(!attached){a.x+=offset;a.y+=offset;}fresh(a.path);(next.annotations??=[]).push(storeWallViewAnnotation(next,a));
    }else if(kind==='table'||kind==='board'){
      if(view.startsWith('board:'))throw new Error('展示台・展示ボードは平面図か壁面図へ配置してください。');
      const old=kind==='table'?source.tables.find(t=>t.id===value):source.boardGroups?.find(g=>g.id===value);if(!old)throw new Error('元の設備が見つかりません。');const item=clone(old);item.id=newId;
      if('panels'in item)item.panels.forEach(p=>p.id=map.get(`panel:${p.id}`)!.slice(6));
      if(wall){const width='panels'in item?boardSurface(item,'A').width:item.width,height=wallEquipmentHeight(item),run=wallSurface(next,view)!;if(width>run.width||height>run.height)throw new Error('設備の大きさが配置先の壁に収まりません。');const oldWall=old.attachment&&roomWalls(source).find(w=>w.id===old.attachment!.wallId),x=Math.max(0,Math.min(run.width-width,(old.attachment?(wallSurfacePart(source,oldWall?.index??-1)?.left??0)+old.attachment.offset:old.x)+offset)),part=wallSurfaceAt(next,view,x)!;item.attachment={wallId:part.wall.id,offset:x-part.left,distance:old.attachment?.distance??0,bottom:Math.max(0,Math.min(run.height-height,(old.attachment?.bottom??0)-offset))};}
      else{delete item.attachment;item.x+=offset;item.y+=offset;}
      if('panels'in item)(next.boardGroups??=[]).push(item);else next.tables.push(item);
    }else if(kind==='opening'){
      const old=source.openings.find(o=>o.id===value);if(!old)throw new Error('元の開口部が見つかりません。');
      if(view.startsWith('board:'))throw new Error('扉・窓は平面図か壁面図へ配置してください。');
      const target=chooseWall(old.wall,old.wallId),o=clone(old),run=target&&wallSurface(next,target.index);if(!target||!run||o.width>run.width||o.height>run.height)throw new Error('扉・窓の大きさが配置先の壁に収まりません。');
      const x=Math.max(0,Math.min(run.width-o.width,wallViewSource(source,`wall:${old.wall}`,old,['offset']).offset+offset)),part=wallSurfaceAt(next,`wall:${target.index}`,x)!;o.id=newId;o.wall=part.wall.index;o.wallId=part.wall.id;o.offset=x-part.left;o.bottom=Math.max(0,Math.min(run.height-o.height,o.bottom-(view==='floor'?0:offset)));fresh(o.visualPath);next.openings.push(o);
    }
    if(clipboard.ids.includes(id))selected.push(map.get(id)!);
  }
  for(const old of source.dimensions??[])if(ids.has(`dimension:${old.id}`)){
    const d=clone(old),delta=owned(d.surface)?0:offset;d.id=map.get(`dimension:${old.id}`)!.slice(10);d.surface=surface(d.surface);delete d.wallId;delete d.surfaceWallId;if(d.surface.startsWith('wall:'))d.surfaceWallId=wall!.id;
    const anchor=(a:DimensionAnchor,key:'a'|'b'):DimensionAnchor=>{
      if(a.kind==='object'&&map.has(a.objectId))return{...a,objectId:map.get(a.objectId)!,...(a.feature?{feature:{...a.feature,key:map.get(a.feature.key)??a.feature.key}}:{})};
      if(a.kind==='panel'&&map.has(`panel:${a.panelId}`))return{...a,panelId:map.get(`panel:${a.panelId}`)!.slice(6)};
      const point=clipboard.points[old.id]?.[key];if(!point)throw new Error('測定対象の位置が見つかりません。');const part=wallSurfacePart(next,d.surface);return{kind:'free',x:point.x+delta-(part?.left??0),y:point.y+delta-(part?.top??0)};
    };
    d.a=anchor(old.a,'a');d.b=anchor(old.b,'b');(next.dimensions??=[]).push(d);
  }
  const metadata=ensureEditorMetadata(next),oldMetadata=source.editor;
  metadata.order.push(...(oldMetadata?.order??[]).filter(id=>map.has(id)).map(id=>map.get(id)!));
  for(const key of ['hidden','locked'] as const)metadata[key].push(...(oldMetadata?.[key]??[]).filter(id=>map.has(id)).map(id=>map.get(id)!));
  for(const group of oldMetadata?.groups??[]){const objectIds=group.objectIds.filter(id=>map.has(id)).map(id=>map.get(id)!);if(objectIds.length>1)metadata.groups.push({...clone(group),id:uid(),objectIds});}
  for(const label of source.labelPositions??[])if(map.has(label.target))(next.labelPositions??=[]).push({...clone(label),id:uid(),target:map.get(label.target)!,surface:surface(label.surface)});
  if((next.annotations?.length??0)>200||next.tables.length>100||(next.boardGroups?.length??0)>100||next.openings.length>100||(next.dimensions?.length??0)>200)throw new Error('図形・設備の数が上限を超えます。不要なものを削除してください。');
  for(const a of next.annotations??[])if(![a.x,a.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=100000))throw new Error('配置位置は±100000mm以内にしてください。');
  syncWallEquipment(next);cleanEditorMetadata(next);return{room:next,selected};
}
