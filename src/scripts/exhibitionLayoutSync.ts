import {readExhibitionResponse} from './exhibitionResponse.ts';
import {applyLayoutChanges,diffLayoutRooms,invertLayoutChanges,layoutChangeValue,sameLayoutValue,layoutChangeLeaseKeys,leaseKeysOverlap,layoutDependencyChecks} from '../lib/exhibitionLayoutChanges.ts';
import {rebaseLayoutChanges} from '../lib/exhibitionLayoutRebase.ts';
import {createLayoutRecovery,type PendingLayoutEdit as Pending} from './exhibitionLayoutRecovery.ts';
import type {LayoutChange,RoomLayout} from '../lib/exhibitionTypes.ts';
export type LayoutPeerState={peers:{clientId:string;actorId:string;name:string;color:string;roomId:string;view:string;x?:number;y?:number;selected:string[]}[];leases:{key:string;clientId:string;name:string;expiresAt:number}[]};
type Options={exhibitionId:string;ownerId:()=>string;getRooms:()=>RoomLayout[];setRooms:(rooms:RoomLayout[])=>void;busy:()=>boolean;paintingBusy?:()=>boolean;snapshot:(value:any)=>void;refresh:()=>void;peersChanged:()=>void;status:(text:string,error?:boolean)=>void;};
export function createLayoutSync(options:Options){
 const base=`/api/member/exhibitions/${options.exhibitionId}/layout`,clientId=crypto.randomUUID(),ownerId=options.ownerId(),storage=createLayoutRecovery(ownerId,options.exhibitionId);
 let confirmed:RoomLayout[]=[],needsPaint=true,revision=0,exhibitionRevision=0,epoch='',contentKey='',connected=false,disposed=false,blocked=false,started=false,loadedDraft=false,preferLocal=false,hardConflict=false,validationBlocked=false;
 let eventSource:EventSource|undefined,heartbeat:number|undefined,reconnecting:Promise<void>|undefined,retryTimer:number|undefined,retryAttempt=0,noticeKey='',peerFrame:number|undefined,storageWarning=false;
 let blockedMessage='';
 let presenceBusy=false,presenceDirty=false,presenceTimer:number|undefined,leaseTask:Promise<unknown>=Promise.resolve(),proofAt=0,leaseGeneration=0;
 let running:Promise<void>|undefined,reserve:Promise<{key:string;token:string}[]>|undefined,activeKeys:string[]=[],proof:{key:string;token:string}[]=[],pending:Pending[]=[];
 let peers:LayoutPeerState={peers:[],leases:[]},presenceKey='',cursor:{roomId:string;view:string;x?:number;y?:number;selected:string[]}={roomId:'',view:'floor',selected:[]},cursorAt=0;
 const past:LayoutChange[][]=[],future:LayoutChange[][]=[];
 const notifyPeers=()=>{if(disposed||peerFrame!==undefined)return;peerFrame=requestAnimationFrame(()=>{peerFrame=undefined;options.peersChanged();});};
 function status(text:string,error=false){const key=JSON.stringify([text,error]);if(key!==noticeKey){noticeKey=key;options.status(text,error);}notifyPeers();}
 const request=async(path:string,body?:unknown)=>{const response=await fetch(base+path,{...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)}),value=await readExhibitionResponse(response);if(!response.ok)throw Object.assign(new Error(value.message||'共同編集の結果を確認できません。'),{status:response.status});return value;};
 const leaseRequest=(path:string,body:unknown)=>{const result=leaseTask.catch(()=>{}).then(()=>request(path,body));leaseTask=result;return result;};
 function persist(){try{storage.write(pending,preferLocal);storageWarning=false;return true;}catch{if(!storageWarning){storageWarning=true;status('この端末に保存できません。未送信の変更は画面に残しています。保存が完了するまで画面を閉じないでください。',true);}return false;}}
 function stateLabel(){if(storageWarning)return;status(hardConflict?(blockedMessage||'同じ項目への変更が重なっています。編集内容は端末に保存しています。'):blocked?'変更はこの端末に保存しています。接続を確認して自動保存を再試行します。':!connected?'共同編集へ接続しています…':pending.length?'同期中…':'保存済み',hardConflict);}
 function paint(){if(options.busy()||options.paintingBusy?.()||blocked||!needsPaint)return;needsPaint=false;try{let rooms=confirmed;for(const item of pending)rooms=rebaseLayoutChanges(rooms,item.changes,true).rooms;options.setRooms(structuredClone(rooms));options.refresh();}catch{blocked=hardConflict=true;persist();stateLabel();}}
 function receive(value:any){
  if(typeof value.revision!=='number'||!Array.isArray(value.rooms))return;
  if(value.epoch===epoch&&(value.revision<revision||value.revision===revision&&value.exhibitionRevision<exhibitionRevision))return;
  const nextContent=JSON.stringify([value.works,value.layoutAssets]),changed=!started||value.epoch!==epoch||value.revision!==revision||nextContent!==contentKey;
  if(changed)confirmed=structuredClone(value.rooms);epoch=value.epoch;revision=value.revision;exhibitionRevision=value.exhibitionRevision;contentKey=nextContent;options.snapshot(value);
  if(changed){needsPaint=true;paint();}
 }
 function receivePresence(value:LayoutPeerState){const next={peers:value.peers,leases:value.leases},key=JSON.stringify({peers:next.peers.filter(p=>p.clientId!==clientId),leases:next.leases.filter(l=>l.clientId!==clientId)});peers=next;if(key===presenceKey)return;presenceKey=key;notifyPeers();}
 function scheduleRetry(delay?:number){if(disposed||retryTimer!==undefined||hardConflict&&!preferLocal)return;retryTimer=window.setTimeout(()=>{retryTimer=undefined;if(disposed)return;void resume();},delay??Math.min(15000,750*2**Math.min(retryAttempt++,5)));}
 async function presence(renew=false){if(!started||disposed)return;if(presenceBusy){presenceDirty=true;return;}presenceDirty=false;presenceBusy=true;cursorAt=Date.now();try{receivePresence(await request('/presence',{clientId,...cursor,renew}) as LayoutPeerState);}catch(error){if((error as any)?.status!==429){connected=false;stateLabel();scheduleRetry();}}finally{presenceBusy=false;if(presenceDirty&&!disposed)schedulePresence();}}
 async function connect(force=false){
  if(disposed||started&&connected&&!force)return;if(reconnecting)return reconnecting;
  reconnecting=(async()=>{const value=await request('',{action:'join',clientId});
   if(value.actorId!==ownerId)throw Object.assign(new Error('ログイン中のアカウントが変わっています。元のアカウントで再ログインしてください。'),{status:401});
   if(!loadedDraft){loadedDraft=true;const saved=storage.read();if(saved){pending=saved.pending;preferLocal=saved.preferLocal;persist();}}
   connected=true;receive(value);started=true;receivePresence(value.presence);eventSource?.close();eventSource=new EventSource(`${base}/events?clientId=${clientId}`);
   eventSource.addEventListener('layout',event=>{connected=true;receive(JSON.parse((event as MessageEvent).data));});
   eventSource.addEventListener('presence',event=>receivePresence(JSON.parse((event as MessageEvent).data)));
   eventSource.addEventListener('heartbeat',event=>{const value=JSON.parse((event as MessageEvent).data);if(epoch&&value.epoch!==epoch){connected=false;void connect(true);}});
   eventSource.addEventListener('ended',()=>{connected=false;eventSource?.close();stateLabel();scheduleRetry();});
   eventSource.onerror=()=>{connected=false;stateLabel();scheduleRetry();};
   eventSource.onopen=()=>{connected=true;stateLabel();if(pending.length&&!hardConflict)void drain();};
   if(!heartbeat)heartbeat=window.setInterval(()=>{if(!connected)scheduleRetry();else{if(activeKeys.length&&!pending.length&&!options.busy())void release();void presence(activeKeys.length>0);if(pending.length&&!running&&!hardConflict)scheduleRetry(0);}},5000);
   stateLabel();if(pending.length&&!hardConflict)queueMicrotask(()=>void drain());
  })().catch(error=>{connected=false;status(error instanceof Error?error.message:'共同編集へ接続できません。変更は端末に保持しています。',false);scheduleRetry(5000);}).finally(()=>{reconnecting=undefined;});return reconnecting;
 }
 function owner(keys:string[]){return peers.leases.find(l=>l.clientId!==clientId&&l.expiresAt>Date.now()&&keys.some(k=>leaseKeysOverlap(l.key,k)));}
 function begin(keys:string[]){
  if(!connected||blocked&&!validationBlocked){stateLabel();return false;}if(!keys.length)return true;const lock=owner(keys);if(lock){status(`${lock.name}がこの対象を編集中です。`,true);return false;}
  if(keys.every(k=>activeKeys.includes(k))&&(reserve||proofAt&&Date.now()-proofAt<7000))return true;
  activeKeys=[...new Set([...activeKeys,...keys])];const requested=[...activeKeys],generation=leaseGeneration;
  reserve=leaseRequest('/lease',{clientId,keys:requested}).then(value=>{if(generation===leaseGeneration){proof=value.leases;proofAt=Date.now();}return value.leases;});void reserve.catch(()=>{});return true;
 }
 async function acquire(keys:string[]){
  const lock=owner(keys);if(lock)throw Object.assign(new Error(`${lock.name}がこの対象を編集中です。操作終了後に自動保存します。`),{status:423});activeKeys=[...new Set([...activeKeys,...keys])];if(reserve){await reserve.catch(()=>{});reserve=undefined;}
  if(proofAt&&Date.now()-proofAt<7000&&keys.every(key=>proof.some(p=>p.key===key||key.startsWith(p.key+'/'))))return proof;
  const value=await leaseRequest('/lease',{clientId,keys:activeKeys});proof=value.leases;proofAt=Date.now();return proof;
 }
 async function release(){if(!started||!activeKeys.length&&!proof.length&&!reserve)return;activeKeys=[];proof=[];proofAt=0;reserve=undefined;leaseGeneration++;try{await leaseRequest('/presence',{action:'release',clientId});}catch{}}
 function commit(before:RoomLayout[],after:RoomLayout[]){
  const changes=diffLayoutRooms(before,after);if(!changes.length)return;
  pending.push({id:crypto.randomUUID(),changes,checks:layoutDependencyChecks(before,changes,activeKeys),direction:'normal'});
  if(validationBlocked){const merged=new Map<string,LayoutChange>();for(const item of pending)for(const change of item.changes){const key=JSON.stringify([change.roomId,change.collection,change.id]),old=merged.get(key);merged.set(key,{...change,before:old?old.before:change.before});}pending=[{id:crypto.randomUUID(),changes:[...merged.values()].filter(c=>!sameLayoutValue(c.before,c.after)),direction:'normal' as const}].filter(p=>p.changes.length);blocked=hardConflict=validationBlocked=false;needsPaint=true;}
  persist();stateLabel();void drain();
 }
 function accepted(item:Pending){
  pending.shift();if(item.direction==='normal'){past.push(structuredClone(item.changes));if(past.length>100)past.shift();future.length=0;}else if(item.direction==='undo'){past.pop();future.push(item.original!);}else{future.pop();past.push(item.original!);}
  if(!pending.length)preferLocal=false;persist();needsPaint=true;
 }
 function drain(){
  if(running||disposed)return running;running=(async()=>{let rebases=0;
   while(pending.length&&!hardConflict){if(!connected){blocked=true;persist();stateLabel();scheduleRetry();break;}const item=pending[0];
    try{const keys=[...new Set(item.changes.flatMap(c=>layoutChangeLeaseKeys(c,confirmed)))],leases=await acquire(keys);const result=await request('',{action:'commit',clientId,operationId:item.id,changes:item.changes,checks:item.checks,leases});
     accepted(item);blocked=validationBlocked=false;blockedMessage='';retryAttempt=0;receive(result);if(!options.busy())await release();stateLabel();rebases=0;
    }catch(error){const code=(error as any)?.status;proof=[];proofAt=0;void release();
     if(code===409&&rebases++<3){
      let fresh:any;try{fresh=await request('');}catch{blocked=true;connected=false;persist();stateLabel();scheduleRetry();break;}receive(fresh);
      try{
       if(!preferLocal)for(const check of item.checks??[])if(!sameLayoutValue(layoutChangeValue(confirmed,check),check.before))throw new Error('配置の基準や同じ項目に別の変更があります。');
       const rebased=rebaseLayoutChanges(confirmed,item.changes,preferLocal);
       if(!rebased.changes.length){pending.shift();if(!pending.length)preferLocal=false;persist();needsPaint=true;blocked=false;continue;}
       pending[0]={...item,id:crypto.randomUUID(),changes:rebased.changes,checks:layoutDependencyChecks(confirmed,rebased.changes)};blocked=false;persist();continue;
      }catch(rebaseError){blocked=hardConflict=true;persist();blockedMessage=`${rebaseError instanceof Error?rebaseError.message:'同じ項目に別の編集があります。'} 編集内容は端末に保存しています。再接続ボタンで、この端末の変更を適用できます。`;status(blockedMessage,true);break;}
     }
     blocked=true;validationBlocked=code===422;hardConflict=validationBlocked||code===403||code===404;persist();
     if(hardConflict){blockedMessage=`${error instanceof Error?error.message:'変更を確認してください。'} 編集内容は端末に残しています。`;status(blockedMessage,true);}
     else{if(code!==423)connected=false;stateLabel();scheduleRetry(code===423?1500:undefined);}break;
    }
   }
  })().finally(()=>{running=undefined;paint();notifyPeers();stateLabel();});return running;
 }
 async function resume(){if(disposed||hardConflict&&!preferLocal)return;await connect(true);if(!connected)return;blocked=false;hardConflict=false;await drain();paint();}
 async function flush(){if(!connected)await connect(true);if(!connected||hardConflict&&!preferLocal)return false;blocked=false;await drain();paint();return pending.length===0&&!blocked;}
 async function undo(redo=false){if(!await flush())return;const original=(redo?future:past).at(-1);if(!original)return;const changes=redo?structuredClone(original):invertLayoutChanges(original);try{const next=applyLayoutChanges(confirmed,changes);options.setRooms(next);pending.push({id:crypto.randomUUID(),changes,checks:layoutDependencyChecks(confirmed,changes),direction:redo?'redo':'undo',original:structuredClone(original)});persist();stateLabel();await drain();}catch{status('この対象は他の編集者が更新しています。その変更を上書きする取り消しはできません。',true);}}
 function schedulePresence(){if(!started||disposed||presenceTimer!==undefined)return;presenceTimer=window.setTimeout(()=>{presenceTimer=undefined;void presence();},Math.max(0,200-(Date.now()-cursorAt)));}
 function publishCursor(value:typeof cursor){const changed=cursor.roomId!==value.roomId||cursor.view!==value.view||JSON.stringify(cursor.selected)!==JSON.stringify(value.selected);cursor=value;presenceDirty=true;if(!started||disposed)return;if(changed&&!presenceBusy){clearTimeout(presenceTimer);presenceTimer=undefined;void presence();}else schedulePresence();}
 async function restore(versionId:string,expectedRevision:number,rooms:RoomLayout[]){if(!await flush())return false;try{if(revision!==expectedRevision)throw new Error('最新の保存状態が変わっています。履歴を更新してから復元してください。');const keys=[...new Set([...confirmed,...rooms].map(r=>`room:${r.id}`))],leases=keys.length?await acquire(keys):[];const result=await request('',{action:'restore',clientId,versionId,revision:expectedRevision,leases});past.length=0;future.length=0;receive(result);if(!options.busy())await release();stateLabel();return true;}catch(error){status(error instanceof Error?error.message:'履歴を復元できませんでした。',true);await release();return false;}}
 function idle(){window.setTimeout(()=>{if(!pending.length&&!options.busy()){void release();paint();}},0);}
 async function recover(){if(!pending.length||running||options.busy())return;preferLocal=true;persist();hardConflict=validationBlocked=false;blockedMessage='';await release();connected=false;eventSource?.close();await resume();}
 function dispose(){disposed=true;window.removeEventListener('online',online);if(pending.length)persist();eventSource?.close();clearInterval(heartbeat);clearTimeout(presenceTimer);clearTimeout(retryTimer);if(peerFrame!==undefined)cancelAnimationFrame(peerFrame);if(started)void fetch(base+'/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release',clientId,leave:true}),keepalive:true}).catch(()=>{});}
 const online=()=>{retryAttempt=0;scheduleRetry(0);};window.addEventListener('online',online);window.addEventListener('pagehide',dispose,{once:true});
 return{connect,begin,commit,flush,undo,release,idle,publishCursor,restore,recover,receive,paint,getPresence:()=>peers,clientId,actorId:()=>ownerId,hasPending:()=>pending.length>0,canRecover:()=>blocked&&!running&&!options.busy(),canUndo:()=>past.length>0||pending.length>0,canRedo:()=>future.length>0,isConnected:()=>connected,getRevision:()=>revision,dispose};
}
