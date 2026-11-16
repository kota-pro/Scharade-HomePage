import type { LayoutChange, RoomLayout } from './exhibitionTypes.ts';

const arrays = ['openings','placements','tables','books','annotations','boardGroups','boardPlacements','titleBoards','dimensions','labelPositions'] as const;
export const canonicalLayoutJson = (value:unknown):string => JSON.stringify(value??null,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,value[key]])):value);
const json = canonicalLayoutJson;
export const sameLayoutValue = (a:unknown,b:unknown) => json(a)===json(b);
const clone = <T>(value:T):T => structuredClone(value);
const itemId = (collection:string,value:any) => ['placements','books','boardPlacements'].includes(collection)?value.workId:value.id;
const geometry = (r:RoomLayout) => ({vertices:r.vertices,wallHeights:r.wallHeights,...r.wallIds?{wallIds:r.wallIds}:{},...r.wallNames?{wallNames:r.wallNames}:{},...r.geometryVersion?{geometryVersion:r.geometryVersion}:{}});
const metadata = (r:RoomLayout) => r.editor??{order:[],hidden:[],locked:[],groups:[]};
export function diffLayoutRooms(before:RoomLayout[],after:RoomLayout[]):LayoutChange[] {
  const changes:LayoutChange[]=[];
  const add=(roomId:string,collection:LayoutChange['collection'],a:unknown,b:unknown,id?:string)=>{if(!sameLayoutValue(a,b))changes.push({roomId,collection,...id?{id}:{},before:clone(a??null),after:clone(b??null)});};
  for(const roomId of new Set([...before,...after].map(r=>r.id))) {
    const a=before.find(r=>r.id===roomId),b=after.find(r=>r.id===roomId);
    if(!a||!b){add(roomId,'room',a,b);continue;}
    add(roomId,'geometry',geometry(a),geometry(b));add(roomId,'name',a.name,b.name);add(roomId,'showExhibitorNames',a.showExhibitorNames??true,b.showExhibitorNames??true);add(roomId,'showWorkTitles',a.showWorkTitles??true,b.showWorkTitles??true);
    for(const collection of arrays){const aa=a[collection]??[],bb=b[collection]??[];for(const id of new Set([...aa,...bb].map(v=>itemId(collection,v))))add(roomId,collection,aa.find(v=>itemId(collection,v)===id),bb.find(v=>itemId(collection,v)===id),id);}
    const am=metadata(a),bm=metadata(b);add(roomId,'order',am.order,bm.order);
    for(const collection of ['hidden','locked'] as const)for(const id of new Set([...am[collection],...bm[collection]]))add(roomId,collection,am[collection].includes(id),bm[collection].includes(id),id);
    for(const id of new Set([...am.groups,...bm.groups].map(g=>g.id)))add(roomId,'groups',am.groups.find(g=>g.id===id),bm.groups.find(g=>g.id===id),id);
  }
  return changes;
}
export function layoutChangeValue(rooms:RoomLayout[],change:LayoutChange):unknown {
  const r=rooms.find(r=>r.id===change.roomId);if(change.collection==='room')return r??null;if(!r)throw new Error('展示室が削除されています。');
  const c=change.collection;
  if(c==='geometry')return geometry(r);if(c==='name')return r.name;if(c==='showExhibitorNames')return r.showExhibitorNames??true;if(c==='showWorkTitles')return r.showWorkTitles??true;
  if(c==='order')return metadata(r).order;if(c==='hidden'||c==='locked')return metadata(r)[c].includes(change.id!);if(c==='groups')return metadata(r).groups.find(g=>g.id===change.id)??null;
  return (r[c]??[]).find((v:any)=>itemId(c,v)===change.id)??null;
}
export function applyLayoutChanges(source:RoomLayout[],changes:LayoutChange[],check=true):RoomLayout[] {
  const rooms=clone(source);
  if(check)for(const c of changes)if(!sameLayoutValue(layoutChangeValue(rooms,c),c.before))throw new Error('対象が別の画面で変更されています。未送信の変更を確認してください。');
  for(const c of changes){const value=clone(c.after),index=rooms.findIndex(r=>r.id===c.roomId);
    if(c.collection==='room'){if(index>=0)rooms.splice(index,1);if(value)rooms.splice(index<0?rooms.length:index,0,value as RoomLayout);continue;}
    const r=rooms[index];if(!r)throw new Error('展示室が削除されています。');
    if(c.collection==='geometry'){const g=value as any;r.vertices=g.vertices;r.wallHeights=g.wallHeights;r.wallIds=g.wallIds;r.wallNames=g.wallNames;r.geometryVersion=g.geometryVersion;continue;}
    if(c.collection==='name'){r.name=value as string;continue;}if(c.collection==='showExhibitorNames'){r.showExhibitorNames=value as boolean;continue;}if(c.collection==='showWorkTitles'){r.showWorkTitles=value as boolean;continue;}
    if(['order','hidden','locked','groups'].includes(c.collection)){const m=r.editor??={order:[],hidden:[],locked:[],groups:[]};if(c.collection==='order')m.order=value as string[];else if(c.collection==='hidden'||c.collection==='locked'){m[c.collection]=m[c.collection].filter(id=>id!==c.id);if(value)m[c.collection].push(c.id!);}else{m.groups=m.groups.filter(g=>g.id!==c.id);if(value)m.groups.push(value as any);}continue;}
    const list=(r as any)[c.collection]??=[];const at=list.findIndex((v:any)=>itemId(c.collection,v)===c.id);if(at>=0)list.splice(at,1);if(value)list.splice(at<0?list.length:at,0,value);
  }
  return rooms;
}
export function invertLayoutChanges(changes:LayoutChange[]):LayoutChange[]{return changes.map(c=>({...clone(c),before:clone(c.after),after:clone(c.before)}));}
export function layoutObjectLeaseKey(room:RoomLayout,ref:string):string {
  const [kind,id]=ref.split(':');let parent='';if(kind==='label'){const p=room.labelPositions?.find(p=>p.id===id);return p?`${layoutObjectLeaseKey(room,p.target)}/${ref}`:`room:${room.id}/${ref}`;}
  if(kind==='work'){const p=room.boardPlacements?.find(p=>p.workId===id);if(p)parent=`board:${p.groupId}/`;}
  if(kind==='book'){const p=room.books.find(p=>p.workId===id);if(p)parent=`table:${p.tableId}/`;}
  if(kind==='titleboard'){const p=room.titleBoards?.find(p=>p.id===id);if(p?.surface.startsWith('board:'))parent=`board:${p.surface.split(':')[1]}/`;}
  return `room:${room.id}/${parent}${ref}`;
}
export function layoutChangeLeaseKeys(change:LayoutChange,rooms:RoomLayout[]):string[] {
  const c=change.collection,r=rooms.find(r=>r.id===change.roomId);
  if(c==='labelPositions'&&r){const p=(change.after??change.before) as any;return p?[`${layoutObjectLeaseKey(r,p.target)}/label:${change.id}`]:[`room:${r.id}/label:${change.id}`];}if(c==='room'||c==='geometry')return[`room:${change.roomId}`];
  const kinds:Record<string,string>={openings:'opening',placements:'work',tables:'table',books:'book',annotations:'annotation',boardGroups:'board',boardPlacements:'work',titleBoards:'titleboard',dimensions:'dimension',labelPositions:'label'};
  const ref=kinds[c]?`${kinds[c]}:${change.id}`:c==='hidden'||c==='locked'?change.id:undefined;
  const keys=ref&&r?[layoutObjectLeaseKey(r,ref)]:[`room:${change.roomId}/${c}:${change.id??''}`];
  if(['placements','boardPlacements','books'].includes(c))keys.push(`work:${change.id}`);
  if(r&&c==='boardPlacements')for(const v of [change.before,change.after] as any[])if(v?.groupId)keys.push(`room:${r.id}/board:${v.groupId}/work:${change.id}`);
  if(r&&c==='books')for(const v of [change.before,change.after] as any[])if(v?.tableId)keys.push(`room:${r.id}/table:${v.tableId}/book:${change.id}`);
  if(r&&c==='titleBoards')for(const v of [change.before,change.after] as any[])if(v?.surface?.startsWith('board:'))keys.push(`room:${r.id}/board:${v.surface.split(':')[1]}/titleboard:${change.id}`);
  if(c==='groups'&&r)for(const g of [change.before,change.after] as any[])for(const id of g?.objectIds??[])keys.push(layoutObjectLeaseKey(r,id));
  return [...new Set(keys)];
}
export const leaseKeysOverlap=(a:string,b:string)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
/** Read dependencies protect geometry and fixed references after a lease expires/reconnects. */
export function layoutDependencyChecks(rooms:RoomLayout[],changes:LayoutChange[],keys:string[]=[]):LayoutChange[]{
 const checks:LayoutChange[]=[];const add=(roomId:string,collection:LayoutChange['collection'],id?:string)=>{if(changes.some(c=>c.roomId===roomId&&c.collection===collection&&c.id===id)||checks.some(c=>c.roomId===roomId&&c.collection===collection&&c.id===id))return;const change={roomId,collection,...id?{id}:{},before:null,after:null} as LayoutChange,value=clone(layoutChangeValue(rooms,change));checks.push({...change,before:value,after:clone(value)});};
 const related=new Set(changes.map(c=>c.roomId));for(const r of rooms)if(related.has(r.id)&&!changes.some(c=>c.roomId===r.id&&c.collection==='room')){add(r.id,'geometry');for(const key of keys.filter(k=>k.startsWith(`room:${r.id}/`)))for(const ref of key.slice(`room:${r.id}/`.length).split('/')){const [kind,id]=ref.split(':');const collection=({annotation:'annotations',table:'tables',opening:'openings',board:'boardGroups',titleboard:'titleBoards',dimension:'dimensions',label:'labelPositions',book:'books'} as Record<string,LayoutChange['collection']>)[kind];if(collection&&id)add(r.id,collection,id);else if(kind==='work'&&id){add(r.id,r.boardPlacements?.some(p=>p.workId===id)?'boardPlacements':'placements',id);}}}
 return checks;
}
