import type {LayoutChange} from '../lib/exhibitionTypes.ts';
export type PendingLayoutEdit={id:string;changes:LayoutChange[];checks?:LayoutChange[];direction:'normal'|'undo'|'redo';original?:LayoutChange[]};
type RecordValue={version:1;ownerId:string;exhibitionId:string;draftId:string;at:number;preferLocal:boolean;pending:PendingLayoutEdit[]};
const cookieName='scharade_layout_draft',prefix='scharade-layout-draft/v1/',age=30*86400000;
export function createLayoutRecovery(ownerId:string,exhibitionId:string){
 const scope=prefix+encodeURIComponent(ownerId)+'/'+encodeURIComponent(exhibitionId)+'/',sessionKey=scope+'tab';let draftId=crypto.randomUUID();
 try{const saved=sessionStorage.getItem(sessionKey);if(saved&&/^[a-f0-9-]{36}$/.test(saved))draftId=saved as typeof draftId;else sessionStorage.setItem(sessionKey,draftId);}catch{}
 const key=scope+draftId;
 const pointer=()=>document.cookie.split('; ').find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 const cookie=(value:string,seconds:number)=>{document.cookie=`${cookieName}=${value}; Path=/Member/manage/exhibitions/; Max-Age=${seconds}; SameSite=Strict${location.protocol==='https:'?'; Secure':''}`;};
 function read():RecordValue|undefined{
  if(!ownerId)return;
  try{const id=pointer(),raw=localStorage.getItem(key)??(id&&/^[a-f0-9-]{36}$/.test(id)?localStorage.getItem(scope+id):null);if(!raw)return;const value=JSON.parse(raw) as RecordValue;
   if(value.version!==1||value.ownerId!==ownerId||value.exhibitionId!==exhibitionId||!Number.isFinite(value.at)||Date.now()-value.at>age||!Array.isArray(value.pending)||!value.pending.every(p=>typeof p.id==='string'&&Array.isArray(p.changes)&&p.changes.length&&['normal','undo','redo'].includes(p.direction)))return;
   return value;
  }catch{return;}
 }
 function write(pending:PendingLayoutEdit[],preferLocal:boolean){
  if(!ownerId)throw new Error('元のアカウントで再ログインしてください。');
  if(!pending.length){localStorage.removeItem(key);if(pointer()===draftId)cookie('',0);return;}
  localStorage.setItem(key,JSON.stringify({version:1,ownerId,exhibitionId,draftId,at:Date.now(),preferLocal,pending} satisfies RecordValue));cookie(draftId,age/1000);
 }
 return{read,write};
}
