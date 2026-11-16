import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { effectiveSubmissionLimits, submissionLimitIssues } from '../src/lib/exhibitionSubmissionLimits.ts';
import { ExhibitionError, parseSchema } from '../src/lib/exhibitionValidation.ts';
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore, uploadExhibitionAsset } from '../src/lib/exhibitions.ts';
import { writeData } from '../src/lib/store.ts';
import type { FormSchema, SubmissionContent, PhotoLayout, SectionLimits } from '../src/lib/exhibitionTypes.ts';
const sectionId=crypto.randomUUID(), otherId=crypto.randomUUID();
const schema=(limits?:SectionLimits):FormSchema=>({version:1,captionLabel:'キャプション',fields:[],sections:[{id:sectionId,title:'通常展示',description:'',...(limits?{limits}:{})}]});
const photo=(width=210,height=297,x=0,y=0,rotation=0):PhotoLayout=>({assetId:'',width,height,x,y,rotation});
const content=(photos=[photo()],kind:'single'|'series'|'book'='single'):SubmissionContent=>({name:'作者',authorName:'作者',grade:'1年',portfolioUrl:'',fields:{},sections:[{sectionId,singles:kind==='single'?1:0,series:kind==='series'?1:0,books:kind==='book'?1:0,seriesPhotoCounts:kind==='series'?[photos.length]:[],fields:{}}],works:[{id:crypto.randomUUID(),sectionId,kind,title:'光',caption:'',location:'',equipment:'',settings:'',fields:{},photos}]});
const issues=(c:SubmissionContent,limits:SectionLimits)=>submissionLimitIssues(c,effectiveSubmissionLimits([schema(limits)]));
test('unset limits preserve old schemas; invalid administrative limits are rejected',()=>{
 assert.equal(parseSchema(schema(),2).limits,undefined);assert.deepEqual(issues(content([photo(10000,10000)]),{}),[]);
 assert.equal(parseSchema({...schema({maxWorks:3,frameSizeIds:['A4','2L'],maxLongEdgeMm:297,maxShortEdgeMm:210}),limits:{maxWorks:5}},2).limits?.maxWorks,5);
 for(const maxWorks of [0,-1,1.5,301,NaN,null,'2'])assert.throws(()=>parseSchema({...schema(),limits:{maxWorks}},2),ExhibitionError);
 for(const limits of [{maxWorks:0},{maxWorks:301},{maxLongEdgeMm:0},{maxShortEdgeMm:-1},{maxLongEdgeMm:Infinity},{maxLongEdgeMm:200,maxShortEdgeMm:201},{frameSizeIds:['bad']},{frameSizeIds:['A4','A4']},{frameSizeIds:'A4'}])assert.throws(()=>parseSchema(schema(limits as any),2),ExhibitionError);
 assert.deepEqual(parseSchema(schema({frameSizeIds:[]}),2).sections[0].limits,{});
});
test('a series counts as one work and books are excluded from section and combined limits',()=>{
 const c=content(Array.from({length:100},()=>photo(1,1)),'series');
 c.sections[0].books=100;c.sections.push({sectionId:otherId,singles:2,series:0,books:100,seriesPhotoCounts:[],fields:{}});
 const s=schema({maxWorks:1});s.limits={maxWorks:3};s.sections.push({id:otherId,title:'企画展',description:'',limits:{maxWorks:2}});
 assert.deepEqual(submissionLimitIssues(c,effectiveSubmissionLimits([s])),[]);
 c.sections[0].singles=1;
 assert.deepEqual(submissionLimitIssues(c,effectiveSubmissionLimits([s])).map(i=>i.code),['total-count','section-count']);
 c.sections[0].books=0;c.sections[1].books=0;assert.deepEqual(submissionLimitIssues(c,effectiveSubmissionLimits([s])).map(i=>i.code),['total-count','section-count']);
});
test('frame limits accept smaller custom sizes, orientation swaps and OR choices but require numeric caps too',()=>{
 for(const [id,width,height] of [['A1',594,841],['A2',420,594],['B1',728,1030],['B2',515,728],['B3',364,515]] as const){
  const parsed=parseSchema(schema({frameSizeIds:[id]}),2);assert.deepEqual(parsed.sections[0].limits?.frameSizeIds,[id]);
  assert.deepEqual(issues(content([photo(width,height)]),{frameSizeIds:[id]}),[]);
  assert.deepEqual(issues(content([photo(height,width)]),{frameSizeIds:[id]}),[]);
  assert.equal(issues(content([photo(width+.1,height)]),{frameSizeIds:[id]}).length,1);
 }
 for(const p of [photo(),photo(297,210),photo(150,200),photo(210,297,-999,700),photo(210,297,0,0,90)])assert.deepEqual(issues(content([p]),{frameSizeIds:['A4']}),[]);
 assert.equal(issues(content([photo(211,297)]),{frameSizeIds:['A4']})[0].code,'size');
 assert.deepEqual(issues(content([photo(250,350)]),{frameSizeIds:['A5','B4']}),[]);
 assert.equal(issues(content([photo(250,350)]),{frameSizeIds:['B4'],maxLongEdgeMm:300}).length,1);
 assert.equal(issues(content([photo(190,290)]),{maxShortEdgeMm:180}).length,1);
 assert.deepEqual(issues(content([photo(210,297)]),{maxLongEdgeMm:297,maxShortEdgeMm:210}),[]);
 assert.equal(issues(content([photo(210.001,297)]),{maxShortEdgeMm:210}).length,1);
});
test('series bounds include gaps and arbitrary rotation, while books are exempt from dimensions',()=>{
 const c=content([photo(100,100,0),photo(100,100,201)],'series');
 assert.equal(issues(c,{maxLongEdgeMm:300}).length,1);
 c.works[0].photos[1].x=200;assert.deepEqual(issues(c,{maxLongEdgeMm:300}),[]);
 c.works[0].photos=[photo(210,297,0,0,45)];assert.equal(issues(c,{frameSizeIds:['A4']}).length,1);
 c.works[0].photos=c.works[0].photos.map(p=>({...p,x:p.x-300,y:p.y-200}));assert.equal(issues(c,{frameSizeIds:['A4']}).length,1);
 assert.deepEqual(issues(content([photo(999,999)],'book'),{frameSizeIds:['L'],maxLongEdgeMm:1,maxShortEdgeMm:1}),[]);
});
test('latest limits apply to pinned questions; removed sections retain their last limits and clearing is unlimited',()=>{
 const a=schema({maxWorks:1,maxLongEdgeMm:100});a.limits={maxWorks:2};
 const b=schema({maxWorks:3});b.version=2;b.sections.push({id:otherId,title:'企画展',description:'',limits:{maxWorks:1}});
 const c=schema();c.version=3;c.sections=[{id:otherId,title:'企画展改名',description:'',limits:{}}];
 const rules=effectiveSubmissionLimits([a,b,c]);
 assert.equal(rules.maxWorks,undefined);assert.deepEqual(rules.sections[sectionId],{title:'通常展示',maxWorks:3});assert.deepEqual(rules.sections[otherId],{title:'企画展改名'});
});
test('oversized drafts and final submissions are preserved; latest limits remain available as scoped warnings',async()=>{
 const before=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-limits-'));process.env.DATA_DIR=dir;
 try{
  writeData('users.json',[{id:'staff',name:'運営',email:'staff@example.invalid',approved:true,role:'staff',providers:{},createdAt:'2026-01-01'},{id:'author',name:'作者',email:'author@example.invalid',approved:true,role:'member',providers:{},createdAt:'2026-01-01'}]);
  let e=(await exhibitionAction('staff',{action:'create',title:'上限確認'})).exhibition;
  await updateExhibitionStore(data=>{const x=data.exhibitions[0];x.status='open';x.opensAt='2020-01-01T00:00:00Z';x.closesAt='2030-01-01T00:00:00Z';x.participation={state:'published',opensAt:'2019-01-01T00:00:00Z',closesAt:'2019-12-31T00:00:00Z',recipientIds:['author'],votes:{author:{value:'attending',at:new Date().toISOString(),actorId:'author'}}};});
  let p=await publicAction(e.id,'',{action:'begin'},'author');const c=content([photo(300,200)]);const actual=e.schemas[0].sections[0].id;c.sections[0].sectionId=actual;c.works[0].sectionId=actual;
  const assetId=crypto.randomUUID(),bytes=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
  await uploadExhibitionAsset(e.id,'',assetId,new File([new Uint8Array(bytes)],'test.png',{type:'image/png'}),'author');c.works[0].photos[0].assetId=assetId;
  p=await publicAction(e.id,'',{action:'submit',revision:p.submission.revision,content:c},'author');
  assert.equal(p.submission.versions.length,1);const original=structuredClone(readExhibitions().submissions[0].versions);
  e=readExhibitions().exhibitions[0];e=(await exhibitionAction('staff',{action:'schema',exhibitionId:e.id,revision:e.revision,schema:{...e.schemas[0],limits:{maxWorks:1},sections:[{...e.schemas[0].sections[0],limits:{maxWorks:1,maxLongEdgeMm:250}}],fields:[{id:crypto.randomUUID(),label:'新しい必須質問',type:'text',scope:'common',required:true,options:[],description:''}]}})).exhibition;
  c.sections[0].books=3;for(let i=0;i<3;i++)c.works.push({...content([],'book').works[0],sectionId:actual,title:'本'});
  p=await publicAction(e.id,'',{action:'save',revision:p.submission.revision,content:c},'author');assert.equal(p.schema?.version,1);assert.equal(p.effectiveLimits.sections[actual].maxLongEdgeMm,250);
  p=await publicAction(e.id,'',{action:'submit',revision:p.submission.revision,content:c},'author');
  assert.equal(p.submission.versions.length,2);assert.equal(submissionLimitIssues(p.submission.draft,p.effectiveLimits)[0].workId,c.works[0].id);
  assert.deepEqual(readExhibitions().submissions[0].versions[0],original[0]);assert.equal(readExhibitions().assets.length,1);
  c.works[0].photos[0].width=250;p=await publicAction(e.id,'',{action:'submit',revision:p.submission.revision,content:c},'author');assert.equal(p.submission.versions.length,3);assert.equal(p.schema?.version,1);assert.equal(p.submission.draft.works.length,4);
  e=(await exhibitionAction('staff',{action:'schema',exhibitionId:e.id,revision:e.revision,schema:{...e.schemas.at(-1),limits:{},sections:[{...e.schemas[0].sections[0],limits:{}}]}})).exhibition;
  c.works[0].photos[0].width=999;p=await publicAction(e.id,'',{action:'submit',revision:p.submission.revision,content:c},'author');assert.equal(p.submission.versions.length,4);
 }finally{if(before===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=before;fs.rmSync(dir,{recursive:true,force:true});}
});
