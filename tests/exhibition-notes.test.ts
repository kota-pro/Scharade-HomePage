import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {writeData} from '../src/lib/store.ts';
import {exhibitionAction,publicAction,readExhibitions,updateExhibitionStore} from '../src/lib/exhibitions.ts';
import {parseContent} from '../src/lib/exhibitionValidation.ts';
import {emptySubmission} from '../src/lib/exhibitionTypes.ts';
import {exhibitionNotesLimit} from '../src/lib/exhibitionNotes.ts';
import {draftFingerprint} from '../src/scripts/exhibitionDraftSync.ts';
import {importTitleBoardRows} from '../src/lib/exhibitionSheetImport.ts';
import {createExhibitionGoogleForm,deliverExhibitionVersion} from '../src/lib/exhibitionIntegrations.ts';

async function fixture(run:(e:any)=>Promise<void>) {
 const previous=process.env.DATA_DIR, dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-notes-'));process.env.DATA_DIR=dir;
 try {
  writeData('users.json',['staff','author'].map(id=>({id,name:id,email:`${id}@example.invalid`,role:id==='staff'?'staff':'member',approved:true,createdAt:'2026-01-01',providers:{}})));
  await exhibitionAction('staff',{action:'create',title:'備考の検証'});
  await updateExhibitionStore(data=>{const x=data.exhibitions[0], iso=(d:number)=>new Date(Date.now()+d).toISOString();x.status='open';x.opensAt=iso(-60000);x.closesAt=iso(3600000);x.participation={state:'published',opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['author'],votes:{author:{value:'attending',at:iso(0),actorId:'author'}}};});
  await run(readExhibitions().exhibitions[0]);
 } finally {if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
function content(e:any){const sectionId=e.schemas[0].sections[0].id;return {...emptySubmission(),name:'作者',authorName:'作者',grade:'2年',sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[{id:crypto.randomUUID(),sectionId,kind:'book',title:'本',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[]}]};}
const longNotes='連絡事項\n'+'長文のご要望。'.repeat(1400)+'\n<script>これは文字列です</script>';
test('optional notes support 10,000 characters independently of printed caption limits and reject malformed input',async()=>fixture(async e=>{
 const value=content(e),schema=e.schemas[0];assert.equal(Object.hasOwn(parseContent(value,schema,[]),'notes'),false);
 assert.equal(parseContent({...value,notes:'あ'.repeat(exhibitionNotesLimit)},schema,[]).notes!.length,10000);
 assert.equal(parseContent({...value,notes:longNotes},schema,[]).notes,longNotes);
 for(const notes of ['あ'.repeat(10001),null,{},10,'bad\x00'])assert.throws(()=>parseContent({...value,notes},schema,[]),/その他ご意見、ご要望など/);
 assert.equal(draftFingerprint(value),draftFingerprint({...value,notes:' \n '}));assert.notEqual(draftFingerprint(value),draftFingerprint({...value,notes:longNotes}));
}));
test('save, submit, legacy clients, board corrections and explicit clearing retain the intended notes without bypassing permissions',async()=>fixture(async e=>{
 let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;
 const send=async(action:string,value:any)=>{s=(await publicAction(e.id,'',{action,revision:s.revision,content:value},'author')).submission;return s;};
 const value=content(e);await send('save',{...value,notes:longNotes});assert.equal(s.draft.notes,longNotes);await send('submit',value);
 assert.equal(readExhibitions().submissions[0].versions.at(-1)!.content.notes,longNotes);
 const before=structuredClone(readExhibitions());await assert.rejects(publicAction(e.id,'',{action:'save',revision:s.revision,ownerId:'someone-else',content:{...value,notes:'changed'}},'author'),(error:any)=>error.status===401);assert.deepEqual(readExhibitions(),before);
 const corrected={...value,works:value.works.map(w=>({...w,title:'本の修正'}))};
 await exhibitionAction('staff',{action:'submission.board',exhibitionId:e.id,revision:readExhibitions().exhibitions[0].revision,submissionId:s.id,submissionRevision:s.revision,content:corrected});
 s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;assert.equal(s.draft.notes,longNotes);assert.equal(readExhibitions().submissions[0].versions.at(-1)!.content.notes,longNotes);
 const saved=structuredClone(readExhibitions());await assert.rejects(send('save',{...value,notes:'あ'.repeat(10001)}),/その他ご意見、ご要望など/);assert.deepEqual(readExhibitions(),saved);
 await send('save',{...value,notes:''});assert.equal(s.draft.notes,'');assert.equal(readExhibitions().submissions[0].versions.at(-1)!.content.notes,longNotes);await send('submit',{...value,notes:''});assert.equal(readExhibitions().submissions[0].versions.at(-1)!.content.notes,'');
 await updateExhibitionStore(data=>{data.exhibitions[0].closesAt=new Date(Date.now()-1000).toISOString();});await send('save',{...value,notes:'期限後'});assert.equal(s.draft.notes,'期限後');
 await updateExhibitionStore(data=>{data.exhibitions[0].status='closed';});await assert.rejects(send('save',{...value,notes:'受付終了後'}),/入力期間外/);
}));
test('sheet import accepts long notes only in the notes column and retains them when an older sheet omits the column',async()=>fixture(async e=>{
 const header=['提出ID','作品ID','名前','学年','作品タイトル','作品種別','備考'],row=['s1','w1','作者','2年','本','ブック',longNotes];
 assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_1234567890','提出結果',[header,row])).imported,1);assert.equal(readExhibitions().submissions[0].draft.notes,longNotes);
 for (const label of ['その他ご意見、ご要望など','その他ご意見、要望など']) assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_1234567890','提出結果',[[...header.slice(0,-1),label],row])).unchanged,1);
 assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_1234567890','提出結果',[header.slice(0,-1),row.slice(0,-1)])).unchanged,1);
 const invalid=[...row];invalid[4]='あ'.repeat(4001);await assert.rejects(importTitleBoardRows(e.id,'sheet_fixture_1234567890','提出結果',[header,invalid]),/備考以外/);
 assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_1234567890','提出結果',[header,[...row.slice(0,-1),'']])).imported,1);assert.equal(readExhibitions().submissions[0].draft.notes,'');
}));
test('Google updates existing forms in place with a final optional paragraph and archives full notes without changing legacy empty-answer retries',async()=>fixture(async e=>{
 const prior={url:process.env.EXHIBITION_GAS_URL,secret:process.env.EXHIBITION_WEBHOOK_SECRET,fetch:globalThis.fetch};
 process.env.EXHIBITION_GAS_URL='https://script.google.com/macros/s/notesfixture/exec';process.env.EXHIBITION_WEBHOOK_SECRET='n'.repeat(64);
 const forms:any[]=[],deliveries:any[]=[];
 globalThis.fetch=async(_url,init)=>{const p=JSON.parse(JSON.parse(String(init?.body)).payload);if(p.action==='health')return Response.json({ok:true});if(p.action==='form.create'){forms.push(p);return Response.json({ok:true,formId:'existing_form_123',spreadsheetId:'existing_sheet_123',itemIds:{notes:42}});}if(p.action==='response.submit'){deliveries.push(p);return Response.json({ok:true,delivered:p.rows.map((r:any)=>r.idempotencyKey)});}throw new Error(p.action);};
 try {
  await updateExhibitionStore(data=>{data.exhibitions[0].googleForms=[{connectionId:'legacy',schemaVersion:1,formId:'existing_form_123',spreadsheetId:'existing_sheet_123',itemIds:{}}];});
  await createExhibitionGoogleForm(e.id);assert.equal(forms.length,1);assert.equal(forms[0].formId,'existing_form_123');assert.deepEqual(forms[0].fields.at(-1),{id:'notes',title:'その他ご意見、ご要望など',paragraph:true,required:false});
  let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;const value=content(e);
  s=(await publicAction(e.id,'',{action:'submit',revision:s.revision,content:value},'author')).submission;assert.equal(await deliverExhibitionVersion(e.id,s.id,1),true);assert.equal(Object.hasOwn(deliveries[0].rows[0].answers,'notes'),false);
  s=(await publicAction(e.id,'',{action:'submit',revision:s.revision,content:{...value,notes:longNotes}},'author')).submission;assert.equal(await deliverExhibitionVersion(e.id,s.id,2),true);assert.equal(deliveries[1].rows[0].answers.notes,longNotes);assert.equal(deliveries[1].rows[0].fieldLabels.notes,'その他ご意見、ご要望など');
 } finally {globalThis.fetch=prior.fetch;if(prior.url===undefined)delete process.env.EXHIBITION_GAS_URL;else process.env.EXHIBITION_GAS_URL=prior.url;if(prior.secret===undefined)delete process.env.EXHIBITION_WEBHOOK_SECRET;else process.env.EXHIBITION_WEBHOOK_SECRET=prior.secret;}
}));
