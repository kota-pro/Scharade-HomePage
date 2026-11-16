import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import jsQR from "jsqr";
import { PDFDocument } from "pdf-lib";
import { emptyWorkDetails, layoutBoardMetadata, metadataStrings, metadataTypography, normalizeMetadataInput, wrapBoardMetadata } from "../src/lib/exhibitionText.ts";
import { measureBoardText, validateBoardText } from "../src/lib/exhibitionTextMetrics.ts";
import { metadataInputText, parseContent } from "../src/lib/exhibitionValidation.ts";
import { emptySubmission, type SubmissionContent } from "../src/lib/exhibitionTypes.ts";
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore } from "../src/lib/exhibitions.ts";
import { generateTitleBoards } from "../src/lib/exhibitionOutputs.ts";
import { titleBoardPreview } from "../src/lib/exhibitionTitleBoardPreview.ts";
import { importTitleBoardRows } from "../src/lib/exhibitionSheetImport.ts";
import { createExhibitionGoogleForm, deliverExhibitionVersion } from "../src/lib/exhibitionIntegrations.ts";
import { submissionEditChanges } from "../src/lib/exhibitionSubmissionEdits.ts";
import { draftFingerprint } from "../src/scripts/exhibitionDraftSync.ts";
import { writeData } from "../src/lib/store.ts";

