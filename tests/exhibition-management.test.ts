import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {writeData} from "../src/lib/store.ts";
import {exhibitionAction,readExhibitions,updateExhibitionStore,exhibitionAssetPath} from "../src/lib/exhibitions.ts";
import {deleteExhibition,drainExhibitionDeletions} from "../src/lib/exhibitionDeletion.ts";
import {createExhibitionAlbum,createExhibitionGoogleForm,deleteExhibitionAlbum} from "../src/lib/exhibitionIntegrations.ts";
import {emptyActivities} from "../src/lib/activityTypes.ts";
import {readActivities} from "../src/lib/activities.ts";
import {notificationRecipient} from "../src/lib/notificationRecipients.ts";

async function fixture(run:()=>Promise<void>){
  const envBefore={...process.env},fetchBefore=globalThis.fetch,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-management-'));
  process.env.DATA_DIR=dir;
  try{writeData('users.json',[{id:'staff',name:'運営',email:'staff@example.invalid',approved:true,role:'staff'},{id:'member',name:'会員',email:'member@example.invalid',approved:true,role:'member'}]);await run();}
  finally{globalThis.fetch=fetchBefore;for(const key of Object.keys(process.env))if(!(key in envBefore))delete process.env[key];Object.assign(process.env,envBefore);fs.rmSync(dir,{recursive:true,force:true});}
}
test('deletion checks role, revision and title, backs up images, isolates other exhibitions and retries Google cleanup',()=>fixture(async()=>{
  process.env.EXHIBITION_GAS_URL='https://script.google.com/macros/s/fixture/exec';process.env.EXHIBITION_WEBHOOK_SECRET='d'.repeat(64);
  delete process.env.EXHIBITION_DRIVE_GAS_URL;delete process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET;
  const e=(await exhibitionAction('staff',{action:'create',title:'消す写真展'})).exhibition,other=(await exhibitionAction('staff',{action:'create',title:'残す写真展'})).exhibition;
  const assetId=crypto.randomUUID(),submissionId=crypto.randomUUID(),image=Buffer.from('backup fixture');
  fs.mkdirSync(path.dirname(exhibitionAssetPath(assetId)),{recursive:true});fs.writeFileSync(exhibitionAssetPath(assetId),image);fs.writeFileSync(exhibitionAssetPath(assetId,true),image);
  await updateExhibitionStore(data=>{data.exhibitions[0].googleForms=[{schemaVersion:1,formId:'form_fixture_123',spreadsheetId:'sheet_fixture_123',itemIds:{}}];data.assets.push({id:assetId,exhibitionId:e.id,submissionId,name:'写真.png',mimeType:'image/png',bytes:image.length,sha256:'fixture',width:1,height:1,createdAt:new Date().toISOString(),lightroomId:'a'.repeat(32)});});
  const activities=emptyActivities();activities.notifications=[e,other].map(x=>({id:crypto.randomUUID(),exhibitionId:x.id,title:x.title,body:'',senderId:'staff',senderName:'運営',recipientIds:['member'],createdAt:new Date().toISOString(),readBy:{}}));writeData('member-activities.json',activities);
  await assert.rejects(()=>deleteExhibition('member',e.id,e.revision,e.title));
  await assert.rejects(()=>deleteExhibition('staff',e.id,e.revision+1,e.title));
  await assert.rejects(()=>deleteExhibition('staff',e.id,e.revision,'間違い'));
  assert.equal(readExhibitions().exhibitions.length,2);
  await deleteExhibition('staff',e.id,e.revision,e.title);
  const job=readExhibitions().deletions![0];assert.deepEqual(fs.readFileSync(path.join(job.backupDir,path.basename(exhibitionAssetPath(assetId)))),image);
  assert.equal(JSON.parse(fs.readFileSync(path.join(job.backupDir,'exhibition.json'),'utf8')).assets.length,1);
  assert.deepEqual(readExhibitions().exhibitions.map(x=>x.id),[other.id]);assert.equal(readExhibitions().assets.length,0);
  let fail=true;const requests:any[]=[];globalThis.fetch=async(_,init)=>{requests.push(JSON.parse(JSON.parse(String(init?.body)).payload));if(fail)throw new Error('network-down');return Response.json({ok:true,deleted:true});};
  await updateExhibitionStore(data=>{data.deletions![0].notBefore=0;});await drainExhibitionDeletions();
  assert.equal(readExhibitions().deletions![0].status,'pending');assert.equal(fs.existsSync(exhibitionAssetPath(assetId)),false);assert.deepEqual(readActivities().notifications.map(n=>n.exhibitionId),[other.id]);
  fail=false;await updateExhibitionStore(data=>{data.deletions![0].nextAttemptAt=0;});await drainExhibitionDeletions();
  assert.equal(readExhibitions().deletions![0].status,'complete');assert.equal(requests[1].exhibitionId,e.id);assert.deepEqual(requests[1].formIds,['form_fixture_123']);
  assert.equal(fs.existsSync(path.join(job.backupDir,'exhibition.json')),true);assert.equal((await deleteExhibition('staff',e.id,e.revision,e.title)).cleanup,'complete');
}));
test('Google schema and title changes overwrite the known form and queue automatic synchronization',()=>fixture(async()=>{
  process.env.EXHIBITION_DRIVE_GAS_URL='https://script.google.com/macros/s/fixture/exec';process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET='d'.repeat(64);
  const requests:any[]=[];globalThis.fetch=async(_,init)=>{const p=JSON.parse(JSON.parse(String(init?.body)).payload);requests.push(p);if(p.action==='health')return Response.json({ok:true,gatewayVersion:3,owner:'sharadeshashinten@gmail.com',driveApi:true});if(p.action==='folders.ensure')return Response.json({ok:true,owner:'sharadeshashinten@gmail.com',folderId:'folder_fixture_123',originalsId:'originals_fixture_123',layoutsId:'layouts_fixture_123',outputsId:'outputs_fixture_123',yearFolderName:`${p.year}年`});return Response.json({ok:true,formId:'form_fixture_123',spreadsheetId:'sheet_fixture_123',itemIds:{title:1}});};
  let e=(await exhibitionAction('staff',{action:'create',title:'春展'})).exhibition;const first=await createExhibitionGoogleForm(e.id);e=readExhibitions().exhibitions[0];
  e=(await exhibitionAction('staff',{action:'schema',exhibitionId:e.id,revision:e.revision,schema:{...e.schemas[0],captionLabel:'作品の説明'}})).exhibition;
  assert.equal(e.googleSync?.pending,true);const updated=await createExhibitionGoogleForm(e.id);assert.equal(updated.formId,first.formId);assert.equal(updated.spreadsheetId,first.spreadsheetId);
  const request=requests.filter(p=>p.action==='form.create')[1];assert.equal(request.formId,first.formId);assert.equal(request.schemaVersion,2);assert.equal(readExhibitions().exhibitions[0].googleSync?.pending,false);
}));
test('Lightroom creation collision and later changes update the same album; failed updates remain pending',()=>fixture(async()=>{
  Object.assign(process.env,{ADOBE_CLIENT_ID:'fixture-client',ADOBE_CLIENT_SECRET:'fixture-secret',ADOBE_REFRESH_TOKEN:'fixture-refresh',LIGHTROOM_CATALOG_ID:'fixture'});writeData('adobe-auth.json',{accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:Date.now()+86400000});
  let e=(await exhibitionAction('staff',{action:'create',title:'写真展'})).exhibition;const methods:string[]=[];let fail=false,probes=0;
  globalThis.fetch=async(_,init)=>{const method=init?.method??'GET';methods.push(method);if(method==='PUT')return new Response(null,{status:412});if(method==='GET'){if(probes++===0)return new Response(null,{status:404});return new Response('while (1) {} '+JSON.stringify({serviceId:'fixture-client',payload:{publishInfo:{remoteId:e.id}}}));}return new Response(null,{status:fail?409:204});};
  assert.equal(await createExhibitionAlbum(e.id,'https://example.invalid'),e.albumId);assert.deepEqual(methods,['GET','PUT','GET','POST']);
  methods.length=0;assert.equal(await createExhibitionAlbum(e.id,'https://example.invalid'),e.albumId);assert.deepEqual(methods,['POST']);
  await updateExhibitionStore(data=>{data.exhibitions[0].albumCreated=false;});methods.length=0;assert.equal(await createExhibitionAlbum(e.id,'https://example.invalid'),e.albumId);assert.deepEqual(methods,['GET','POST']);
  fail=true;await assert.rejects(()=>createExhibitionAlbum(e.id,'https://example.invalid'),/lightroom-409/);assert.equal(readExhibitions().exhibitions[0].albumSync?.pending,true);
}));
test('notification recipient grades use a linked roster profile and leave missing grades selectable',()=>{
  const data=emptyActivities();data.profiles.a={gender:'undisclosed',grade:'2',revision:1,rosterKey:'roster-a'};data.profiles.b={gender:'undisclosed',grade:'1',revision:1};
  assert.equal(notificationRecipient({id:'a',name:'山田'},data).grade,'2');assert.equal(notificationRecipient({id:'b',name:'佐藤'},data).grade,'unknown');
});
test('Lightroom deletion refuses unrelated albums and tolerates an already deleted album',()=>fixture(async()=>{
  Object.assign(process.env,{ADOBE_CLIENT_ID:'fixture-client',ADOBE_CLIENT_SECRET:'fixture-secret',ADOBE_REFRESH_TOKEN:'fixture-refresh',LIGHTROOM_CATALOG_ID:'fixture'});writeData('adobe-auth.json',{accessToken:'fixture',refreshToken:'fixture',accessTokenExpiresAt:Date.now()+86400000});
  const id=crypto.randomUUID(),methods:string[]=[];let related=false,gone=false;
  globalThis.fetch=async(_,init)=>{const method=init?.method??'GET';methods.push(method);if(method==='DELETE'){gone=true;return new Response(null,{status:204});}if(gone)return new Response(null,{status:404});return new Response('while (1) {} '+JSON.stringify({serviceId:'fixture-client',payload:{publishInfo:{remoteId:related?id:crypto.randomUUID()}}}));};
  await assert.rejects(()=>deleteExhibitionAlbum('a'.repeat(32),id,true),/紐付け/);assert.deepEqual(methods,['GET']);related=true;await deleteExhibitionAlbum('a'.repeat(32),id,true);await deleteExhibitionAlbum('a'.repeat(32),id,true);assert.deepEqual(methods,['GET','GET','DELETE','GET']);
}));
