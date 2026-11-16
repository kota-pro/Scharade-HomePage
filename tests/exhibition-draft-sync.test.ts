import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftSync,DraftSaveError,draftFingerprint} from '../src/scripts/exhibitionDraftSync.ts';
class MemoryStorage {
  values=new Map<string,string>();get length(){return this.values.size;}key(i:number){return [...this.values.keys()][i]??null;}
  getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}removeItem(k:string){this.values.delete(k);}
}
const deferred=<T>()=>{let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function fixture(storage:MemoryStorage|null=new MemoryStorage(),tab='tab',initial={revision:1,content:{text:'initial'}}){
  let value=structuredClone(initial.content),server=structuredClone(initial),state:any;
  const requests:any[]=[];let transport=(content:typeof value,revision:number)=>{assert.equal(revision,server.revision);server={revision:revision+1,content:structuredClone(content)};return Promise.resolve(structuredClone(server));};
  const sync=createDraftSync({initial,storage,tab,prefix:'owner:exhibition:submission:schema:',read:()=>structuredClone(value),restore:v=>{value=v;},enabled:()=>true,send:(v,r)=>{requests.push({v,r});return transport(v,r);},fetch:async()=>structuredClone(server),state:v=>{state=v;},debounce:60000});
  return {sync,storage,requests,get value(){return value;},set value(v){value=v;},get state(){return state;},get server(){return server;},set server(v){server=v;},setTransport:(v:typeof transport)=>{transport=v;}};
}
test('each edit is retained synchronously and only draft saves occur',async()=>{
 const f=fixture();try{f.value={text:'first'};f.sync.touch();assert.match([...f.storage!.values.values()][0],/first/);assert.equal(f.state.kind,'pending');await f.sync.flush();assert.equal(f.server.content.text,'first');assert.equal(f.requests.length,1);assert.equal(f.storage!.length,0);assert.equal(f.state.kind,'saved');}finally{f.sync.dispose();}
});
test('in-flight ACK preserves newer typing, advances revision and serializes the next request',async()=>{
 const f=fixture(),d=deferred<any>();try{f.setTransport(()=>d.promise);f.value={text:'first'};f.sync.touch();const sending=f.sync.flush();f.value={text:'second'};f.sync.touch();d.resolve({revision:2,content:{text:'first'}});await sending;assert.equal(f.value.text,'second');assert.equal(f.sync.dirty(),true);f.server={revision:2,content:{text:'first'}};f.setTransport(async(v,r)=>{assert.equal(r,2);return{revision:3,content:v};});await f.sync.flush();assert.equal(f.requests[1].v.text,'second');assert.equal(f.sync.dirty(),false);}finally{f.sync.dispose();}
});
test('login expiry retains unsent input and same-owner reload restores and sends it',async()=>{
 const storage=new MemoryStorage(),f=fixture(storage);try{f.value={text:'after logout'};f.sync.touch();f.setTransport(async()=>{throw new DraftSaveError('expired',401);});await assert.rejects(f.sync.flush());assert.equal(f.state.kind,'auth');assert.equal(f.state.local,true);}finally{f.sync.dispose();}
 const next=fixture(storage);try{next.sync.restore();assert.equal(next.value.text,'after logout');await next.sync.flush();assert.equal(next.server.content.text,'after logout');assert.equal(storage.length,0);}finally{next.sync.dispose();}
});
test('an ACK lost in transit is reconciled without overwriting newer local input',async()=>{
 const storage=new MemoryStorage(),f=fixture(storage);try{f.value={text:'sent'};f.setTransport(async()=>{throw new Error('offline');});await assert.rejects(f.sync.flush());f.value={text:'newer'};f.sync.touch();}finally{f.sync.dispose();}
 const next=fixture(storage,'tab',{revision:2,content:{text:'sent'}});try{next.sync.restore();assert.equal(next.state.kind,'pending');assert.equal(next.value.text,'newer');await next.sync.flush();assert.equal(next.requests[0].r,2);}finally{next.sync.dispose();}
});
test('other-device changes produce a choice and retain both copies',async()=>{
 const storage=new MemoryStorage(),f=fixture(storage);f.value={text:'local'};f.sync.touch();f.sync.dispose();
 const next=fixture(storage,'tab',{revision:2,content:{text:'remote'}});try{next.sync.restore();assert.equal(next.state.kind,'conflict');assert.equal(next.value.text,'local');await assert.rejects(next.sync.flush());assert.equal(next.requests.length,0);await next.sync.resolve('server');assert.equal(next.value.text,'remote');assert.equal(next.sync.dirty(),false);}finally{next.sync.dispose();}
});
test('explicit local recovery uses the fresh revision and never loses later typing',async()=>{
 const storage=new MemoryStorage(),f=fixture(storage);f.value={text:'local'};f.sync.touch();f.sync.dispose();
 const next=fixture(storage,'tab',{revision:2,content:{text:'remote'}});try{next.sync.restore();next.value={text:'later local'};next.sync.touch();await next.sync.resolve('local');assert.equal(next.requests[0].r,2);assert.equal(next.server.content.text,'later local');}finally{next.sync.dispose();}
});
test('clean editor adopts remote changes when reconnecting instead of sending stale input back',async()=>{
 const f=fixture();try{f.server={revision:2,content:{text:'remote'}};await f.sync.resume();assert.equal(f.value.text,'remote');assert.equal(f.sync.dirty(),false);assert.equal(f.requests.length,0);}finally{f.sync.dispose();}
});
test('storage failure is reported but server saving remains available',async()=>{
 const f=fixture(null);try{f.value={text:'unsent'};f.sync.touch();assert.equal(f.state.local,false);await f.sync.flush();assert.equal(f.state.kind,'saved');assert.equal(f.server.content.text,'unsent');}finally{f.sync.dispose();}
});
test('new tab discovers matching backup; separate owner and schema prefixes are never restored',()=>{
 const storage=new MemoryStorage(),f=fixture(storage);f.value={text:'reopen'};f.sync.touch();f.sync.dispose();const next=fixture(storage,'new-tab');try{next.sync.restore();assert.equal(next.value.text,'reopen');}finally{next.sync.dispose();}
 let restored=false;const other=createDraftSync({initial:{revision:1,content:{text:'other'}},storage,tab:'tab',prefix:'different-owner:',read:()=>({text:'other'}),restore:()=>{restored=true;},enabled:()=>true,send:async v=>({revision:2,content:v}),fetch:async()=>({revision:1,content:{text:'other'}}),state:()=>{}});other.restore();assert.equal(restored,false);other.dispose();
});
test('equivalence covers server formatting while preserving meaningful text and layouts',()=>{
 const a={portfolioUrl:'https://example.invalid',fields:{empty:'',none:[]},works:[{kind:'book',photos:[{assetId:'',width:120}],details:{place:'',camera:''},title:'  春  '}]};
 const b={works:[{title:'春',photos:[],kind:'book'}],fields:{},portfolioUrl:'https://example.invalid/'};assert.equal(draftFingerprint(a),draftFingerprint(b));assert.notEqual(draftFingerprint({x:1}),draftFingerprint({x:2}));
});
test('correcting an incomplete field resumes autosave and blank optional fields do not cause save loops',async()=>{
 const f=fixture();try{f.value={text:'incomplete'};f.setTransport(async()=>{throw new DraftSaveError('invalid',400);});await assert.rejects(f.sync.flush());assert.equal(f.state.kind,'blocked');f.value={text:'corrected'};f.sync.touch();assert.equal(f.state.kind,'pending');f.setTransport(async v=>({revision:2,content:v}));await f.sync.flush();assert.equal(f.state.kind,'saved');}finally{f.sync.dispose();}
 assert.equal(draftFingerprint({fields:{a:'  ',b:[],c:0},details:{camera:'  '}}),draftFingerprint({fields:{c:0}}));
});
test('a conflict detected on send keeps the local draft until the explicit fresh-revision choice',async()=>{
 const f=fixture();try{f.value={text:'mine'};f.sync.touch();f.server={revision:2,content:{text:'theirs'}};f.setTransport(async()=>{throw new DraftSaveError('changed',409);});await assert.rejects(f.sync.flush());assert.equal(f.state.kind,'conflict');assert.equal(f.value.text,'mine');assert.equal(f.server.content.text,'theirs');f.setTransport(async(v,r)=>{assert.equal(r,2);return{revision:3,content:v};});await f.sync.resolve('local');assert.equal(f.state.kind,'saved');}finally{f.sync.dispose();}
});
test('rechecking connectivity and saving are serialized so a stale read cannot replace a later ACK',async()=>{
 let value={text:'initial'},state:any,reads=0;const d=deferred<any>(),requests:number[]=[];
 const sync=createDraftSync({initial:{revision:1,content:{text:'initial'}},storage:new MemoryStorage(),tab:'tab',prefix:'read-lock:',read:()=>value,restore:v=>{value=v;},enabled:()=>true,fetch:()=>{reads++;return d.promise;},send:async(v,r)=>{requests.push(r);return{revision:r+1,content:v};},state:s=>{state=s;},debounce:60000});
 try{const resuming=sync.resume();value={text:'typed during refresh'};sync.touch();const saving=sync.flush(true);assert.equal(requests.length,0);d.resolve({revision:2,content:{text:'initial'}});await resuming;await saving;assert.equal(reads,1);assert.deepEqual(requests,[2]);assert.equal(value.text,'typed during refresh');assert.equal(state.kind,'saved');}finally{sync.dispose();}
});
test('several interrupted reloads remove acknowledged ancestor backups without deleting another live tab',async()=>{
 const storage=new MemoryStorage(),first=fixture(storage,'first');first.value={text:'offline draft'};first.sync.touch();first.sync.dispose();
 const second=fixture(storage,'second');second.sync.restore();second.value={text:'newer offline draft'};second.sync.touch();second.sync.dispose();
 const third=fixture(storage,'third');try{third.sync.restore();assert.equal(third.value.text,'newer offline draft');await third.sync.flush();assert.equal(storage.length,0);}finally{third.sync.dispose();}
 const active=fixture(storage,'live');active.value={text:'initial offline'};active.sync.touch();
 const reopened=fixture(storage,'reopen');try{reopened.sync.restore();active.value={text:'newer in another tab'};active.sync.touch();await reopened.sync.flush();assert.equal(storage.length,1);assert.match(storage.getItem('owner:exhibition:submission:schema:live')!,/newer in another tab/);}finally{active.sync.dispose();reopened.sync.dispose();}
});
