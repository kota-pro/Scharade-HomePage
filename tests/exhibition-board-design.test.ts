import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {boardDesignScene,boardDesignSvg,parseBoardDesign} from '../src/lib/exhibitionBoardDesign.ts';
import {measureBoardText} from '../src/lib/exhibitionTextMetrics.ts';
import {contentTextIssues} from '../src/lib/exhibitionText.ts';
import {exhibitionAction,publicAction,readExhibitions,updateExhibitionStore} from '../src/lib/exhibitions.ts';
import {parseContent} from '../src/lib/exhibitionValidation.ts';
import {emptySubmission,latestContent,type Work} from '../src/lib/exhibitionTypes.ts';
import {writeData} from '../src/lib/store.ts';
import {generateTitleBoards,selectedBoardWorks,titleBoardWorks} from '../src/lib/exhibitionOutputs.ts';
import {titleBoardPreview,previewOwnTitleBoard} from '../src/lib/exhibitionTitleBoardPreview.ts';
import {GET,POST} from '../src/pages/api/member/exhibitions/[id]/boards.ts';
import {POST as output} from '../src/pages/api/member/exhibitions/[id]/output.ts';
async function fixture(run:(e:any,c:any,s:any,users:any[])=>Promise<void>) {
 const old=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-board-design-'));process.env.DATA_DIR=dir;
 try{
  const users=['staff','member'].map(id=>({id,name:id,email:`${id}@example.invalid`,approved:true,role:id==='staff'?'staff':'member',createdAt:'2026-01-01',providers:{}}));writeData('users.json',users);
  const e=(await exhibitionAction('staff',{action:'create',title:'タイトルボード配置の検証'})).exhibition;
  await updateExhibitionStore(data=>{const e=data.exhibitions[0];e.status='open';e.opensAt='2020-01-01';e.closesAt='2030-01-01';e.participation={state:'published',opensAt:'2020-01-01',closesAt:'2030-01-01',recipientIds:['member'],votes:{member:{value:'attending',at:'2026-01-01',actorId:'member'}}};});
  const sectionId=e.schemas[0].sections[0].id,c={...emptySubmission(),name:'テスト会員',authorName:'作者',grade:'2年',portfolioUrl:'https://scharade.jp/Portfolio/test',sections:[{sectionId,singles:0,series:0,books:2,seriesPhotoCounts:[],fields:{}}],works:[1,2].map(i=>({id:crypto.randomUUID(),sectionId,kind:'book',title:'同じ題名',caption:i===1?'長い文章。'.repeat(90):'光の記録。',location:'',equipment:'',settings:'',photos:[],fields:{}}))};
  const begun=await publicAction(e.id,'',{action:'begin'},'member'),s=(await publicAction(e.id,'',{action:'submit',revision:begun.submission.revision,content:c},'member')).submission;
  await run(e,c,readExhibitions().submissions.find(row=>row.id===s.id)!,users);
 }finally{if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
}
test('physical overflow is submitted unchanged while structural validation and layout warnings remain',()=>fixture(async(e,c,s)=>{
 assert.equal(latestContent(s)!.works[0].caption,c.works[0].caption);assert.ok(contentTextIssues(c,measureBoardText).some(i=>i.layout));
 assert.ok(boardDesignScene(c,c.works[0],measureBoardText).issues.some(i=>i.element==='caption'));
 const invalid=structuredClone(c);invalid.works[0].title='改行\n禁止';assert.throws(()=>parseContent(invalid,e.schemas[0],[],true),/改行/);
 invalid.works[0].title='長'.repeat(301);assert.throws(()=>parseContent(invalid,e.schemas[0],[],true),/文字数/);
 invalid.works[0]={...invalid.works[0],title:'必須写真',kind:'single'};invalid.sections[0].singles=1;invalid.sections[0].books=1;assert.throws(()=>parseContent(invalid,e.schemas[0],[],true),/写真/);
}));
test('safe per-element positions, font sizes and wrapping are shared by SVG, saved previews and PDF',()=>fixture(async(e,c,s)=>{
 const work=c.works[0];work.caption='長い文章。'.repeat(30);work.title='永遠';work.titleBoard={quoted:true,rubyEnabled:true,ruby:[{start:0,end:2,base:'永遠',reading:'ずっと',group:true}]};
 const scene=boardDesignScene(c,work,measureBoardText,{caption:{x:8,y:31,width:65,height:36,fontSize:8,lineHeight:3.5}});assert.deepEqual(scene.issues,[]);assert.ok(scene.runs.some(r=>r.text==='ずっと'));assert.equal(scene.frames.caption.width,65);assert.match(boardDesignSvg(scene,''),/data-board-element="caption"/);
 assert.ok(boardDesignScene(c,{...work,title:'光',titleBoard:undefined},measureBoardText,{title:{...scene.frames.title,width:1}}).issues.some(i=>i.element==='title'&&i.message.includes('幅')));
 const shortLastLine={...work,caption:'あ'.repeat(156)};const fitted=boardDesignScene(c,shortLastLine,measureBoardText,{caption:{x:8,y:32.3,width:89,height:20,fontSize:8,lineHeight:3.384}});assert.deepEqual(fitted.issues,[],'The short final line may sit beside the QR without a false rectangular overlap.');
 const draft=structuredClone(readExhibitions());draft.submissions[0].versions.at(-1)!.content.works[0]=work;draft.exhibitions[0].boardDesigns={[work.id]:{caption:scene.frames.caption}};
 const board=titleBoardWorks(draft,draft.exhibitions[0],'https://scharade.jp').find(b=>b.work.id===work.id)!;assert.deepEqual((await titleBoardPreview(board,'https://scharade.jp')).issues,[]);
 const result=await generateTitleBoards(draft,draft.exhibitions[0],'https://scharade.jp',[work.id]);assert.ok(result.pdf);assert.deepEqual(result.issues,[]);assert.equal((await PDFDocument.load(result.pdf!)).getPageCount(),1);
 if(process.env.BOARD_DESIGN_FIXTURE_PDF)fs.writeFileSync(process.env.BOARD_DESIGN_FIXTURE_PDF,result.pdf!);
}));
test('only works marked photography NG reserve icon space and print the supplied mark',()=>fixture(async(e,c)=>{
 const submission=c.works.map((work:Work)=>({...work,caption:'キャプション'}));
 const [allowed,prohibited]=submission;
 prohibited.titleBoard={quoted:true,rubyEnabled:false,ruby:[],noPhotography:true};
 c.works=submission;
 const parsed=parseContent(c,e.schemas[0],[],true);
 assert.equal(parsed.works[0].titleBoard,undefined);
 assert.equal(parsed.works[1].titleBoard?.noPhotography,true);
 const invalid=structuredClone(c);
 (invalid.works[1].titleBoard as any).noPhotography='false';
 assert.throws(()=>parseContent(invalid,e.schemas[0],[],true),/撮影可否/);

 const normal=boardDesignScene(c,allowed,measureBoardText);
 const marked=boardDesignScene(c,prohibited,measureBoardText);
 assert.deepEqual(marked.issues,[]);
 assert.ok(marked.frames.title.width<normal.frames.title.width);
 assert.doesNotMatch(boardDesignSvg(normal,''),/data-photography-mark/);
 assert.deepEqual(marked.photographyMark,{x:84.2,y:7.8,size:13.7});
 assert.match(boardDesignSvg(marked,''),/data-photography-mark=""/);
 assert.ok(boardDesignScene(c,prohibited,measureBoardText,{
   title:{...marked.frames.title,x:85},
 }).issues.some(issue=>issue.element==='title'&&issue.message.includes('撮影NGアイコン')));

 const data=readExhibitions();
 data.submissions[0].versions.at(-1)!.content=parsed;
 const result=await generateTitleBoards(data,e,'https://scharade.jp');
 assert.ok(result.pdf);
 assert.deepEqual(result.issues,[]);
 assert.equal((await PDFDocument.load(result.pdf)).getPageCount(),1);
 if(process.env.BOARD_PHOTOGRAPHY_FIXTURE_PDF)fs.writeFileSync(process.env.BOARD_PHOTOGRAPHY_FIXTURE_PDF,result.pdf);
}));
test('layout save changes only staff overrides, rejects stale revisions and is inaccessible to members',()=>fixture(async(e,c,s,users)=>{
 const before=JSON.stringify(readExhibitions().submissions),f=boardDesignScene(c,c.works[1],measureBoardText).frames.title,design={title:{...f,x:10,width:85},caption:{...boardDesignScene(c,c.works[1],measureBoardText).frames.caption,fontSize:9}};
 const result=await exhibitionAction('staff',{action:'boards.design',exhibitionId:e.id,revision:e.revision,submissionRevision:s.revision,workId:c.works[1].id,design});assert.deepEqual(result.exhibition.boardDesigns?.[c.works[1].id],design);assert.equal(JSON.stringify(readExhibitions().submissions),before);assert.equal((await previewOwnTitleBoard(e.id,'',{...c,work:c.works[1]},'member','https://scharade.jp')).fontSize,9);
 await assert.rejects(exhibitionAction('staff',{action:'boards.design',exhibitionId:e.id,revision:e.revision,submissionRevision:s.revision,workId:c.works[1].id,design}),(err:any)=>err.status===409);
 await assert.rejects(exhibitionAction('staff',{action:'boards.design',exhibitionId:e.id,revision:result.exhibition.revision,submissionRevision:s.revision-1,workId:c.works[1].id,design}),(err:any)=>err.status===409);
 await assert.rejects(exhibitionAction('member',{action:'boards.design',exhibitionId:e.id,revision:result.exhibition.revision,submissionRevision:s.revision,workId:c.works[1].id,design}),(err:any)=>err.status===403);
 for(const user of [undefined,users[1]]){const response=await GET({locals:{user},params:{id:e.id},request:new Request('https://scharade.jp'),url:new URL('https://scharade.jp')} as any);assert.equal(response.status,user?403:401);}
}));
test('read-only editor preview validates geometry, escapes submitted text and never writes a saved version',()=>fixture(async(e,c,s,users)=>{
 const before=JSON.stringify(readExhibitions()),request=new Request(`https://scharade.jp/api/member/exhibitions/${e.id}/boards`,{method:'POST',headers:{Origin:'https://scharade.jp','Content-Type':'application/json'},body:JSON.stringify({action:'preview',workId:c.works[1].id,design:{}})});
 const response=await POST({locals:{user:users[0]},params:{id:e.id},request,url:new URL(request.url)} as any);assert.equal(response.status,200);assert.equal(JSON.stringify(readExhibitions()),before);const result=await response.json();assert.ok(result.svg.includes('同じ題名'));assert.equal(result.revision,e.revision);
 for(const bad of [{title:{...result.scene.frames.title,x:NaN}},{unknown:{}},{qr:{...result.scene.frames.qr,width:22}},{title:{...result.scene.frames.title,fontSize:0}}])assert.throws(()=>parseBoardDesign(bad));
 const scene=boardDesignScene(c,{...c.works[1],title:'<script>alert(1)</script>'},measureBoardText);const svg=boardDesignSvg(scene,'');assert.ok(!svg.includes('<script>'));assert.match(svg,/&lt;/);
}));
test('print exclusions use work IDs even for duplicate titles; overflow in an excluded work does not block the job',()=>fixture(async(e,c,s)=>{
 const data=readExhibitions(),works=titleBoardWorks(data,e,'https://scharade.jp');assert.equal(works[0].work.title,works[1].work.title);assert.equal((await generateTitleBoards(data,e,'https://scharade.jp')).pdf,null);
 const good=c.works[1].id,result=await generateTitleBoards(data,e,'https://scharade.jp',[good]);assert.ok(result.pdf);assert.deepEqual(result.works.map(b=>b.work.id),[good]);assert.equal((await PDFDocument.load(result.pdf!)).getPageCount(),1);
 for(const ids of [[],[good,good],['foreign'],null])assert.throws(()=>selectedBoardWorks(works,ids));
 const nine=Array.from({length:9},(_,i)=>({...c.works[1],id:crypto.randomUUID(),title:`作品${i+1}`}));data.submissions[0].versions.at(-1)!.content.works=nine;
 const all=await generateTitleBoards(data,e,'https://scharade.jp'),eight=await generateTitleBoards(data,e,'https://scharade.jp',nine.slice(1).map(w=>w.id));assert.equal((await PDFDocument.load(all.pdf!)).getPageCount(),2);assert.equal((await PDFDocument.load(eight.pdf!)).getPageCount(),1);
}));
test('PDF API requires an explicit selection and matching settings and submission revisions',()=>fixture(async(e,c,s,users)=>{
 const call=async(body:any)=>{const request=new Request(`https://scharade.jp/api/member/exhibitions/${e.id}/output?kind=boards`,{method:'POST',headers:{Origin:'https://scharade.jp','Content-Type':'application/json'},body:JSON.stringify(body)});return output({locals:{user:users[0]},params:{id:e.id},request,url:new URL(request.url)} as any);};
 assert.equal((await call(null)).status,400);assert.equal((await call({revision:e.revision})).status,400);assert.equal((await call({revision:0,workIds:[c.works[1].id]})).status,409);assert.equal((await call({revision:e.revision,workIds:[c.works[1].id],submissionRevisions:{}})).status,409);
}));