const empty = () => ({ location:"",equipment:"",settings:"" });
const gear=["ニコンフルサイズミラーレス一眼カメラ","標準ズームレンズ二十四から七十ミリ用","コダックポートラ四百カラーネガを使用"];
test("metadata shares exactly three rows with 8pt text, preserves ordinary row positions and enforces the physical right edge",()=>{
  for(const [work,expected] of [
    [{...empty()},0],
    [{location:"新宿 / 東京都",equipment:"Z6 / 50mm",settings:"1/250秒, ISO400, F2.8"},3],
    [{...empty(),equipment:gear.slice(0,2).join(""),settings:"1/250秒"},3],
    [{...empty(),equipment:gear.join("")},3],
  ] as const) {
    const layout=layoutBoardMetadata(work,measureBoardText);
    assert.equal(layout.lineCount,expected);assert.equal(layout.fits,true);
    assert.ok(layout.rows.every(r=>measureBoardText(r.text,8)<=51.001));
    assert.ok(layout.rows.every(r=>metadataTypography.valueX+measureBoardText(r.text,8)<79));
    assert.deepEqual(layout.rows.map(r=>r.topMm),Array.from({length:expected},(_,i)=>50+i*6.17));
    assert.ok(layout.rows.every(r=>r.topMm+8*25.4/72<67.25));
  }
  assert.deepEqual(layoutBoardMetadata({...empty(),equipment:gear.join("")},measureBoardText).rows.map(r=>r.label),["使用機材","",""]);
  assert.equal(layoutBoardMetadata({...empty(),equipment:"あ".repeat(55)},measureBoardText).fits,false);
  assert.equal(layoutBoardMetadata({...empty(),equipment:gear.slice(0,2).join(""),location:"新宿",settings:"ISO400"},measureBoardText).lineCount,4);
});
test("metadata word wrapping and explicit blank lines respect width without orphan separators",()=>{
  for(const value of ["Nikon Z 6II / NIKKOR Z 24-70mm f/4 S","Canon EOS R6 Mark II / RF24-105mm F4 L IS USM","i".repeat(200)]) {
    const lines=wrapBoardMetadata(value,measureBoardText);assert.ok(lines.every(line=>measureBoardText(line,8)<=51.001));
    assert.ok(lines.every(line=>!/^\s*[\/,](?:\s|$)/.test(line)));
    assert.equal(lines.join("").replace(/\s/g,""),value.replace(/\s/g,""));
  }
  assert.deepEqual(wrapBoardMetadata("一行目\r\n\r\n三行目",measureBoardText),["一行目","","三行目"]);
  const boundary=wrapBoardMetadata(gear[0]+" /\n"+gear[1],measureBoardText);
  assert.ok(boundary.every(line=>!/^\s*[\/,]\s*$/.test(line)));
  assert.equal(boundary.join("").replace(/\s/g,""),(gear[0]+"/"+gear[1]));
});
test("boundary Enter survives component joining, ISO/F normalization and draft comparison",()=>{
  const details={...emptyWorkDetails(),camera:" Camera\r\n",lens:" Lens ",film:"Film",shutterSpeed:"1/250秒\n",iso:" ISO 400",fNumber:" f/2.8"};
  assert.equal(metadataInputText(details.camera),"Camera\n");
  assert.deepEqual(metadataStrings(details),{location:"",equipment:"Camera /\nLens / Film",settings:"1/250秒,\nISO400, F2.8"});
  assert.equal(metadataStrings({...details,camera:"Camera",lens:"\nLens"}).equipment,"Camera /\nLens / Film");
  assert.equal(normalizeMetadataInput(" \r\n "),"");
  assert.equal(metadataStrings({...emptyWorkDetails(),place:"新宿\n",prefecture:"東京都"}).location,"新宿 /\n東京都");
  assert.notEqual(draftFingerprint({details:{...emptyWorkDetails(),camera:"Camera"}}),draftFingerprint({details:{...emptyWorkDetails(),camera:"Camera\n"}}));
  for(const value of [null,{},"bad\0",10])assert.throws(()=>metadataInputText(value));
});
async function fixture(run:(e:any)=>Promise<void>) {
  const previous=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),"exhibition-metadata-"));process.env.DATA_DIR=dir;
  try {
    writeData("users.json",["staff","author"].map(id=>({id,name:id,email:`${id}@example.invalid`,role:id==="staff"?"staff":"member",approved:true,createdAt:"2026-01-01",providers:{}})));
    const e=(await exhibitionAction("staff",{action:"create",title:"改行の検証"})).exhibition;
    await updateExhibitionStore(data=>{const x=data.exhibitions[0],iso=(n:number)=>new Date(Date.now()+n).toISOString();x.status="open";x.opensAt=iso(-60000);x.closesAt=iso(3600000);x.participation={state:"published",opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:["author"],votes:{author:{value:"attending",at:iso(0),actorId:"author"}}};});
    await run(e);
  }finally{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(dir,{recursive:true,force:true});}
}
function content(e:any):SubmissionContent {
  const sectionId=e.schemas[0].sections[0].id;
  return {...emptySubmission(),name:"作者",authorName:"作者",grade:"2年",portfolioUrl:"https://scharade.jp/Portfolio/preview",sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[{id:crypto.randomUUID(),sectionId,kind:"book",title:"光",caption:"",...empty(),details:emptyWorkDetails(),photos:[],fields:{}}]};
}
test("submissions preserve metadata beyond the default print area for staff layout correction",async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];w.details!.camera=gear.join("");Object.assign(w,metadataStrings(w.details!));
  assert.deepEqual(validateBoardText(c),[]);assert.equal(parseContent(c,e.schemas[0],[],true).works[0].equipment,gear.join(""));
  w.details!.iso="400";Object.assign(w,metadataStrings(w.details!));
  assert.equal(parseContent(c,e.schemas[0],[],false).works[0].settings,"ISO400");
  assert.equal(parseContent(c,e.schemas[0],[],true).works[0].settings,"ISO400");assert.ok(validateBoardText(c).some(i=>i.layout));
  w.details!.camera="あ".repeat(101);assert.equal(parseContent(c,e.schemas[0],[],true).works[0].details!.camera.length,101);
  w.details!.camera="Camera\tLens";assert.throws(()=>parseContent(c,e.schemas[0],[],true),/タブ/);
  delete w.details;w.equipment=gear.slice(0,2).join("\n");w.location="";w.settings="ISO400";
  assert.deepEqual(validateBoardText(c),[]);assert.equal(parseContent(c,e.schemas[0],[],true).works[0].equipment,w.equipment);
}));
test("save/reopen/submit and staff corrections preserve manual breaks and immutable versions, including a boundary-only edit",async()=>fixture(async e=>{
  const c=content(e),w=c.works[0];w.details!.camera="Camera\n";w.details!.lens="Lens";
  let s=(await publicAction(e.id,"",{action:"begin"},"author")).submission;
  s=(await publicAction(e.id,"",{action:"save",revision:s.revision,content:c},"author")).submission;
  assert.equal(s.draft.works[0].details!.camera,"Camera\n");assert.equal(s.draft.works[0].equipment,"Camera /\nLens");
  s=(await publicAction(e.id,"",{action:"begin"},"author")).submission;assert.equal(s.draft.works[0].details!.camera,"Camera\n");
  s=(await publicAction(e.id,"",{action:"submit",revision:s.revision,content:s.draft},"author")).submission;
  const before=structuredClone(readExhibitions().submissions[0].versions[0]);
  const changed=structuredClone(s.draft);changed.works[0].details!.camera="Camera";changed.works[0].details!.lens="";Object.assign(changed.works[0],metadataStrings(changed.works[0].details!));
  const boundary=structuredClone(changed);boundary.works[0].details!.camera+="\n";
  assert.equal(submissionEditChanges(changed,boundary,e.schemas[0],()=>"").length,1);
  await exhibitionAction("staff",{action:"submission.edit",exhibitionId:e.id,revision:readExhibitions().exhibitions[0].revision,submissionId:s.id,submissionRevision:s.revision,content:changed});
  const current=readExhibitions();assert.deepEqual(current.submissions[0].versions[0],before);assert.equal(current.submissions[0].versions.at(-1)!.content.works[0].equipment,"Camera");
}));
test("sheet import keeps split-field boundary newlines and is idempotent",async()=>fixture(async e=>{
  const rows=[["提出ID","作品ID","名前","学年","作品タイトル","作品種別","カメラ","レンズ"],["s1","w1","作者","2年","光","ブック","Camera\n","Lens"]];
  assert.equal((await importTitleBoardRows(e.id,"sheet_fixture_123","提出結果",rows)).imported,1);
  assert.equal(readExhibitions().submissions[0].draft.works[0].details!.camera,"Camera\n");assert.equal(readExhibitions().submissions[0].draft.works[0].equipment,"Camera /\nLens");
  assert.equal((await importTitleBoardRows(e.id,"sheet_fixture_123","提出結果",rows)).unchanged,1);
}));
test("preview and PDF accept the three-row limit, keep QR readable, and block overflowing print jobs",async()=>fixture(async e=>{
  const c=content(e);c.works[0].details!.camera=gear.join("");Object.assign(c.works[0],metadataStrings(c.works[0].details!));
  let s=(await publicAction(e.id,"",{action:"begin"},"author")).submission;
  s=(await publicAction(e.id,"",{action:"submit",revision:s.revision,content:c},"author")).submission;
  await updateExhibitionStore(data=>{data.submissions[0].qrConfirmed=true;});
  const data=readExhibitions(),submission=data.submissions[0],work=submission.versions[0].content.works[0];
  const preview=await titleBoardPreview({submission,work,qrUrl:c.portfolioUrl},"https://scharade.jp");assert.deepEqual(preview.issues,[]);
  const qr=await sharp(preview.png).extract({left:79*8,top:394,width:144,height:144}).ensureAlpha().raw().toBuffer();
  assert.equal(jsQR(new Uint8ClampedArray(qr),144,144)?.data,c.portfolioUrl);
  const pdf=await generateTitleBoards(data,data.exhibitions[0],"https://scharade.jp");assert.deepEqual(pdf.issues,[]);assert.ok(pdf.pdf);
  const doc=await PDFDocument.load(pdf.pdf!);assert.equal(doc.getPageCount(),1);assert.ok(Math.abs(doc.getPage(0).getWidth()-210*72/25.4)<.01);
  work.settings="ISO400";assert.equal((await generateTitleBoards(data,data.exhibitions[0],"https://scharade.jp")).pdf,null);
}));
test("Google reuses existing files, marks metadata questions as paragraphs and delivers linebreaks unchanged",async()=>fixture(async e=>{
  const prior={url:process.env.EXHIBITION_GAS_URL,secret:process.env.EXHIBITION_WEBHOOK_SECRET,fetch:globalThis.fetch};
  process.env.EXHIBITION_GAS_URL="https://script.google.com/macros/s/metadatafixture/exec";process.env.EXHIBITION_WEBHOOK_SECRET="m".repeat(64);
  const requests:any[]=[];
  globalThis.fetch=async(_url,init)=>{const p=JSON.parse(JSON.parse(String(init?.body)).payload);requests.push(p);if(p.action==="health")return Response.json({ok:true});if(p.action==="form.create")return Response.json({ok:true,formId:"existing_metadata_form",spreadsheetId:"existing_metadata_sheet",itemIds:Object.fromEntries(p.fields.map((f:any,i:number)=>[f.id,i+1]))});if(p.action==="response.submit")return Response.json({ok:true,delivered:p.rows.map((r:any)=>r.idempotencyKey)});throw Error(p.action);};
  try {
    await updateExhibitionStore(data=>{data.exhibitions[0].googleForms=[{connectionId:"legacy",schemaVersion:1,formId:"existing_metadata_form",spreadsheetId:"existing_metadata_sheet",itemIds:{}}];});
    await createExhibitionGoogleForm(e.id);const form=requests.find(r=>r.action==="form.create");assert.equal(form.formId,"existing_metadata_form");
    for(const id of ["location","equipment","settings","camera","lens","film","place","region","shutterSpeed","iso","fNumber"])assert.equal(form.fields.find((f:any)=>f.id===id).paragraph,true);
    assert.equal(form.fields.find((f:any)=>f.id==="prefecture").paragraph,false);
    const c=content(e);c.works[0].details!.camera="Camera\n";c.works[0].details!.lens="Lens";
    let s=(await publicAction(e.id,"",{action:"begin"},"author")).submission;s=(await publicAction(e.id,"",{action:"submit",revision:s.revision,content:c},"author")).submission;
    assert.equal(await deliverExhibitionVersion(e.id,s.id,1),true);
    const answers=requests.find(r=>r.action==="response.submit").rows[0].answers;assert.equal(answers.camera,"Camera\n");assert.equal(answers.equipment,"Camera /\nLens");
  }finally{globalThis.fetch=prior.fetch;for(const [key,value] of Object.entries({EXHIBITION_GAS_URL:prior.url,EXHIBITION_WEBHOOK_SECRET:prior.secret})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}));
