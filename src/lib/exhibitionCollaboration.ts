import {syncWallEquipment} from './exhibitionWallEquipment.ts';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { findExhibition, readExhibitions, requireStaff } from './exhibitions.ts';
import { dataPath, writeData, withStoreLock } from './store.ts';
import { ExhibitionError, id, object, parseRooms, text } from './exhibitionValidation.ts';
import { boardPlacementProblems } from './exhibitionBoards.ts';
import { ensureRoomPath } from './exhibitionRoomPath.ts';
import { applyLayoutChanges, canonicalLayoutJson, layoutChangeValue,sameLayoutValue,layoutChangeLeaseKeys, leaseKeysOverlap } from './exhibitionLayoutChanges.ts';
import { currentLayoutVersion, layoutVersionInfo, recordLayoutVersion } from './exhibitionLayoutHistory.ts';
import { latestContent, type Exhibition, type ExhibitionStore, type LayoutChange, type RoomLayout } from './exhibitionTypes.ts';

type Peer={clientId:string;actorId:string;name:string;color:string;updatedAt:number;roomId:string;view:string;x?:number;y?:number;selected:string[]};
type Lease={key:string;clientId:string;actorId:string;expiresAt:number;token:string};
type Channel={peers:Map<string,Peer>;leases:Map<string,Lease>};
const channels=new Map<string,Channel>();
let cachedTag='',cachedData:ExhibitionStore|undefined;
const snapshotCache=new Map<string,{tag:string;value:ReturnType<typeof layoutSnapshot>}>();
export const collaborationEpoch=crypto.randomUUID();
const palette=['#0b8978','#9562a3','#c45f7f','#a37b37','#4779ad','#5d8953'];
function channel(exhibitionId:string){let c=channels.get(exhibitionId);if(!c){if(channels.size>1000)for(const [key,v] of channels)if(!v.peers.size&&!v.leases.size)channels.delete(key);c={peers:new Map(),leases:new Map()};channels.set(exhibitionId,c);}const now=Date.now();for(const [key,v] of c.peers)if(v.updatedAt+45000<now)c.peers.delete(key);for(const [key,v] of c.leases)if(v.expiresAt<=now||!c.peers.has(v.clientId))c.leases.delete(key);return c;}
function peer(exhibitionId:string,actorId:string,clientId:string){const p=channel(exhibitionId).peers.get(id(clientId));if(!p||p.actorId!==actorId)throw new ExhibitionError('共同編集へ再接続してください。未送信の変更は保持しています。',409);return p;}
export function layoutSnapshot(data:ExhibitionStore,e:Exhibition){
  const works=data.submissions.filter(s=>s.exhibitionId===e.id&&!s.inactive).flatMap(s=>{const content=latestContent(s);return(content?.works??[]).map(w=>({...w,exhibitorName:content?.authorName||content?.name||'',titleBoardVersion:crypto.createHash('sha256').update(canonicalLayoutJson({revision:s.revision,name:content?.name,grade:content?.grade,authorName:content?.authorName,portfolio:s.portfolioId||content?.portfolioUrl,confirmed:s.qrConfirmed,work:w})).digest('hex').slice(0,20)}));});
  return {ok:true,epoch:collaborationEpoch,exhibitionId:e.id,title:e.title,revision:e.layoutRevision??0,exhibitionRevision:e.revision,rooms:e.rooms,works,layoutAssets:(data.layoutAssets??[]).filter(a=>a.exhibitionId===e.id).map(({id,name,width,height,bytes})=>({id,name,width,height,bytes})),history:[currentLayoutVersion(e),...e.layoutHistory??[]].map(layoutVersionInfo)};
}
export function readLayoutSnapshot(actorId:string,exhibitionId:string){requireStaff(actorId);const file=dataPath('exhibitions.json');let tag='missing';try{const stat=fs.statSync(file);tag=`${file}:${stat.ino}:${stat.mtimeMs}:${stat.size}`;}catch{}if(!cachedData||tag!==cachedTag){cachedData=readExhibitions();cachedTag=tag;snapshotCache.clear();}const key=id(exhibitionId),cached=snapshotCache.get(key);if(cached)return cached.value;const value=layoutSnapshot(cachedData,findExhibition(cachedData,key));snapshotCache.set(key,{tag,value});return value;}
export async function joinLayout(actorId:string,exhibitionId:string,clientId:string){
  const actor=requireStaff(actorId);id(clientId);
  const snapshot=await withStoreLock('exhibitions',()=>{requireStaff(actorId);const data=readExhibitions(),e=findExhibition(data,id(exhibitionId));if(!e.layoutProtocol){for(const room of e.rooms)ensureRoomPath(room);e.layoutProtocol=1;e.layoutRevision??=0;e.revision++;writeData('exhibitions.json',data);}return layoutSnapshot(data,e);});
  const c=channel(exhibitionId),existing=c.peers.get(clientId);if(existing&&existing.actorId!==actorId)throw new ExhibitionError('編集者の識別を確認してください。',403);
  if(!existing&&(c.peers.size>=20||[...c.peers.values()].filter(p=>p.actorId===actorId).length>=3))throw new ExhibitionError('共同編集の接続数が上限です。他の編集画面を閉じてください。',429);
  c.peers.set(clientId,{clientId,actorId,name:actor.name,color:existing?.color??palette[c.peers.size%palette.length],updatedAt:Date.now(),roomId:existing?.roomId??'',view:existing?.view??'floor',selected:existing?.selected??[],...(existing?.x!==undefined?{x:existing.x,y:existing.y}:{})});
  return {...snapshot,clientId,presence:layoutPresence(exhibitionId)};
}
export function layoutPresence(exhibitionId:string){const c=channel(exhibitionId);return{peers:[...c.peers.values()].map(({updatedAt,...p})=>p),leases:[...c.leases.values()].map(({token,actorId,...l})=>({...l,name:c.peers.get(l.clientId)?.name??'編集者'}))};}
export function updateLayoutPresence(actorId:string,exhibitionId:string,value:unknown){
  requireStaff(actorId);findExhibition(readExhibitions(),id(exhibitionId));const raw=object(value),p=peer(exhibitionId,actorId,id(raw.clientId));p.updatedAt=Date.now();
  if(raw.roomId!==undefined)p.roomId=text(raw.roomId,'展示室',100);if(raw.view!==undefined)p.view=text(raw.view,'図面',150);
  if(raw.x!==undefined&&raw.y!==undefined){if(![raw.x,raw.y].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000000))throw new ExhibitionError('カーソル座標を確認してください。');p.x=raw.x;p.y=raw.y;}
  if(raw.selected!==undefined){if(!Array.isArray(raw.selected)||raw.selected.length>1000||raw.selected.some(v=>typeof v!=='string'||v.length>150))throw new ExhibitionError('選択内容を確認してください。');p.selected=raw.selected;}
  if(raw.renew===true)for(const lease of channel(exhibitionId).leases.values())if(lease.clientId===p.clientId)lease.expiresAt=Date.now()+15000;
  return{ok:true,...layoutPresence(exhibitionId)};
}
export function releaseLayout(actorId:string,exhibitionId:string,clientId:string,leave=false){const c=channel(exhibitionId),p=c.peers.get(clientId);if(p&&p.actorId!==actorId)throw new ExhibitionError('編集者を確認してください。',403);for(const [key,l] of c.leases)if(l.clientId===clientId&&l.actorId===actorId)c.leases.delete(key);if(leave)c.peers.delete(clientId);return{ok:true};}
export function acquireLayoutLeases(actorId:string,exhibitionId:string,value:unknown){
  requireStaff(actorId);findExhibition(readExhibitions(),id(exhibitionId));const raw=object(value),p=peer(exhibitionId,actorId,id(raw.clientId)),c=channel(exhibitionId);
  if(!Array.isArray(raw.keys)||!raw.keys.length||raw.keys.length>1000||raw.keys.some(k=>typeof k!=='string'||k.length>220||!/^(?:room|work):[a-f0-9-]{36}(?:\/[A-Za-z0-9:._-]+)*$/.test(k)))throw new ExhibitionError('編集対象を確認してください。');
  const keys=[...new Set(raw.keys as string[])];
  for(const key of keys){const conflict=[...c.leases.values()].find(l=>l.clientId!==p.clientId&&leaseKeysOverlap(l.key,key));if(conflict)throw new ExhibitionError(`${c.peers.get(conflict.clientId)?.name??'別の編集者'}がこの対象を編集中です。操作が終わるまでお待ちください。`,423);}
  p.updatedAt=Date.now();const leases=keys.map(key=>{const old=c.leases.get(key),lease:Lease={key,actorId,clientId:p.clientId,expiresAt:Date.now()+15000,token:old?.clientId===p.clientId?old.token:crypto.randomUUID()};c.leases.set(key,lease);return{key,token:lease.token};});return{ok:true,leases};
}
function assertLeases(actorId:string,e:Exhibition,clientId:string,keys:string[],proof:unknown){
  peer(e.id,actorId,clientId);if(!Array.isArray(proof))throw new ExhibitionError('操作ロックを再取得してください。',409);const c=channel(e.id);
  for(const key of keys){const lease=[...c.leases.values()].find(l=>l.clientId===clientId&&l.actorId===actorId&&(l.key===key||key.startsWith(l.key+'/'))&&proof.some(p=>p?.key===l.key&&p?.token===l.token));if(!lease)throw new ExhibitionError('操作ロックの期限が切れました。未送信の変更を確認してください。',409);}
}
const collections=new Set(['room','geometry','name','showExhibitorNames','openings','placements','tables','books','annotations','boardGroups','boardPlacements','titleBoards','dimensions','labelPositions','order','hidden','locked','groups']);
export function parseLayoutChanges(value:unknown):LayoutChange[]{if(!Array.isArray(value)||!value.length||value.length>3000)throw new ExhibitionError('変更対象を確認してください。');const result=value.map(v=>{const r=object(v);if(!collections.has(r.collection)||!Object.hasOwn(r,'before')||!Object.hasOwn(r,'after'))throw new ExhibitionError('変更内容を確認してください。');const collection=r.collection as LayoutChange['collection'],roomId=id(r.roomId);if(['room','geometry','name','showExhibitorNames','order'].includes(collection)){if(r.id!==undefined)throw new ExhibitionError('変更対象を確認してください。');}else if(collection==='hidden'||collection==='locked'){if(typeof r.id!=='string'||!/^(annotation|table|opening|board|work|book|titleboard|dimension):[a-f0-9-]{36}$/.test(r.id)||typeof r.before!=='boolean'||typeof r.after!=='boolean')throw new ExhibitionError('レイヤーの対象を確認してください。');}else id(r.id);return{roomId,collection,...r.id!==undefined?{id:r.id}:{},before:r.before,after:r.after};});if(new Set(result.map(c=>`${c.roomId}/${c.collection}/${c.id??''}`)).size!==result.length)throw new ExhibitionError('変更対象が重複しています。');return result;}
export function validateLayoutRooms(data:ExhibitionStore,e:Exhibition,value:unknown,allowExisting=false){
  const rooms=parseRooms(value),works=data.submissions.filter(s=>s.exhibitionId===e.id&&!s.inactive).flatMap(s=>latestContent(s)?.works??[]),photos=new Set(works.filter(w=>w.kind!=='book').map(w=>w.id)),books=new Set(works.filter(w=>w.kind==='book').map(w=>w.id));
  const preserved=(room:RoomLayout,kind:'placements'|'boardPlacements'|'books'|'titleBoards',workId:string)=>allowExisting&&!!e.rooms.find(r=>r.id===room.id)?.[kind]?.some(p=>p.workId===workId);
  if(rooms.some(r=>r.placements.some(p=>!photos.has(p.workId)&&!preserved(r,'placements',p.workId))||r.boardPlacements?.some(p=>!photos.has(p.workId)&&!preserved(r,'boardPlacements',p.workId))||r.books.some(p=>(!books.has(p.workId)&&!preserved(r,'books',p.workId))||!r.tables.some(t=>t.id===p.tableId))||r.titleBoards?.some(p=>!photos.has(p.workId)&&!preserved(r,'titleBoards',p.workId))))throw new ExhibitionError('この配置には現在利用できない作品があります。提出内容を確認してください。',422);
  if(rooms.some(r=>r.annotations?.some(a=>a.kind==='image'&&!(data.layoutAssets??[]).some(v=>v.id===a.assetId&&v.exhibitionId===e.id))))throw new ExhibitionError('配置用画像が見つかりません。選び直してください。',422);
  for(const r of rooms){const previous=allowExisting?e.rooms.find(old=>old.id===r.id):undefined,known=new Set(previous?boardPlacementProblems(previous,works):[]),problems=boardPlacementProblems(r,works).filter(p=>!known.has(p));if(problems.length)throw new ExhibitionError(problems.join('\n'),422);}
  try{rooms.forEach(syncWallEquipment);}catch(error){throw new ExhibitionError(error instanceof Error?error.message:"設備の位置を確認してください。",422);}
  return rooms;
}
export async function commitLayoutOperation(actorId:string,exhibitionId:string,value:unknown){
  const raw=object(value),operationId=id(raw.operationId),clientId=id(raw.clientId),changes=parseLayoutChanges(raw.changes),checks=raw.checks?.length?parseLayoutChanges(raw.checks):[],digest=crypto.createHash('sha256').update(canonicalLayoutJson({changes,checks})).digest('hex');requireStaff(actorId);
  return withStoreLock('exhibitions',()=>{const actor=requireStaff(actorId),data=readExhibitions(),e=findExhibition(data,id(exhibitionId));if(!e.layoutProtocol)throw new ExhibitionError('共同編集へ接続してください。',409);const receipt=e.layoutReceipts?.find(r=>r.id===operationId);
    if(receipt){if(receipt.actorId!==actorId||(receipt as any).digest!==digest)throw new ExhibitionError('操作番号が別の変更に使われています。',409);return{...layoutSnapshot(data,e),duplicate:true,operationId};}
    assertLeases(actorId,e,clientId,[...new Set(changes.flatMap(c=>layoutChangeLeaseKeys(c,e.rooms)))],raw.leases);
    for(const check of checks)if(!sameLayoutValue(check.before,check.after)||!sameLayoutValue(layoutChangeValue(e.rooms,check),check.before))throw new ExhibitionError('配置の基準が別の編集者によって変更されています。未送信の変更を保管し、最新状態でやり直してください。',409);
    let candidate:RoomLayout[];try{candidate=applyLayoutChanges(e.rooms,changes);}catch(error){throw new ExhibitionError(error instanceof Error?error.message:'変更を確認してください。',409);}
    const next=validateLayoutRooms(data,e,candidate,true);recordLayoutVersion(e,next,actor);e.revision++;e.updatedAt=new Date().toISOString();
    (e.layoutReceipts??=[]).push({id:operationId,actorId,revision:e.layoutRevision!,at:e.updatedAt,...{digest}});e.layoutReceipts=e.layoutReceipts.slice(-1000);writeData('exhibitions.json',data);
    return{...layoutSnapshot(data,e),operationId,duplicate:false};});
}
export function readLayoutHistory(actorId:string,exhibitionId:string,versionId?:string){requireStaff(actorId);const data=readExhibitions(),e=findExhibition(data,id(exhibitionId)),versions=[currentLayoutVersion(e),...e.layoutHistory??[]];if(!versionId)return{ok:true,revision:e.layoutRevision??0,exhibitionRevision:e.revision,versions:versions.map(layoutVersionInfo),version:undefined,works:undefined};const version=versions.find(v=>v.id===id(versionId));if(!version)throw new ExhibitionError('この履歴は保存範囲から外れています。履歴を更新してください。',410);return{ok:true,revision:e.layoutRevision??0,exhibitionRevision:e.revision,versions:versions.map(layoutVersionInfo),version,...{works:layoutSnapshot(data,e).works}};}
export async function restoreLayoutVersion(actorId:string,exhibitionId:string,value:unknown){const raw=object(value),clientId=id(raw.clientId),versionId=id(raw.versionId);requireStaff(actorId);return withStoreLock('exhibitions',()=>{const actor=requireStaff(actorId),data=readExhibitions(),e=findExhibition(data,id(exhibitionId));if(raw.revision!==(e.layoutRevision??0))throw new ExhibitionError('別の編集者が更新しています。履歴を更新し、最新状態を確認してから復元してください。',409);const version=e.layoutHistory?.find(v=>v.id===versionId);if(!version)throw new ExhibitionError('復元する履歴が保存範囲から外れています。',410);
  assertLeases(actorId,e,clientId,[...new Set([...e.rooms,...version.rooms].map(r=>`room:${r.id}`))],raw.leases);const rooms=validateLayoutRooms(data,e,version.rooms);rooms.forEach(room=>ensureRoomPath(room));recordLayoutVersion(e,rooms,actor,'restore',versionId);e.revision++;e.updatedAt=new Date().toISOString();writeData('exhibitions.json',data);return layoutSnapshot(data,e);});}
