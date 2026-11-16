import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {layoutBoardTitle,titleBoardIssues,titleRubyRows,parseTitleBoardSettings,reconcileTitleRuby,titleBoardSettings} from '../src/lib/exhibitionTitleText.ts';
import {measureBoardText,validateBoardText} from '../src/lib/exhibitionTextMetrics.ts';
import {titleBoardPreview} from '../src/lib/exhibitionTitleBoardPreview.ts';
import {parseContent} from '../src/lib/exhibitionValidation.ts';
import {emptySubmission,type Work,type TitleBoardSettings,type SubmissionContent} from '../src/lib/exhibitionTypes.ts';
import {writeData} from '../src/lib/store.ts';
import {exhibitionAction,publicAction,readExhibitions,updateExhibitionStore} from '../src/lib/exhibitions.ts';
import {submissionEditChanges} from '../src/lib/exhibitionSubmissionEdits.ts';
import {draftFingerprint} from '../src/scripts/exhibitionDraftSync.ts';
import {importTitleBoardRows} from '../src/lib/exhibitionSheetImport.ts';
import {createExhibitionGoogleForm,deliverExhibitionVersion} from '../src/lib/exhibitionIntegrations.ts';
const work=(title='夜明けの記憶'):Work=>({id:crypto.randomUUID(),sectionId:crypto.randomUUID(),kind:'book',title,caption:'',location:'',equipment:'',settings:'',photos:[],fields:{}});
const settings=():TitleBoardSettings=>({quoted:true,rubyEnabled:true,ruby:[{start:0,end:1,base:'夜',reading:'よ'},{start:1,end:2,base:'明',reading:'あ'},{start:4,end:5,base:'記',reading:'き'},{start:5,end:6,base:'憶',reading:'おく'}]});

