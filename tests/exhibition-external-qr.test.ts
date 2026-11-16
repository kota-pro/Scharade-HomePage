import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { submissionQrTarget } from '../src/lib/exhibitionQrTarget.ts';
import { qrBrand } from '../src/lib/qrBrand.ts';
import { qrFor, titleBoardWorks } from '../src/lib/exhibitionOutputs.ts';
import { titleBoardPreview, previewOwnTitleBoard, withTitleBoardImages } from '../src/lib/exhibitionTitleBoardPreview.ts';
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore } from '../src/lib/exhibitions.ts';
import { importTitleBoardRows } from '../src/lib/exhibitionSheetImport.ts';
import { emptySubmission, latestContent, type Submission, type SubmissionContent } from '../src/lib/exhibitionTypes.ts';
import { writeData } from '../src/lib/store.ts';
import { createExhibitionGoogleForm, deliverExhibitionVersion } from '../src/lib/exhibitionIntegrations.ts';

const origin='https://scharade.jp';
const instagram='https://www.instagram.com/example_photo/?igsh=abc';
const account=`${origin}/Portfolio/author`;
function content(sectionId:string=crypto.randomUUID(),url=instagram):SubmissionContent {
  return {...emptySubmission(),name:'作者',authorName:'作者',grade:'2年',portfolioUrl:url,
    sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],
    works:[{id:crypto.randomUUID(),sectionId,kind:'book',title:'光',caption:'',location:'',equipment:'',settings:'',photos:[],fields:{}}]};
}
function submission(c=content()):Submission {
  return {id:crypto.randomUUID(),exhibitionId:crypto.randomUUID(),tokenHash:'',createdAt:'2026-01-01',updatedAt:'2026-01-01',revision:1,schemaVersion:1,draft:c,
    portfolioId:'author',qrConfirmed:true,versions:[{version:1,schemaVersion:1,at:'2026-01-01',content:c,delivery:'delivered',attempts:0,nextAttemptAt:0}]};
}
async function decodeBoard(png:Uint8Array) {
  const pixels=await sharp(png).extract({left:632,top:394,width:144,height:144}).ensureAlpha().raw().toBuffer();
  return jsQR(new Uint8ClampedArray(pixels),144,144)?.data;
}
function isolated() {
  const previous=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-external-qr-'));process.env.DATA_DIR=dir;
  writeData('users.json',[
    {id:'staff',name:'運営',role:'staff',approved:true,email:'staff@example.invalid',createdAt:'2026-01-01',providers:{}},
    {id:'author',name:'作者',role:'member',approved:true,portfolioId:'author',email:'author@example.invalid',createdAt:'2026-01-01',providers:{}},
  ]);
  return ()=>{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});};
}
test('explicit external URLs take precedence over legacy automatic accounts, while deliberate staff choices remain usable',()=>{
  const s=submission();assert.equal(qrFor(s,origin),instagram);assert.equal(submissionQrTarget(s,origin).confirmed,true);
  s.qrConfirmed=false;assert.equal(submissionQrTarget(s,origin).confirmed,true);
  s.qrSource='account';s.qrConfirmed=true;assert.equal(qrFor(s,origin),account);
  s.qrSource='external';assert.equal(qrFor(s,origin),instagram);
  delete s.qrSource;latestContent(s)!.portfolioUrl='';assert.equal(qrFor(s,origin),account);
  for(const url of ['javascript:alert(1)','https://user:password@instagram.com/example','https://instagram.com:8443/example']) {
    latestContent(s)!.portfolioUrl=url;assert.equal(qrFor(s,origin),'');assert.equal(submissionQrTarget(s,origin).confirmed,false);
  }
});
test('actual card and room previews encode the entered URL and select the matching local SNS logo',async()=>{
  for(const [url,brand] of [[instagram,'instagram'],['https://x.com/example_photo','x'],['https://twitter.com/example_photo','x'],['https://example.org/author',null],[account,'scharade']] as const) {
    const s=submission(content(undefined,url)),work=latestContent(s)!.works[0];
    assert.equal(qrBrand(qrFor(s,origin),origin),brand);
    const preview=await titleBoardPreview({submission:s,work,qrUrl:qrFor(s,origin)},origin);
    assert.equal(await decodeBoard(preview.png),url);assert.deepEqual(preview.issues,[]);
    const e={id:s.exhibitionId,rooms:[{titleBoards:[{workId:work.id}]}]} as any;
    const data={version:1,exhibitions:[e],submissions:[s],assets:[]} as any;
    assert.equal(titleBoardWorks(data,e,origin)[0].qrUrl,url);
    const placed=await withTitleBoardImages([work],data,e,origin);
    assert.equal(await decodeBoard(Buffer.from(placed[0].titleBoardImage!.split(',')[1],'base64')),url);
  }
  assert.equal(qrBrand('https://instagram.com.evil.invalid/example',origin),null);
  assert.equal(qrBrand('https://example.org/?url=https://x.com/example',origin),null);
});
test('submit, preview, staff corrections, intentional QR overrides and clearing the external URL stay consistent without rewriting history',async()=>{
  const cleanup=isolated();try {
    const e=(await exhibitionAction('staff',{action:'create',title:'外部QRの確認'})).exhibition;
    await updateExhibitionStore(data=>{const value=data.exhibitions[0],iso=(d:number)=>new Date(Date.now()+d).toISOString();value.status='open';value.opensAt=iso(-60000);value.closesAt=iso(3600000);value.participation={state:'published',opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['author'],votes:{author:{value:'attending',actorId:'author',at:iso(-1000)}}};});
    const initial=await publicAction(e.id,'',{action:'begin'},'author'),c=content(e.schemas[0].sections[0].id);
    const own=await previewOwnTitleBoard(e.id,'',{...c,work:c.works[0]},'author',origin);assert.equal(own.qrUrl,instagram);assert.deepEqual(own.issues,[]);
    await publicAction(e.id,'',{action:'submit',revision:initial.submission.revision,content:c},'author');
    const current=()=>readExhibitions().submissions[0];const first=structuredClone(current().versions[0]);
    assert.equal(current().portfolioId,undefined);assert.equal(current().qrConfirmed,true);assert.equal(qrFor(current(),origin),instagram);
    async function choose(portfolioId?:string) {const data=readExhibitions();await exhibitionAction('staff',{action:'qr',exhibitionId:e.id,revision:data.exhibitions[0].revision,submissionId:current().id,...(portfolioId?{portfolioId}:{})});}
    await choose('author');assert.equal(qrFor(current(),origin),account);
    const unchanged=await previewOwnTitleBoard(e.id,'',{...c,work:c.works[0]},'author',origin);assert.equal(unchanged.qrUrl,account);
    await publicAction(e.id,'',{action:'submit',revision:current().revision,content:c},'author');assert.equal(qrFor(current(),origin),account);
    await choose();assert.equal(qrFor(current(),origin),instagram);
    const next={...c,portfolioUrl:'https://x.com/example_photo'};
    const changed=await previewOwnTitleBoard(e.id,'',{...next,work:next.works[0]},'author',origin);assert.equal(changed.qrUrl,next.portfolioUrl);
    await exhibitionAction('staff',{action:'submission.edit',exhibitionId:e.id,revision:readExhibitions().exhibitions[0].revision,submissionId:current().id,submissionRevision:current().revision,content:next});
    assert.equal(qrFor(current(),origin),next.portfolioUrl);assert.equal(current().qrSource,undefined);
    await publicAction(e.id,'',{action:'submit',revision:current().revision,content:{...next,portfolioUrl:''}},'author');assert.equal(qrFor(current(),origin),account);
    assert.deepEqual(current().versions[0],first);
  } finally{cleanup();}
});
test('sheet imports prioritize external URLs despite a uniquely matched account and retain them on re-import',async()=>{
  const cleanup=isolated();try {
    const e=(await exhibitionAction('staff',{action:'create',title:'取り込みQR'})).exhibition;
    const rows=[['名前','学年','作品タイトル','外部Portfolio URL'],['作者','2年','光',instagram]];
    const imported=await importTitleBoardRows(e.id,'source_spreadsheet','回答',rows);assert.equal(imported.imported,1);
    const s=readExhibitions().submissions[0];assert.equal(s.portfolioId,undefined);assert.equal(qrFor(s,origin),instagram);assert.equal(s.qrConfirmed,true);
    assert.equal((await importTitleBoardRows(e.id,'source_spreadsheet','回答',rows)).unchanged,1);
  } finally{cleanup();}
});
test('Google form updates retain their IDs and export the exact external URL for sheet round trips',async()=>{
  const cleanup=isolated(),oldFetch=globalThis.fetch;
  const keys=['EXHIBITION_GAS_URL','EXHIBITION_WEBHOOK_SECRET'] as const,old=keys.map(key=>process.env[key]);
  const requests:any[]=[];
  try {
    process.env.EXHIBITION_GAS_URL='https://script.google.com/macros/s/fixture/exec';process.env.EXHIBITION_WEBHOOK_SECRET='x'.repeat(64);
    const e=(await exhibitionAction('staff',{action:'create',title:'URL連携'})).exhibition,c=content(e.schemas[0].sections[0].id),s=submission(c);s.exhibitionId=e.id;s.versions[0].delivery='pending';
    await updateExhibitionStore(data=>{data.submissions.push(s);data.exhibitions[0].googleForms=[{connectionId:'legacy',schemaVersion:1,formId:'form_fixture_123',spreadsheetId:'sheet_fixture_123',itemIds:{name:10,title:11}}];});
    globalThis.fetch=async(_input,init)=>{const r=JSON.parse(JSON.parse(String(init?.body)).payload);requests.push(r);
      if(r.action==='health')return Response.json({ok:true});
      if(r.action==='form.create')return Response.json({ok:true,formId:r.formId,spreadsheetId:r.spreadsheetId,itemIds:{...Object.fromEntries(r.fields.map((f:any,i:number)=>[f.id,100+i])),name:10,title:11}});
      if(r.action==='response.submit')return Response.json({ok:true,delivered:r.rows.map((row:any)=>row.idempotencyKey)});
      throw new Error('Unexpected fixture action');};
    const form=await createExhibitionGoogleForm(e.id);assert.equal(form.formId,'form_fixture_123');assert.equal(form.itemIds.name,10);
    const field=requests.find(r=>r.action==='form.create').fields.find((f:any)=>f.id==='portfolioUrl');assert.equal(field.title,'外部Portfolio URL');assert.equal(field.required,false);
    assert.equal(await deliverExhibitionVersion(e.id,s.id,1),true);
    const row=requests.find(r=>r.action==='response.submit').rows[0];assert.equal(row.answers.portfolioUrl,instagram);assert.equal(row.fieldLabels.portfolioUrl,'外部Portfolio URL');
  } finally {globalThis.fetch=oldFetch;keys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});cleanup();}
});
