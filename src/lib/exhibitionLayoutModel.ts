import { wallSurface, wallSurfaceKey, wallSurfaceContains, sameWallSurface, wallViewSource } from "./exhibitionWallSurfaces.ts";
import {scaleLayoutText} from './exhibitionTypographyUnits.ts';
import {cleanLayoutLabelPositions} from './exhibitionLabelPositions.ts';
import {objectMeasurementPolygons,type MeasurementPolygon} from './exhibitionMeasurementGeometry.ts';
import {wallEquipmentBox,moveWallEquipment,syncWallEquipment} from './exhibitionWallEquipment.ts';
import {openingPathBounds,resizeOpeningPath} from './exhibitionOpeningPath.ts';
import {compileVectorPath} from './exhibitionVector.ts';
import { dimensionGeometry } from './exhibitionDimensions.ts';
import { roomWalls, roomWallPoint, roomWallOffset, validRoomPath } from './exhibitionRoomPath.ts';
import { annotationWorldBounds, annotationLocalBounds } from './exhibitionAnnotationPath.ts';
import { roomSymbolLabels } from './exhibitionRoomSymbols.ts';
import { boardChain, boardSurface } from './exhibitionBoards.ts';
import { layoutBounds, placedPhotos, rotatedCorners, validPolygon } from './exhibitionGeometry.ts';
import type { RoomLayout, LayoutWork, LayoutEditorMetadata, TitleBoardPlacement } from './exhibitionTypes.ts';