test('old content keeps brackets; unquoted titles use their own width and do not alter stored title text',()=>{
  const w=work();assert.equal(layoutBoardTitle(w,measureBoardText).text,'「夜明けの記憶」');assert.deepEqual(layoutBoardTitle(w,measureBoardText).ruby,[]);
  w.titleBoard={quoted:false,rubyEnabled:false,ruby:[]};const plain=layoutBoardTitle(w,measureBoardText);assert.equal(plain.text,w.title);assert.equal(plain.x,8);assert.equal(plain.width,89);
  assert.equal(parseTitleBoardSettings({quoted:true,rubyEnabled:false,ruby:[]},w.title),undefined);
});
test('each default reading is centered on its own kanji and kana have no default rows',()=>{
  const w=work();w.titleBoard=settings();const layout=layoutBoardTitle(w,measureBoardText);
  assert.deepEqual(titleRubyRows(w).map(r=>r.base),['夜','明','記','憶']);assert.deepEqual(layout.ruby.map(r=>r.reading),['よ','あ','き','おく']);
  for(const entry of layout.ruby)assert.ok(Math.abs(entry.center-entry.baseX-entry.baseWidth/2)<.000001);
  assert.ok(layout.ruby[2].center-layout.ruby[1].center>20);assert.deepEqual(titleBoardIssues(w,measureBoardText),[]);
});
test('added words override character readings and center arbitrary readings over the whole word; removal restores them',()=>{
  const w=work('永遠の記憶');w.titleBoard={quoted:true,rubyEnabled:true,ruby:[{start:0,end:1,base:'永',reading:'えい'},{start:1,end:2,base:'遠',reading:'えん'},{start:0,end:2,base:'永遠',reading:'ずっと',group:true}]};
  const layout=layoutBoardTitle(w,measureBoardText);assert.equal(layout.ruby.length,1);assert.equal(layout.ruby[0].base,'永遠');assert.equal(layout.ruby[0].reading,'ずっと');assert.ok(Math.abs(layout.ruby[0].baseWidth-measureBoardText('永遠',21,true))<.000001);
  assert.ok(Math.abs(layout.ruby[0].center-layout.rawX-measureBoardText('永遠',21,true)/2)<.000001);
  w.titleBoard.ruby=w.titleBoard.ruby.filter(r=>!r.group);assert.deepEqual(layoutBoardTitle(w,measureBoardText).ruby.map(r=>r.reading),['えい','えん']);
});
test('ranges use Unicode positions, distinguish repeated words, and reject malformed or overlapping groups',()=>{
  const w=work('永遠と永遠');w.titleBoard={quoted:false,rubyEnabled:true,ruby:[{start:3,end:5,base:'永遠',reading:'ずっと',group:true}]};
  assert.equal(layoutBoardTitle(w,measureBoardText).ruby[0].baseX,8+measureBoardText('永遠と',21,true));
  const astral=work('𠮷田');assert.deepEqual(titleRubyRows(astral).map(r=>[r.start,r.base]),[[0,'𠮷'],[1,'田']]);
  for(const raw of [null,{quoted:'yes',rubyEnabled:false,ruby:[]},{quoted:true,rubyEnabled:true,ruby:[{start:0,end:1,base:'永',reading:'x\n'}]},{quoted:true,rubyEnabled:true,ruby:[{start:3,end:5,base:'間違',reading:'あ',group:true}]},{quoted:true,rubyEnabled:true,ruby:[{start:0,end:3,base:'永遠と',reading:'あ',group:true},{start:2,end:5,base:'と永遠',reading:'い',group:true}]}])assert.throws(()=>parseTitleBoardSettings(raw,w.title));
});
test('title edits retain unchanged prefixes and suffixes but remove readings for replaced text',()=>{
  const w=work();w.titleBoard=settings();reconcileTitleRuby(w,w.title,'朝の夜明けの記憶');w.title='朝の夜明けの記憶';
  assert.deepEqual(w.titleBoard!.ruby.map(r=>[r.start,r.base]),[[2,'夜'],[3,'明'],[6,'記'],[7,'憶']]);
  reconcileTitleRuby(w,w.title,'朝の夕暮れの記憶');w.title='朝の夕暮れの記憶';assert.deepEqual(w.titleBoard!.ruby.map(r=>r.base),['記','憶']);
});
test('long readings cannot collide or escape the card and disabled readings do not print',()=>{
  const w=work('夜明');w.titleBoard={quoted:true,rubyEnabled:true,ruby:[{start:0,end:1,base:'夜',reading:'よ'.repeat(6)},{start:1,end:2,base:'明',reading:'あ'.repeat(6)}]};
  assert.ok(titleBoardIssues(w,measureBoardText).some(i=>i.message.includes('重な')));
  w.titleBoard.ruby[0].reading='あ'.repeat(40);assert.ok(titleBoardIssues(w,measureBoardText).some(i=>i.message.includes('印刷枠')));
  w.titleBoard.rubyEnabled=false;assert.deepEqual(layoutBoardTitle(w,measureBoardText).ruby,[]);assert.deepEqual(titleBoardIssues(w,measureBoardText),[]);
});
async function fixture(run:(e:any)=>Promise<void>) {
  const previous=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-ruby-'));process.env.DATA_DIR=dir;
  try{writeData('users.json',['staff','author'].map(id=>({id,name:id,email:`${id}@example.invalid`,role:id==='staff'?'staff':'member',approved:true,createdAt:'2026-01-01',providers:{}})));
    const e=(await exhibitionAction('staff',{action:'create',title:'ふりがな検証'})).exhibition;
    await updateExhibitionStore(data=>{const x=data.exhibitions[0],iso=(n:number)=>new Date(Date.now()+n).toISOString();x.status='open';x.opensAt=iso(-60000);x.closesAt=iso(3600000);x.participation={state:'published',opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['author'],votes:{author:{value:'attending',at:iso(0),actorId:'author'}}};});await run(e);
  }finally{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
function content(e:any):SubmissionContent {const w=work();w.sectionId=e.schemas[0].sections[0].id;return{...emptySubmission(),name:'作者',authorName:'作者',grade:'2年',portfolioUrl:'https://scharade.jp/Portfolio/preview',sections:[{sectionId:w.sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[w]};}
test('draft/save/reopen/submit and staff history preserve quote and reading settings without changing old versions',async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];w.titleBoard=settings();w.titleBoard.quoted=false;
  let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;s=(await publicAction(e.id,'',{action:'save',revision:s.revision,content:c},'author')).submission;
  s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;assert.deepEqual(s.draft.works[0].titleBoard,w.titleBoard);
  s=(await publicAction(e.id,'',{action:'submit',revision:s.revision,content:s.draft},'author')).submission;const previous=structuredClone(readExhibitions().submissions[0].versions[0]);
  const next=structuredClone(s.draft);next.works[0].titleBoard!.quoted=true;
  assert.ok(submissionEditChanges(s.draft,next,e.schemas[0],()=>"").some(c=>c.label.includes('鉤括弧')));
  await exhibitionAction('staff',{action:'submission.edit',exhibitionId:e.id,revision:readExhibitions().exhibitions[0].revision,submissionId:s.id,submissionRevision:s.revision,content:next});
  assert.deepEqual(readExhibitions().submissions[0].versions[0],previous);assert.equal(readExhibitions().submissions[0].versions.at(-1)!.content.works[0].titleBoard!.quoted,true);
}));
test('normalization rebases trimmed titles and dirty fingerprints agree with parsed drafts',async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];w.title=' '+w.title+' ';w.titleBoard={...settings(),ruby:settings().ruby.map(r=>({...r,start:r.start+1,end:r.end+1}))};
  const parsed=parseContent(c,e.schemas[0],[],false);assert.equal(parsed.works[0].title,'夜明けの記憶');assert.deepEqual(parsed.works[0].titleBoard,settings());assert.equal(draftFingerprint(c),draftFingerprint(parsed));
  const legacy=content(e),explicit=structuredClone(legacy);explicit.works[0].titleBoard={quoted:true,rubyEnabled:false,ruby:[]};assert.equal(draftFingerprint(legacy),draftFingerprint(explicit));
  w.titleBoard.ruby[0].reading='あ'.repeat(41);assert.throws(()=>parseContent(c,e.schemas[0],[],false),/40文字/);
}));
test('invalid targets and missing group readings may remain in drafts, but cannot be submitted',async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];w.title='永遠';w.titleBoard={quoted:true,rubyEnabled:true,ruby:[{start:0,end:2,base:'永遠',reading:'',group:true}]};
  assert.ok(parseContent(c,e.schemas[0],[],false));assert.throws(()=>parseContent(c,e.schemas[0],[],true),/ふりがなを入力/);
  w.titleBoard.ruby[0].base='昨日';assert.ok(parseContent(c,e.schemas[0],[],false));assert.throws(()=>parseContent(c,e.schemas[0],[],true),/対象箇所/);
}));
test('Google row import round-trips settings and preserves them when a legacy sheet has no setting column',async()=>fixture(async e=>{
  const board={quoted:false,rubyEnabled:true,ruby:[{start:0,end:2,base:'永遠',reading:'ずっと',group:true}]};
  const rows=[['提出ID','作品ID','名前','学年','作品タイトル','作品種別','タイトルボード表示設定'],['s','w','作者','2年','永遠','ブック',JSON.stringify(board)]];
  assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_123','回答',rows)).imported,1);assert.deepEqual(readExhibitions().submissions[0].draft.works[0].titleBoard,board);
  assert.equal((await importTitleBoardRows(e.id,'sheet_fixture_123','回答',rows)).unchanged,1);
  await importTitleBoardRows(e.id,'sheet_fixture_123','回答',rows.map(r=>r.slice(0,-1)));assert.deepEqual(readExhibitions().submissions[0].draft.works[0].titleBoard,board);
}));
test('legacy preview stays byte-identical to explicit defaults and new readings pass the real font preflight',async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;s=(await publicAction(e.id,'',{action:'submit',revision:s.revision,content:c},'author')).submission;const submission=readExhibitions().submissions[0];submission.qrConfirmed=true;
  const base={submission,work:w,qrUrl:c.portfolioUrl};const legacy=await titleBoardPreview(base,'https://scharade.jp');
  const explicit=await titleBoardPreview({...base,work:{...w,titleBoard:{quoted:true,rubyEnabled:false,ruby:[]}}},'https://scharade.jp');assert.deepEqual(legacy.png,explicit.png);
  w.titleBoard=settings();assert.deepEqual(validateBoardText(c),[]);const ruby=await titleBoardPreview(base,'https://scharade.jp');assert.notDeepEqual(ruby.png,legacy.png);assert.deepEqual(ruby.issues,[]);
}));
test('existing Google form is updated in place and delivery archives the exact per-work settings',async()=>fixture(async e=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.EXHIBITION_GAS_URL,oldSecret=process.env.EXHIBITION_WEBHOOK_SECRET,requests:any[]=[];
  process.env.EXHIBITION_GAS_URL='https://script.google.com/macros/s/fixture/exec';process.env.EXHIBITION_WEBHOOK_SECRET='d'.repeat(64);
  try {
    await updateExhibitionStore(data=>{data.exhibitions[0].googleForms=[{schemaVersion:1,formId:'form_fixture_123',spreadsheetId:'sheet_fixture_123',connectionId:'legacy',itemIds:{name:1,title:2}}];});
    globalThis.fetch=async(_url,init)=>{const request=JSON.parse(JSON.parse(String(init?.body)).payload);requests.push(request);
      if(request.action==='health')return Response.json({ok:true});
      if(request.action==='form.create')return Response.json({ok:true,formId:'form_fixture_123',spreadsheetId:'sheet_fixture_123',itemIds:Object.fromEntries(request.fields.map((field:any,index:number)=>[field.id,index+1]))});
      if(request.action==='response.submit')return Response.json({ok:true,delivered:request.rows.map((row:any)=>row.idempotencyKey)});
      throw new Error('Unexpected fixture request');};
    const form=await createExhibitionGoogleForm(e.id);assert.equal(form.formId,'form_fixture_123');assert.equal(form.spreadsheetId,'sheet_fixture_123');
    const field=requests.find(r=>r.action==='form.create').fields.find((f:any)=>f.id==='titleBoard');assert.equal(field.required,false);assert.equal(field.paragraph,true);
    const c=content(e);c.works[0].titleBoard={...settings(),quoted:false};let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;s=(await publicAction(e.id,'',{action:'submit',revision:s.revision,content:c},'author')).submission;
    assert.equal(await deliverExhibitionVersion(e.id,s.id,1),true);const row=requests.find(r=>r.action==='response.submit').rows[0];assert.deepEqual(JSON.parse(row.answers.titleBoard),c.works[0].titleBoard);assert.equal(row.answers.title,c.works[0].title);assert.equal(row.fieldLabels.titleBoard,'タイトルボード表示設定');
  } finally {globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.EXHIBITION_GAS_URL;else process.env.EXHIBITION_GAS_URL=oldUrl;if(oldSecret===undefined)delete process.env.EXHIBITION_WEBHOOK_SECRET;else process.env.EXHIBITION_WEBHOOK_SECRET=oldSecret;}
}));
