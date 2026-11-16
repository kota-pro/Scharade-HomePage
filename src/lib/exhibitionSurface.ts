import {boardFaceLabels} from './exhibitionBoardFaceLabels.ts';
import { wallSurfaces, sameWallSurface, wallViewSource } from "./exhibitionWallSurfaces.ts";
import { openingPathBounds } from './exhibitionOpeningPath.ts';
import { boardSurface, boardChain } from "./exhibitionBoards.ts";
import { layoutBounds, placedPhotos, wallLength, rotatedCorners } from "./exhibitionGeometry.ts";
import type { BoardPlacement, Placement, LayoutWork, RoomLayout, PhotoLayout } from "./exhibitionTypes.ts";
import { layoutWorkLabel } from "./exhibitionRoomSymbols.ts";
import { roomWallPoint, roomOutline } from './exhibitionRoomPath.ts';
import { annotationWorldBounds } from './exhibitionAnnotationPath.ts';
export type SurfaceChoice={key:string;label:string;width:number;height:number;wall?:number;groupId?:string;face?:"A"|"B";walls?:ReturnType<typeof wallSurfaces>[number]["walls"];panels?:ReturnType<typeof boardSurface>["panels"]};
export function roomSurfaces(room:RoomLayout):SurfaceChoice[] {
  const labels=boardFaceLabels(room.boardGroups??[]);
  return [...wallSurfaces(room),...(room.boardGroups??[]).flatMap(group=>(["A","B"] as const).map(face=>({key:`board:${group.id}:${face}`,label:`${group.name}・${labels.get(group.id)![face]}面`,groupId:group.id,face,...boardSurface(group,face)})))];
}
export function surfacePlacements(room:RoomLayout,surface:SurfaceChoice):(Placement|BoardPlacement)[] {
  return surface.wall!==undefined?room.placements.filter(p=>sameWallSurface(room,`wall:${p.wall}`,surface.key)).map(p=>wallViewSource(room,`wall:${p.wall}`,p)):(room.boardPlacements??[]).filter(p=>p.groupId===surface.groupId&&p.face===surface.face);
}
export function surfaceWorkBoxes(room:RoomLayout,surface:SurfaceChoice,works:LayoutWork[]) {
  return surfacePlacements(room,surface).flatMap(placement=>{const work=works.find(w=>w.id===placement.workId);if(!work)return[];const photos=placedPhotos(work,placement,surface.height),box=layoutBounds(photos);return[{placement,work,photos,box}];});
}
export type GapLine={x1:number;y1:number;x2:number;y2:number;value:number};
export function layoutGapLines(photos:PhotoLayout[]):GapLine[] {
  const boxes=photos.map(p=>layoutBounds([p])),lines:GapLine[]=[];
  boxes.forEach(a=>{
    const right=boxes.filter(b=>b!==a&&b.x>=a.x+a.width-.05&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y)).sort((a,b)=>a.x-b.x)[0];
    if(right)lines.push({x1:a.x+a.width,y1:(Math.max(a.y,right.y)+Math.min(a.y+a.height,right.y+right.height))/2,x2:right.x,y2:(Math.max(a.y,right.y)+Math.min(a.y+a.height,right.y+right.height))/2,value:right.x-a.x-a.width});
    const below=boxes.filter(b=>b!==a&&b.y>=a.y+a.height-.05&&Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)).sort((a,b)=>a.y-b.y)[0];
    if(below)lines.push({x1:(Math.max(a.x,below.x)+Math.min(a.x+a.width,below.x+below.width))/2,y1:a.y+a.height,x2:(Math.max(a.x,below.x)+Math.min(a.x+a.width,below.x+below.width))/2,y2:below.y,value:below.y-a.y-a.height});
  });
  return lines;
}

/** Shared floor labels use room coordinates, including the back face of folded boards. */
export function roomFloorLabels(room:RoomLayout,works:LayoutWork[],markerSize:number) {
  const labels:import("./exhibitionLabels.ts").LabelItem[]=[];
  const label=(id:string,workId:string,x:number,y:number,box?:import("./exhibitionLabels.ts").LabelRect)=>labels.push({id:`${room.books.some(b=>b.workId===workId)?'book':'work'}:${id}`,text:layoutWorkLabel(works.find(w=>w.id===workId),room.showExhibitorNames!==false,room.showWorkTitles!==false),anchor:{x,y},box:box??{x:x-markerSize/2,y:y-markerSize/2,width:markerSize,height:markerSize}});
  for(const p of room.placements){const at=roomWallPoint(room,p.wall,p.x);label(p.workId,p.workId,at.x,at.y);}
  const rotate=(p:{x:number;y:number},angle:number)=>{const a=angle*Math.PI/180;return{x:p.x*Math.cos(a)-p.y*Math.sin(a),y:p.x*Math.sin(a)+p.y*Math.cos(a)};};
  for(const book of room.books){const table=room.tables.find(t=>t.id===book.tableId);if(!table)continue;const points=rotatedCorners(book.width,book.depth,book.rotation).map(p=>rotate({x:book.x+p.x,y:book.y+p.y},table.rotation)).map(p=>({x:p.x+table.x,y:p.y+table.y})),xs=points.map(p=>p.x),ys=points.map(p=>p.y),box={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};label(book.workId,book.workId,box.x+box.width/2,box.y+box.height/2,box);}
  for(const group of room.boardGroups??[]){const chain=boardChain(group);for(const face of ["A","B"] as const){const surface=roomSurfaces(room).find(s=>s.groupId===group.id&&s.face===face)!;for(const item of surfaceWorkBoxes(room,surface,works)){const x=item.box.x+item.box.width/2,panel=surface.panels!.find(p=>x>=p.left&&x<=p.right)??surface.panels![0],physical=chain.find(c=>c.panel.id===panel.panel.id)!,offset=face==="A"?x-panel.left:panel.right-x,fraction=Math.min(1,Math.max(0,offset/panel.panel.width));label(item.work.id,item.work.id,physical.start.x+(physical.end.x-physical.start.x)*fraction,physical.start.y+(physical.end.y-physical.start.y)*fraction);}}}
  return labels.filter(label=>label.text);
}

export function roomFloorBounds(room:RoomLayout) {
  const corners=(x:number,y:number,w:number,h:number,angle:number)=>rotatedCorners(w,h,angle).map(p=>({x:x+p.x,y:y+p.y}));
  const outline=roomOutline(room).bounds,points=[{x:outline.x,y:outline.y},{x:outline.x+outline.width,y:outline.y+outline.height},...room.openings.flatMap(o=>{const b=openingPathBounds(room,o);return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height}];}),...room.tables.flatMap(t=>corners(t.x,t.y,t.width,t.depth,t.rotation)),...(room.boardGroups??[]).flatMap(g=>boardChain(g).flatMap(p=>p.polygon)),...(room.annotations??[]).filter(a=>!a.surface||a.surface==='floor').flatMap(a=>{const b=annotationWorldBounds(a);return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height}];})];
  return{x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),width:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),height:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))};
}