import { titleBoardSize, titleBoardBounds } from './exhibitionTitleBoardLayout.ts';
export { titleBoardSize } from './exhibitionTitleBoardLayout.ts';
export type LayoutPoint = { x: number; y: number };
export type LayoutBox = LayoutPoint & { width: number; height: number };
export type LayoutObject = { id: string; kind: string; label: string; frame: string; box: LayoutBox; rotation: number; movable: boolean; resizable: boolean; rotatable: boolean; source: any; measurementPolygons?:MeasurementPolygon[] };
export const layoutId = (kind: string, id: string) => `${kind}:${id}`;
const round = (v: number) => Math.round(v * 1000) / 1000;
export function boundsOf(points: LayoutPoint[]): LayoutBox {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return { x:Math.min(...xs), y:Math.min(...ys), width:Math.max(...xs)-Math.min(...xs), height:Math.max(...ys)-Math.min(...ys) };
}
export function rotatedBox(x:number,y:number,width:number,height:number,rotation:number) { return boundsOf(rotatedCorners(width,height,rotation).map(p=>({x:x+p.x,y:y+p.y}))); }
export const boxCenter=(b:LayoutBox)=>({x:b.x+b.width/2,y:b.y+b.height/2});
export const intersects=(a:LayoutBox,b:LayoutBox)=>a.x<=b.x+b.width&&a.x+a.width>=b.x&&a.y<=b.y+b.height&&a.y+a.height>=b.y;
export function editorMetadata(room: RoomLayout): LayoutEditorMetadata { return room.editor ?? { order:[],hidden:[],locked:[],groups:[] }; }
export function ensureEditorMetadata(room: RoomLayout) { return room.editor ??= { order:[],hidden:[],locked:[],groups:[] }; }
export function layoutObjectIds(room:RoomLayout) {
  return [...room.dimensions?.map(d=>layoutId('dimension',d.id))??[],...room.annotations?.map(a=>layoutId('annotation',a.id))??[],...room.tables.map(t=>layoutId('table',t.id)),...room.openings.map(o=>layoutId('opening',o.id)),...(room.boardGroups??[]).map(g=>layoutId('board',g.id)),...room.placements.map(p=>layoutId('work',p.workId)),...(room.boardPlacements??[]).map(p=>layoutId('work',p.workId)),...room.books.map(p=>layoutId('book',p.workId)),...(room.titleBoards??[]).map(p=>layoutId('titleboard',p.id))];
}
export function parentLayoutId(room:RoomLayout,id:string):string|undefined {
  const [kind,value]=id.split(':');
  if(kind==='book') {const b=room.books.find(b=>b.workId===value);if(b)return layoutId('table',b.tableId);}
  const p=kind==='work'?(room.boardPlacements??[]).find(p=>p.workId===value):kind==='titleboard'?(room.titleBoards??[]).find(p=>p.id===value):undefined;
  if(p&&'groupId' in p)return layoutId('board',p.groupId);
  if(p&&'surface' in p&&p.surface.startsWith('board:'))return layoutId('board',p.surface.split(':')[1]);
}
export function objectHidden(room:RoomLayout,id:string):boolean {
  const hidden=editorMetadata(room).hidden;
  const parent=parentLayoutId(room,id);
  return hidden.includes(id)||!!parent&&hidden.includes(parent);
}
export function objectLocked(room:RoomLayout,id:string):boolean {
  const locked=editorMetadata(room).locked,parent=parentLayoutId(room,id);
  return locked.includes(id)||!!parent&&locked.includes(parent);
}
export function orderedObjects<T extends {id:string}>(room:RoomLayout,objects:T[],includeHidden=false):T[] {
  const order=editorMetadata(room).order,rank=(id:string)=>{const index=order.indexOf(id);return index<0?-1:index;};
  return objects.filter(o=>includeHidden||!objectHidden(room,o.id)).sort((a,b)=>rank(a.id)-rank(b.id));
}
export function cleanEditorMetadata(room:RoomLayout) {
  cleanLayoutLabelPositions(room);
  if(!room.editor)return;
  const known=new Set(layoutObjectIds(room)),m=room.editor;
  for(const key of ['order','hidden','locked'] as const)m[key]=[...new Set(m[key])].filter(id=>known.has(id));
  m.groups=m.groups.map(g=>({...g,objectIds:[...new Set(g.objectIds)].filter(id=>known.has(id))})).filter(g=>g.objectIds.length>1);
}
export function surfaceHeight(room:RoomLayout,key:string) {
  if(key.startsWith('wall:'))return wallSurface(room,key)?.height??0;
  const group=room.boardGroups?.find(g=>g.id===key.split(':')[1]);return group?boardSurface(group,key.endsWith(':B')?'B':'A').height:0;
}
export function titleBoardBox(room:RoomLayout,card:TitleBoardPlacement) {return titleBoardBounds(wallViewSource(room,card.surface,card),surfaceHeight(room,card.surface));}
export function placementSurface(room:RoomLayout,workId:string) {
  const p=room.placements.find(p=>p.workId===workId);if(p)return wallSurfaceKey(room,`wall:${p.wall}`);
  const b=room.boardPlacements?.find(p=>p.workId===workId);if(b)return `board:${b.groupId}:${b.face}`;
}
export function layoutObjects(room:RoomLayout,works:LayoutWork[],view='floor'):LayoutObject[] {
  view=wallSurfaceKey(room,view);
  const result:LayoutObject[]=[],workMap=new Map(works.map(w=>[w.id,w]));
  const add=(kind:string,id:string,label:string,frame:string,box:LayoutBox,source:any,resizable=false,rotatable=true,movable=true)=>result.push({id:layoutId(kind,id),kind,label,frame,box,source,rotation:source.rotation??0,resizable,rotatable:rotatable&&!source.attachment,movable});
  for(const a of room.annotations??[])if(sameWallSurface(room,a.surface??'floor',view)){const source=wallViewSource(room,a.surface??'floor',a,['x','y']);add('annotation',a.id,a.name||a.text||roomSymbolLabels[a.kind],view,annotationWorldBounds(source),source,true);}
  if(view==='floor') {

    for(const t of room.tables)add('table',t.id,t.name,'floor',rotatedBox(t.x,t.y,t.width,t.depth,t.rotation),t,true);
    for(const g of room.boardGroups??[])add('board',g.id,g.name,'floor',boundsOf(boardChain(g).flatMap(p=>p.polygon)),g);
    for(const o of room.openings){const box=openingPathBounds(room,o);box.height=Math.max(100,box.height);box.width=Math.max(100,box.width);add('opening',o.id,o.name||(o.kind==='door'?'扉':'窓'),`floor-wall:${o.wall}`,box,o,false,false);}
    for(const p of room.placements){const at=roomWallPoint(room,p.wall,p.x);add('work',p.workId,workMap.get(p.workId)?.title??'作品',`floor-wall:${p.wall}`,{x:at.x-40,y:at.y-40,width:80,height:80},p,false,false);}
    for(const book of room.books){const t=room.tables.find(t=>t.id===book.tableId);if(!t)continue;const a=t.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),points=rotatedCorners(book.width,book.depth,book.rotation).map(p=>({x:p.x+book.x,y:p.y+book.y})).map(p=>({x:t.x+p.x*c-p.y*s,y:t.y+p.x*s+p.y*c}));add('book',book.workId,workMap.get(book.workId)?.title??'ブック',`table:${t.id}`,boundsOf(points),book,false,true);}
  } else {
    const h=surfaceHeight(room,view),placements=view.startsWith('wall:')?room.placements.filter(p=>sameWallSurface(room,`wall:${p.wall}`,view)).map(p=>wallViewSource(room,`wall:${p.wall}`,p)):(room.boardPlacements??[]).filter(p=>`board:${p.groupId}:${p.face}`===view);
    for(const p of placements){const w=workMap.get(p.workId);if(w)add('work',p.workId,w.title,view,layoutBounds(placedPhotos(w,p,h)),p);}
    for(const t of room.tables){const b=wallEquipmentBox(room,t,view);if(b)add('table',t.id,t.name,view,b,t,true);}
    for(const g of room.boardGroups??[]){const b=wallEquipmentBox(room,g,view);if(b)add('board',g.id,g.name,view,b,g,false,true);}
    if(view.startsWith('wall:'))for(const raw of room.openings.filter(o=>sameWallSurface(room,`wall:${o.wall}`,view))){const o=wallViewSource(room,`wall:${raw.wall}`,raw,['offset']);add('opening',o.id,o.name||(o.kind==='door'?'扉':'窓'),view,{x:o.offset,y:h-o.bottom-o.height,width:o.width,height:o.height},o,true,false);}
    for(const card of room.titleBoards??[])if(sameWallSurface(room,card.surface,view))add('titleboard',card.id,`タイトルボード：${workMap.get(card.workId)?.title??'作品'}`,view,titleBoardBox(room,card),wallViewSource(room,card.surface,card));
  }
  for(const o of result)o.measurementPolygons=objectMeasurementPolygons(room,works,view,o);
  for(const d of room.dimensions??[])if(sameWallSurface(room,d.surface,view)){const geometry=dimensionGeometry(room,d,result);if(geometry)add('dimension',d.id,'寸法',view,geometry.box,d,false,false);}
  return orderedObjects(room,result,true);
}
export function selectedLayoutObjects(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],individual=false) {
  const expanded=new Set(ids);
  if(!individual)for(const g of editorMetadata(room).groups)if(g.objectIds.some(id=>expanded.has(id)))g.objectIds.forEach(id=>expanded.add(id));
  return layoutObjects(room,works,view).filter(o=>expanded.has(o.id)&&!objectHidden(room,o.id)&&!objectLocked(room,o.id));
}
export function selectionBounds(objects:LayoutObject[]) {return boundsOf(objects.flatMap(o=>[{x:o.box.x,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y+o.box.height}]));}
export function translateLayoutObjects(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],dx:number,dy:number) {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id));
  const selected=new Set(objects.map(o=>o.id));
  for(const o of objects){if(!o.movable||objectLocked(room,o.id))continue;const p=o.source;if((o.kind==='table'||o.kind==='board')&&moveWallEquipment(room,p,view,dx,dy))continue;
    if(o.kind==='dimension'){const geometry=dimensionGeometry(room,p,objects);if(geometry){const vx=geometry.b.x-geometry.a.x,vy=geometry.b.y-geometry.a.y,l=Math.hypot(vx,vy)||1;p.offset=round(p.offset+(-vy*dx+vx*dy)/l);}continue;}
    if(o.kind==='book') {if(selected.has(layoutId('table',p.tableId)))continue;const t=room.tables.find(t=>t.id===p.tableId)!,a=-t.rotation*Math.PI/180;p.x=round(p.x+dx*Math.cos(a)-dy*Math.sin(a));p.y=round(p.y+dx*Math.sin(a)+dy*Math.cos(a));}
    else if(view==='floor'&&(o.kind==='work'||o.kind==='opening')){const at=roomWallPoint(room,p.wall,o.kind==='work'?p.x:p.offset),next=roomWallOffset(room,p.wall,{x:at.x+dx,y:at.y+dy}),delta=next-(o.kind==='work'?p.x:p.offset);if(o.kind==='work'){p.x=round(p.x+delta);for(const card of room.titleBoards??[])if(card.workId===p.workId&&editorMetadata(room).groups.some(g=>g.objectIds.includes(o.id)&&g.objectIds.includes(layoutId('titleboard',card.id))))card.x=round(card.x+delta);}else p.offset=round(p.offset+delta);}
    else if(o.kind==='opening'){p.offset=round(p.offset+dx);p.bottom=round(p.bottom-dy);}
    else if(o.kind==='annotation'){p.x=round(p.x+dx);p.y=round(p.y+dy);}
    else if(view!=='floor'){p.x=round(p.x+dx);p.bottom=round(p.bottom-dy);}
    else {p.x=round(p.x+dx);p.y=round(p.y+dy);}
  }
}
export function rotateLayoutObjects(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],degrees:number,center=boxCenter(selectionBounds(layoutObjects(room,works,view).filter(o=>ids.includes(o.id))))) {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id));
  if(objects.some(o=>!o.rotatable||objectLocked(room,o.id)||!!o.source.attachment))throw new Error('選択した項目はまとめて回転できません。');
  const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  for(const o of objects){const p=o.source;
    if(view!=='floor'&&o.kind!=='annotation') {
      const old=boxCenter(o.box),nx=center.x+(old.x-center.x)*c-(old.y-center.y)*s,ny=center.y+(old.x-center.x)*s+(old.y-center.y)*c;
      p.rotation=round(((p.rotation+degrees+540)%360)-180);
      const next=layoutObjects(room,works,view).find(v=>v.id===o.id)!;
      p.x=round(nx-next.box.width/2);p.bottom=round(surfaceHeight(room,view)-ny-next.box.height/2);continue;
    }
    if(o.kind==='book'&&ids.includes(layoutId('table',p.tableId)))continue;
    let x=p.x,y=p.y;
    if(o.kind==='book'){const t=room.tables.find(t=>t.id===p.tableId)!,a=t.rotation*Math.PI/180; x=t.x+p.x*Math.cos(a)-p.y*Math.sin(a);y=t.y+p.x*Math.sin(a)+p.y*Math.cos(a);}
    const nx=center.x+(x-center.x)*c-(y-center.y)*s,ny=center.y+(x-center.x)*s+(y-center.y)*c;
    if(o.kind==='book'){const t=room.tables.find(t=>t.id===p.tableId)!,a=-t.rotation*Math.PI/180;p.x=round((nx-t.x)*Math.cos(a)-(ny-t.y)*Math.sin(a));p.y=round((nx-t.x)*Math.sin(a)+(ny-t.y)*Math.cos(a));}
    else {p.x=round(nx);p.y=round(ny);}
    p.rotation=round(((p.rotation+degrees+540)%360)-180);
  }
}
export function resizeLayoutObject(room:RoomLayout,works:LayoutWork[],view:string,id:string,width:number,height:number) {
  const o=layoutObjects(room,works,view).find(o=>o.id===id);
  if(!o||!o.resizable||objectLocked(room,id))throw new Error('この項目の実寸はキャンバスで変更できません。');
  if(![width,height].every(n=>Number.isFinite(n)&&n>=1&&n<=100000))throw new Error('寸法は1〜100000mmで入力してください。');
  if(o.kind==='annotation'&&o.source.kind==='text'){
    const b=annotationLocalBounds(o.source),sx=width/b.width,sy=height/b.height,factor=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;
    scaleLayoutText(o.source,factor);return;
  }
  if(o.kind==='annotation'&&o.source.kind!=='text'&&o.source.text){const a=o.source,b=annotationLocalBounds(a),sx=width/b.width,sy=height/b.height;a.width*=sx;a.height*=sy;a.textScaleX=(a.textScaleX??1)*sx;a.textScaleY=(a.textScaleY??1)*sy;if(a.path)for(const n of a.path.nodes){n.x*=sx;n.y*=sy;for(const h of [n.in,n.out])if(h){h.x*=sx;h.y*=sy;}if(n.radius)n.radius*=Math.min(sx,sy);if(n.arc)n.arc.radius*=Math.min(sx,sy);}return;}
  if(o.kind==='opening'){resizeOpeningPath(o.source,width);o.source.width=round(width);o.source.height=round(height);}
  else {if(o.source.path){const bounds=compileVectorPath(o.source.path).bounds,vertical=bounds.width<1e-8,horizontal=bounds.height<1e-8,pad=vertical?width:horizontal?height:o.source.strokeWidth??0;if((!vertical&&width<=pad)||(!horizontal&&height<=pad)||((vertical||horizontal)&&pad>1000))throw new Error('線の太さは1000mm以下で、線の長さより小さくしてください。');if(vertical||horizontal)o.source.strokeWidth=pad;const sx=vertical?1:(width-pad)/bounds.width,sy=horizontal?1:(height-pad)/bounds.height;for(const node of o.source.path.nodes){node.x*=sx;node.y*=sy;for(const key of ['in','out'])if(node[key]){node[key].x*=sx;node[key].y*=sy;}if(node.radius)node.radius*=Math.min(sx,sy);if(node.arc)node.arc.radius*=Math.min(sx,sy);}}o.source.width=round(width);if(o.kind==='table'){if(view==='floor')o.source.depth=round(height);else o.source.height=round(height);syncWallEquipment(room);}else o.source.height=round(height);}
}
export function addWorkTitleBoardPair(room:RoomLayout,work:LayoutWork,surface:string,workPoint:LayoutPoint,cardPoint:LayoutPoint,cardId=crypto.randomUUID(),groupId=crypto.randomUUID()) {
  if(placementSurface(room,work.id)||room.books.some(p=>p.workId===work.id))throw new Error('この作品は配置済みです。');
  if(work.kind==='book')throw new Error('ブックは展示台に配置してください。');
  const h=surfaceHeight(room,surface);if(!h)throw new Error('配置先の壁面を確認してください。');
  const workBox=layoutBounds(work.photos),p={workId:work.id,x:round(workPoint.x),bottom:round(h-workPoint.y-workBox.height),rotation:0};
  if(surface.startsWith('wall:'))room.placements.push({...p,wall:Number(surface.split(':')[1])});
  else {const [,boardId,face]=surface.split(':');(room.boardPlacements??=[]).push({...p,groupId:boardId,face:face as 'A'|'B'});}
  const card:TitleBoardPlacement={id:cardId,workId:work.id,surface,x:round(cardPoint.x),bottom:round(h-cardPoint.y-titleBoardSize.height),rotation:0};(room.titleBoards??=[]).push(card);
  ensureEditorMetadata(room).groups.push({id:groupId,name:`${work.title}＋タイトルボード`,objectIds:[layoutId('work',work.id),layoutId('titleboard',cardId)]});return card;
}
export function removeLayoutObjects(room:RoomLayout,ids:string[]) {
  for(const id of ids){const [kind,value]=id.split(':');
    if(kind==='work'){room.placements=room.placements.filter(p=>p.workId!==value);room.boardPlacements=room.boardPlacements?.filter(p=>p.workId!==value);room.titleBoards=room.titleBoards?.filter(p=>p.workId!==value);}
    if(kind==='titleboard')room.titleBoards=room.titleBoards?.filter(p=>p.id!==value);
    if(kind==='dimension')room.dimensions=room.dimensions?.filter(d=>d.id!==value);
    if(kind==='annotation')room.annotations=room.annotations?.filter(a=>a.id!==value);
    if(kind==='opening')room.openings=room.openings.filter(a=>a.id!==value);
    if(kind==='book')room.books=room.books.filter(a=>a.workId!==value);
    if(kind==='table'){room.tables=room.tables.filter(a=>a.id!==value);room.books=room.books.filter(a=>a.tableId!==value);}
    if(kind==='board'){room.annotations=room.annotations?.filter(a=>!a.surface?.startsWith(`board:${value}:`));room.dimensions=room.dimensions?.filter(d=>!d.surface.startsWith(`board:${value}:`));room.boardGroups=room.boardGroups?.filter(a=>a.id!==value);const removed=new Set(room.boardPlacements?.filter(p=>p.groupId===value).map(p=>p.workId));room.boardPlacements=room.boardPlacements?.filter(a=>a.groupId!==value);room.titleBoards=room.titleBoards?.filter(a=>!removed.has(a.workId)&&!a.surface.startsWith(`board:${value}:`));}
  }const known=new Set(layoutObjectIds(room));room.dimensions=room.dimensions?.filter(d=>[d.a,d.b].every(a=>a.kind!=='object'||known.has(a.objectId)));cleanEditorMetadata(room);
}
function alignmentUnits(room:RoomLayout,objects:LayoutObject[],individual:boolean) {
  const used=new Set<string>(),units:{ids:string[];box:LayoutBox}[]=[];
  if(!individual)for(const g of editorMetadata(room).groups){const items=objects.filter(o=>g.objectIds.includes(o.id));if(items.length>1){units.push({ids:items.map(o=>o.id),box:selectionBounds(items)});items.forEach(o=>used.add(o.id));}}
  objects.filter(o=>!used.has(o.id)).forEach(o=>units.push({ids:[o.id],box:o.box}));return units;
}
export function alignLayoutObjects(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],mode:string,target?:LayoutBox,individual=false) {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id)&&!objectLocked(room,o.id));if(!objects.length)return;
  const box=target??selectionBounds(objects);
  for(const o of alignmentUnits(room,objects,individual)){const b=o.box;let dx=0,dy=0;if(mode==='left')dx=box.x-b.x;if(mode==='right')dx=box.x+box.width-b.x-b.width;if(mode==='centerX')dx=box.x+box.width/2-b.x-b.width/2;if(mode==='top')dy=box.y-b.y;if(mode==='bottom')dy=box.y+box.height-b.y-b.height;if(mode==='centerY')dy=box.y+box.height/2-b.y-b.height/2;translateLayoutObjects(room,works,view,o.ids,dx,dy);}
}
export function distributeLayoutObjects(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],axis:'x'|'y',gap?:number,individual=false) {
  const selected=layoutObjects(room,works,view).filter(o=>ids.includes(o.id)&&!objectLocked(room,o.id)),objects=alignmentUnits(room,selected,individual).sort((a,b)=>a.box[axis]-b.box[axis]);if(objects.length<2)return;
  const size=axis==='x'?'width':'height',first=objects[0].box,last=objects.at(-1)!.box;
  const spacing=gap??(last[axis]+last[size]-first[axis]-objects.reduce((sum,o)=>sum+o.box[size],0))/(objects.length-1);
  if(!Number.isFinite(spacing))throw new Error('間隔を確認してください。');let position=first[axis];
  for(const o of objects){translateLayoutObjects(room,works,view,o.ids,axis==='x'?position-o.box.x:0,axis==='y'?position-o.box.y:0);position+=o.box[size]+spacing;}
}
export function snapLayoutMovement(moving:LayoutBox,targets:LayoutBox[],dx:number,dy:number,tolerance:number,grid=0) {
  let x=dx,y=dy,bestX=tolerance+.0001,bestY=tolerance+.0001;let xGuide:number|undefined,yGuide:number|undefined,spacingX:number|undefined,spacingY:number|undefined;
  const xs=[moving.x,moving.x+moving.width/2,moving.x+moving.width],ys=[moving.y,moving.y+moving.height/2,moving.y+moving.height];
  for(const t of targets){for(const a of xs)for(const b of [t.x,t.x+t.width/2,t.x+t.width])if(Math.abs(b-a-dx)<bestX){bestX=Math.abs(b-a-dx);x=b-a;xGuide=b;}for(const a of ys)for(const b of [t.y,t.y+t.height/2,t.y+t.height])if(Math.abs(b-a-dy)<bestY){bestY=Math.abs(b-a-dy);y=b-a;yGuide=b;}}
  // Equidistant spacing between the two nearest objects either side of the moving box.
  for(const axis of ['x','y'] as const){const size=axis==='x'?'width':'height',other=axis==='x'?'y':'x',otherSize=axis==='x'?'height':'width',d=axis==='x'?dx:dy;
    const near=targets.filter(t=>Math.min(t[other]+t[otherSize],moving[other]+moving[otherSize]+(axis==='x'?dy:dx))>Math.max(t[other],moving[other]+(axis==='x'?dy:dx)));
    const left=near.filter(t=>t[axis]+t[size]<=moving[axis]+d).sort((a,b)=>b[axis]+b[size]-a[axis]-a[size])[0],right=near.filter(t=>t[axis]>=moving[axis]+moving[size]+d).sort((a,b)=>a[axis]-b[axis])[0];
    if(left&&right){const target=(left[axis]+left[size]+right[axis]-moving[size])/2,delta=target-moving[axis];if(Math.abs(delta-d)<(axis==='x'?bestX:bestY)){if(axis==='x'){x=delta;spacingX=(right.x-left.x-left.width-moving.width)/2;xGuide=target;bestX=Math.abs(delta-d);}else{y=delta;spacingY=(right.y-left.y-left.height-moving.height)/2;yGuide=target;bestY=Math.abs(delta-d);}}}
  }
  if(xGuide===undefined&&grid>0)x=Math.round((moving.x+dx)/grid)*grid-moving.x;
  if(yGuide===undefined&&grid>0)y=Math.round((moving.y+dy)/grid)*grid-moving.y;
  return{dx:round(x),dy:round(y),xGuide,yGuide,spacingX,spacingY};
}
export function moveRoomVertices(room:RoomLayout,indices:number[],dx:number,dy:number) {
  const next=structuredClone(room);for(const i of indices){next.vertices[i].x=round(next.vertices[i].x+dx);next.vertices[i].y=round(next.vertices[i].y+dy);}if(!validRoomPath(next))throw new Error('部屋の壁が交差するため、この変更は確定できません。');return next;
}
export class LayoutHistory {
  private past:RoomLayout[][]=[];private future:RoomLayout[][]=[];
  get canUndo(){return !!this.past.length;}get canRedo(){return !!this.future.length;}
  commit(before:RoomLayout[],after:RoomLayout[]){if(JSON.stringify(before)===JSON.stringify(after))return;this.past.push(structuredClone(before));if(this.past.length>100)this.past.shift();this.future=[];}
  undo(current:RoomLayout[]){const value=this.past.pop();if(!value)return;this.future.push(structuredClone(current));return structuredClone(value);}
  redo(current:RoomLayout[]){const value=this.future.pop();if(!value)return;this.past.push(structuredClone(current));return structuredClone(value);}
  clear(){this.past=[];this.future=[];}
}

/** Physical warnings include hidden cards; hiding a layer never makes an invalid placement safe. */
export function titleBoardPlacementProblems(room:RoomLayout,works:LayoutWork[]) {
  const issues:string[]=[];
  for(const card of room.titleBoards??[]) {
    const work=works.find(w=>w.id===card.workId),box=titleBoardBox(room,card),label=work?.title??'作品';
    if(card.surface.startsWith('wall:')){const surface=wallSurface(room,card.surface);if(!surface||!wallSurfaceContains(surface,[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}]))issues.push(`${label}のタイトルボードが壁面の外にあります。`);}
    const overlaps=layoutObjects(room,works,card.surface).filter(o=>o.id!==`titleboard:${card.id}`&&['work','titleboard','opening'].includes(o.kind)).some(o=>box.x<o.box.x+o.box.width-.01&&box.x+box.width>o.box.x+.01&&box.y<o.box.y+o.box.height-.01&&box.y+box.height>o.box.y+.01);
    if(overlaps)issues.push(`${label}のタイトルボードが作品・開口部・他のタイトルボードと重なっています。`);
  }return [...new Set(issues)];
}
