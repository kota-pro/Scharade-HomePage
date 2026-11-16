import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {writeData} from '../src/lib/store.ts';
import {exhibitionAction,readExhibitions,updateExhibitionStore,exhibitionAssetPath} from '../src/lib/exhibitions.ts';
import {exhibitionAlbumPhotos,parseAlbumExclusions} from '../src/lib/exhibitionAlbumPhotos.ts';
import {createExhibitionAlbum,uploadExhibitionAssetToLightroom,drainExhibitionQueues} from '../src/lib/exhibitionIntegrations.ts';
import {exhibitionPhotoEntries} from '../src/lib/galleryCatalog.ts';
import {GET} from '../src/pages/api/member/exhibitions/[id]/album-photos.ts';
import {POST} from '../src/pages/api/member/exhibitions.ts';

async function fixture(run:(f:any)=>Promise<void>){
 const before={...process.env},fetchBefore=globalThis.fetch,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-lightroom-picker-'));process.env.DATA_DIR=dir;
 try{
  writeData('users.json',[{id:'staff',name:'運営',email:'staff@example.invalid',approved:true,role:'staff'},{id:'member',name:'会員',email:'member@example.invalid',approved:true,role:'member'}]);
  Object.assign(process.env,{ADOBE_CLIENT_ID:'fixture-client',ADOBE_CLIENT_SECRET:'fixture-secret',ADOBE_REFRESH_TOKEN:'fixture-refresh',LIGHTROOM_CATALOG_ID:'fixture',EXHIBITION_GAS_URL:'',EXHIBITION_WEBHOOK_SECRET:'',EXHIBITION_DRIVE_GAS_URL:'',EXHIBITION_DRIVE_WEBHOOK_SECRET:''});writeData('adobe-auth.json',{accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:Date.now()+86400000});
  const e=(await exhibitionAction('staff',{action:'create',title:'除外を選ぶ写真展'})).exhibition,submissionId=crypto.randomUUID(),ids=Array.from({length:4},()=>crypto.randomUUID());
  const content=(assetId:string,title:string)=>({name:'提出者',authorName:'作者',grade:'1年',fields:{},portfolioUrl:'',sections:[],works:[{id:crypto.randomUUID(),title,kind:'single',photos:[{assetId}]}]});
  await updateExhibitionStore(data=>{data.submissions.push({id:submissionId,exhibitionId:e.id,userId:'member',revision:1,draft:content(ids[2],'下書き'),versions:[{version:1,content:content(ids[0],'以前の写真'),delivery:'delivered'},{version:2,content:content(ids[1],'現在の写真'),delivery:'delivered'}]} as any);for(const [i,id] of ids.entries())data.assets.push({id,exhibitionId:i===3?crypto.randomUUID():e.id,submissionId,name:`写真${i}.png`,mimeType:'image/png',bytes:4,width:1,height:1,createdAt:new Date().toISOString(),sha256:'fixture',lightroomId:id.replaceAll('-','')} as any);});
  for(const id of ids){fs.mkdirSync(path.dirname(exhibitionAssetPath(id)),{recursive:true});fs.writeFileSync(exhibitionAssetPath(id),'data');}
  const calls:any[]=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),method:init?.method??'GET',body:init?.body});if(!init?.method||init.method==='GET')return new Response(null,{status:404});return new Response(null,{status:204});};
  await run({e,ids,submissionId,calls});
 }finally{globalThis.fetch=fetchBefore;for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);fs.rmSync(dir,{recursive:true,force:true});}
}
test('picker lists only the latest submitted photos and rejects historical, draft, foreign or malformed exclusions',()=>fixture(async({e,ids})=>{
 const data=readExhibitions(),photos=exhibitionAlbumPhotos(data,e.id);assert.deepEqual(photos.map(p=>[p.id,p.current]),[[ids[1],true]]);assert.deepEqual(parseAlbumExclusions([ids[1],ids[1]],data,e),[ids[1]]);
 for(const value of [[ids[0]],[ids[2]],[ids[3]],['bad'],null,Array(5001).fill(ids[0])])assert.throws(()=>parseAlbumExclusions(value,data,e));
 const older=crypto.randomUUID();e.albumExcludedAssetIds=[older];assert.deepEqual(parseAlbumExclusions([older],data,e),[older]);
}));
test('staff-only selection is revision checked and reuses the album; exclusion hides gallery photos without modifying submissions',()=>fixture(async({e,ids,calls})=>{
 const locals=(role:string)=>({user:{id:role,approved:true,role}}),request=(body:any)=>new Request('https://example.invalid/api/member/exhibitions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await GET({locals:{},params:{id:e.id}} as any)).status,401);assert.equal((await GET({locals:locals('member'),params:{id:e.id}} as any)).status,403);
 const denied=await POST({locals:locals('member'),request:request({action:'lightroom.create',exhibitionId:e.id,revision:e.revision,excludedAssetIds:[ids[1]]})} as any);assert.equal(denied.status,403);assert.equal(calls.length,0);
 const before=JSON.stringify(readExhibitions().submissions),send=async(revision:number,excludedAssetIds:string[])=>POST({locals:locals('staff'),request:request({action:'lightroom.create',exhibitionId:e.id,revision,excludedAssetIds})} as any);
 assert.equal((await send(e.revision+1,[ids[1]])).status,409);assert.equal(calls.length,0);
 assert.equal((await send(e.revision,[ids[1]])).status,200);let saved=readExhibitions().exhibitions[0];assert.equal(saved.albumId,e.albumId);assert.deepEqual(saved.albumExcludedAssetIds,[ids[1]]);assert.equal(exhibitionPhotoEntries(e.albumId)!.entries.length,0);assert.equal(JSON.stringify(readExhibitions().submissions),before);
 const selected=await(await GET({locals:locals('staff'),params:{id:e.id}} as any)).json();assert.deepEqual(selected.excludedAssetIds,[ids[1]]);assert.deepEqual(selected.photos.map((p:{id:string})=>p.id),[ids[1]]);
 assert.equal((await send(saved.revision,[])).status,200);assert.equal(exhibitionPhotoEntries(e.albumId)!.entries.length,1);assert.equal(calls.filter((c:any)=>c.method==='PUT'&&!c.url.endsWith('/master')).length,1);assert.equal(calls.some((c:any)=>c.method==='DELETE'),false);
}));
test('historical, draft and excluded photos never upload; a current photo is added only once',()=>fixture(async({e,ids,calls})=>{
 await createExhibitionAlbum(e.id,'https://example.invalid',{actorId:'staff',revision:e.revision,excludedAssetIds:[ids[1]]});calls.length=0;
 for(const id of ids.slice(0,3))await uploadExhibitionAssetToLightroom(e.id,id,'https://example.invalid');
 await drainExhibitionQueues('https://example.invalid',10);assert.equal(calls.length,0);
 const saved=readExhibitions().exhibitions[0];await createExhibitionAlbum(e.id,'https://example.invalid',{actorId:'staff',revision:saved.revision,excludedAssetIds:[]});calls.length=0;
 await drainExhibitionQueues('https://example.invalid',10);assert.equal(calls.filter((c:any)=>c.url.endsWith('/master')).length,1);
 assert.ok(calls.some((c:any)=>c.url.endsWith('/master')&&c.url.includes(ids[1].replaceAll('-',''))));
 assert.equal(readExhibitions().assets.find(a=>a.id===ids[1])!.albumAdded,true);
 assert.equal(readExhibitions().assets.find(a=>a.id===ids[0])!.albumAdded,undefined);
 calls.length=0;await uploadExhibitionAssetToLightroom(e.id,ids[1],'https://example.invalid');assert.equal(calls.length,0);
}));
test('connection failure preserves the chosen exclusions for retry and a simultaneous update cannot replace them',()=>fixture(async({e,ids})=>{
 globalThis.fetch=async()=>{throw new Error('offline');};await assert.rejects(()=>createExhibitionAlbum(e.id,'https://example.invalid',{actorId:'staff',revision:e.revision,excludedAssetIds:[ids[1]]}));
 let saved=readExhibitions().exhibitions[0];assert.deepEqual(saved.albumExcludedAssetIds,[ids[1]]);assert.equal(saved.albumSync?.pending,true);
 await updateExhibitionStore(data=>{data.exhibitions[0].albumSync!.leaseUntil=Date.now()+60000;});await assert.rejects(()=>createExhibitionAlbum(e.id,'https://example.invalid',{actorId:'staff',revision:saved.revision,excludedAssetIds:[]}),error=>(error as any).status===409);saved=readExhibitions().exhibitions[0];assert.deepEqual(saved.albumExcludedAssetIds,[ids[1]]);
}));
