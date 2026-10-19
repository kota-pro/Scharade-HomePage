import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { roomTemplateAction, readRoomTemplates } from "../src/lib/exhibitionRoomTemplates.ts";
import { reusableRoom } from "../src/lib/exhibitionRoomReuse.ts";
import { parseRooms } from "../src/lib/exhibitionValidation.ts";
import { exhibitionLayoutSvg, exhibitionLayoutPng, exhibitionLayoutPdf, allWorks } from "../src/lib/exhibitionOutputs.ts";
import { writeData } from "../src/lib/store.ts";
import type { RoomLayout, LayoutWork } from "../src/lib/exhibitionTypes.ts";
const room = (): RoomLayout => ({id:crypto.randomUUID(),name:"第一展示室",vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[{id:crypto.randomUUID(),kind:"door",wall:0,offset:100,width:900,bottom:0,height:2100}],placements:[],tables:[{id:crypto.randomUUID(),name:"机",x:1000,y:1000,width:1000,depth:600,rotation:0}],books:[],annotations:[{id:crypto.randomUUID(),kind:"power",x:3000,y:3000,width:240,height:240,rotation:0,text:"電源1",fontSize:160}],showExhibitorNames:true});
test("named room library is restricted to staff, updates with revision checks, survives exhibition deletion and isolates work assignments",async()=>{
 const old=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),"scharade-room-library-"));process.env.DATA_DIR=dir;
 try {
  writeData("users.json",[{id:"staff",name:"運営",email:"staff@example.invalid",approved:true,role:"staff"},{id:"member",name:"会員",email:"member@example.invalid",approved:true,role:"member"}]);
  const source=room();source.placements.push({workId:crypto.randomUUID(),wall:1,x:400,bottom:1000,rotation:0});source.books.push({workId:crypto.randomUUID(),tableId:source.tables[0].id,x:0,y:0,width:200,depth:300,rotation:0});
  await assert.rejects(roomTemplateAction("member",{action:"save",name:"会場",room:source}),/運営以上/);
  let result=await roomTemplateAction("staff",{action:"save",name:"会場",room:source}),saved=result.templates[0];
  assert.equal(saved.revision,1);assert.deepEqual(saved.room.placements,[]);assert.deepEqual(saved.room.books,[]);
  await assert.rejects(roomTemplateAction("staff",{action:"save",name:"会場",room:source}),/同じ保存名/);
  await assert.rejects(roomTemplateAction("staff",{action:"save",id:saved.id,revision:0,name:"会場",room:source}),/更新/);
  source.vertices[1].x=6500;result=await roomTemplateAction("staff",{action:"save",id:saved.id,revision:saved.revision,name:"改訂会場",room:source});saved=result.templates[0];
  assert.equal(result.templates.length,1);assert.equal(saved.revision,2);assert.equal(saved.room.vertices[1].x,6500);
  const copy=reusableRoom(saved.room),other=reusableRoom(saved.room);
  assert.notEqual(copy.id,other.id);assert.notEqual(copy.tables[0].id,saved.room.tables[0].id);assert.notEqual(copy.openings[0].id,saved.room.openings[0].id);assert.notEqual(copy.annotations![0].id,saved.room.annotations![0].id);
  copy.vertices[0].x=200;assert.equal(readRoomTemplates()[0].room.vertices[0].x,0);
  writeData("exhibitions.json",{version:1,exhibitions:[],submissions:[],assets:[]});assert.equal(readRoomTemplates().length,1);
 } finally {if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
});
test("room annotation validation preserves legacy rooms and rejects invalid input",()=>{
 const r=room();delete r.annotations;delete r.showExhibitorNames;
 assert.deepEqual(parseRooms([r])[0].annotations,[]);assert.equal(parseRooms([r])[0].showExhibitorNames,true);
 const valid=room();assert.equal(parseRooms([valid])[0].annotations![0].text,"電源1");
 assert.throws(()=>parseRooms([{...valid,annotations:[{...valid.annotations![0],x:Infinity}]}]),/注記X/);
 assert.throws(()=>parseRooms([{...valid,annotations:[{...valid.annotations![0],kind:"script"}]}]),/種類/);
 assert.throws(()=>parseRooms([{...valid,annotations:[valid.annotations![0],valid.annotations![0]]}]),/重複/);
 assert.throws(()=>parseRooms([{...valid,showExhibitorNames:"yes"}]),/表示設定/);
});
test("layout exports include doors, power, figures, escaped text and exhibitor names for photos and image-free books",async()=>{
 const r=room(),photo:LayoutWork={id:crypto.randomUUID(),sectionId:crypto.randomUUID(),kind:"single",title:"風景",caption:"",location:"",equipment:"",settings:"",photos:[{assetId:crypto.randomUUID(),x:0,y:0,width:210,height:297,rotation:0}],fields:{},exhibitorName:"展示者A"},book:LayoutWork={...photo,id:crypto.randomUUID(),kind:"book",title:"記録",photos:[],exhibitorName:"展示者B"};
 r.placements=[{workId:photo.id,wall:1,x:200,bottom:1000,rotation:0}];r.books=[{workId:book.id,tableId:r.tables[0].id,x:0,y:0,width:200,depth:300,rotation:0}];
 r.annotations!.push({...r.annotations![0],id:crypto.randomUUID(),kind:"text",x:2000,y:1800,text:'受付 <1> & 案内'}, {...r.annotations![0],id:crypto.randomUUID(),kind:"rect",x:3500,y:2200,text:""},{...r.annotations![0],id:crypto.randomUUID(),kind:"ellipse",x:4000,y:2200,text:""});
 const svg=exhibitionLayoutSvg(r,[photo,book]);assert.match(svg,/電源1/);assert.match(svg,/受付 &lt;1&gt; &amp; 案内/);assert.match(svg,/展示者A/);assert.match(svg,/展示者B/);assert.match(svg,/<ellipse/);assert.match(svg,/A[0-9.]+ [0-9.]+ 0 0/);
 assert.equal((await sharp(exhibitionLayoutPng(r,[photo,book])).metadata()).format,"png");assert.equal((await PDFDocument.load(await exhibitionLayoutPdf([r],[photo,book]))).getPageCount(),5);
 r.showExhibitorNames=false;assert.doesNotMatch(exhibitionLayoutSvg(r,[photo,book]),/展示者[AB]/);
 assert.equal(allWorks({version:1,exhibitions:[],assets:[],submissions:[{exhibitionId:"e",versions:[{content:{authorName:"作者名",works:[photo]}}]}] } as any,"e")[0].exhibitorName,"作者名");
});
