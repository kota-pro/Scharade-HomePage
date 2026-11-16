import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import jsQR from "jsqr";
import { qrBrand } from "../src/lib/qrBrand.ts";
import { exhibitionQrPng } from "../src/lib/exhibitionQr.ts";
import { validateBoardText, measureBoardText } from "../src/lib/exhibitionTextMetrics.ts";
import { emptyWorkDetails, metadataStrings, titleOriginMm, titleBracketInsetMm, fitBoardCaption, captionTypography, boardTextLayout, wrapBoardText } from "../src/lib/exhibitionText.ts";
import { snapPhotoEdges } from "../src/lib/exhibitionEditing.ts";
import { boardChain, boardSurface, boardPlacementProblems, joinBoardGroups, detachBoardGroup } from "../src/lib/exhibitionBoards.ts";
import { reusableRoom } from "../src/lib/exhibitionRoomReuse.ts";
import type { BoardGroup, RoomLayout, Work, SubmissionContent } from "../src/lib/exhibitionTypes.ts";
const uuid=()=>crypto.randomUUID();
const photo=(x=0,y=0,width=100,height=100)=>({assetId:uuid(),x,y,width,height,rotation:0});
const work=():Work=>({id:uuid(),sectionId:uuid(),kind:"series",title:"作品",caption:"",location:"",equipment:"",settings:"",photos:[photo()],fields:{}});
const content=():SubmissionContent=>({name:"作者",authorName:"作者",grade:"1年",portfolioUrl:"",fields:{},sections:[],works:[work()]});
const group=(name="ボード"):BoardGroup=>({id:uuid(),name,x:100,y:100,rotation:0,panels:[{id:uuid(),name:"1",width:900,height:1800,thickness:30,hingeAngle:0},{id:uuid(),name:"2",width:900,height:1800,thickness:30,hingeAngle:90}]});
const room=(g:BoardGroup):RoomLayout=>({id:uuid(),name:"部屋",vertices:[{x:0,y:0},{x:5000,y:0},{x:5000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[],placements:[],tables:[],books:[],boardGroups:[g],boardPlacements:[]});
test("structured metadata preserves slashes in shutter/lens values and omits empty components",()=>{
  const details={...emptyWorkDetails(),place:"新宿",prefecture:"東京都",camera:"Camera",lens:"50mm f/1.8",shutterSpeed:"1/250秒",iso:"ISO 400",fNumber:"f/2.8"};
  assert.deepEqual(metadataStrings(details),{location:"新宿 / 東京都",equipment:"Camera / 50mm f/1.8",settings:"1/250秒, ISO400, F2.8"});
  assert.equal(metadataStrings({...details,prefecture:"海外・その他",region:"フランス"}).location,"新宿 / フランス");
  assert.deepEqual(metadataStrings(emptyWorkDetails()),{location:"",equipment:"",settings:""});
});
test("board text uses actual font widths, fits four caption lines, and positions bracket ink at 8mm",()=>{
  const c=content(); c.works[0].title="あ".repeat(10);c.works[0].caption="あ".repeat(100);
  assert.deepEqual(validateBoardText(c),[]);
  c.works[0].title="あ".repeat(11);assert.ok(validateBoardText(c).some(i=>i.path.endsWith("title")));
  c.works[0].title="i".repeat(30);assert.ok(!validateBoardText(c).some(i=>i.path.endsWith("title")));
  c.works[0].caption="あ".repeat(101);assert.ok(!validateBoardText(c).some(i=>i.path.endsWith("caption")));
  c.works[0].caption="あ".repeat(156);assert.ok(validateBoardText(c).some(i=>i.path.endsWith("caption")));
  c.authorName="あ".repeat(20);assert.ok(validateBoardText(c).some(i=>i.path==="authorName"));
  const font:any=fontkit.create(fs.readFileSync("public/fonts/zen-old-mincho/ZenOldMincho-Bold.ttf"));
  const ink=font.glyphForCodePoint(0x300c).bbox.minX/font.unitsPerEm*21*25.4/72;
  assert.ok(Math.abs(ink-titleBracketInsetMm)<.00001);assert.ok(Math.abs(titleOriginMm+ink-8)<.00001);
  assert.ok(measureBoardText("i".repeat(30),21,true)<measureBoardText("あ".repeat(11),21,true));
});
test("QR brand selection requires the actual hostname and each printed logo QR decodes",async()=>{
  const origin="https://scharade.jp";
  assert.equal(qrBrand("https://instagram.com.evil.invalid/a",origin),null);
  assert.equal(qrBrand("https://other.invalid/Portfolio/a",origin),null);
  assert.equal(qrBrand("https://other.invalid/?url=https://x.com/a",origin),null);
  for(const [url,brand] of [["https://scharade.jp/Portfolio/name","scharade"],["https://www.instagram.com/scharade_photo/","instagram"],["https://x.com/scharade_photo","x"],["https://twitter.com/scharade_photo","x"],["https://example.org/author",null]] as const){
    assert.equal(qrBrand(url,origin),brand);
    const png=await exhibitionQrPng(url,origin);const raw=await sharp(png).resize(213,213).ensureAlpha().raw().toBuffer();
    assert.equal(jsQR(new Uint8ClampedArray(raw),213,213)?.data,url);
  }
});
test("edge snapping aligns rotated bounding edges and preserves a selected group's offsets",()=>{
  const photos=[photo(0,0),photo(160,0),photo(300,40)];
  const result=snapPhotoEdges(photos,[0,1],39,39,6);assert.equal(result.dx,40);assert.equal(result.dy,40);
  assert.equal(result.xGuide,300);assert.equal(result.yGuide,40);
  assert.equal(snapPhotoEdges(photos,[0,1,2],39,39,6).xGuide,undefined);
});
test("folded board chains unfold both faces; a series may span panels but individual photos cannot",()=>{
  const g=group(),r=room(g),w=work();w.photos=[photo(0,0,500,400),photo(1100,0,500,400)];
  assert.equal(boardChain(g)[1].end.x,1000);assert.equal(boardChain(g)[1].end.y,1000);
  assert.equal(boardSurface(g,"B").panels[0].panel.id,g.panels[1].id);
  r.boardPlacements=[{groupId:g.id,workId:w.id,face:"A",x:0,bottom:100,rotation:0}];assert.deepEqual(boardPlacementProblems(r,[w]),[]);
  w.photos[1].x=800;assert.match(boardPlacementProblems(r,[w])[0],/継ぎ目/);
});
test("connecting and detaching boards preserves front/back placement positions and template independence",()=>{
  const a=group("左"),b=group("右");a.panels=a.panels.slice(0,1);b.panels=b.panels.slice(0,1);b.rotation=90;
  const r=room(a);r.boardGroups!.push(b);const w=work();
  r.boardPlacements=[{groupId:a.id,workId:w.id,face:"B",x:20,bottom:100,rotation:0}];
  const joined=joinBoardGroups(r,a.id,b.id);assert.equal(joined.boardGroups!.length,1);assert.equal(joined.boardGroups![0].panels[1].hingeAngle,90);assert.equal(joined.boardPlacements![0].x,920);
  const detached=detachBoardGroup(joined,a.id,1,[w]);assert.equal(detached.boardGroups!.length,2);assert.equal(detached.boardPlacements![0].x,20);
  const copy=reusableRoom(joined);assert.equal(copy.boardPlacements!.length,0);assert.notEqual(copy.boardGroups![0].id,a.id);assert.notEqual(copy.boardGroups![0].panels[0].id,a.panels[0].id);
});

test("dense work labels wrap, never overlap and retain every work in a numbered legend",async()=>{
  const {placeLayoutLabels,wrapLayoutLabel}=await import('../src/lib/exhibitionLabels.ts');
  const items=Array.from({length:12},(_,i)=>({id:String(i),text:'展示者 / とても長い作品タイトル'+i,anchor:{x:40+i,y:40},box:{x:35,y:35,width:40,height:40}}));
  const result=placeLayoutLabels(items,{x:0,y:0,width:180,height:150},12,80,[{x:35,y:35,width:40,height:40}]);
  assert.equal(result.labels.length+result.legend.length,items.length);assert.ok(result.legend.length);assert.ok(wrapLayoutLabel(items[0].text,12,80).length>1);
  result.labels.forEach((a,i)=>result.labels.slice(i+1).forEach(b=>assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y))));
});
test("room export includes folded board geometry, both faces, colors, wrapped work labels and gaps",async()=>{
  const {exhibitionLayoutSvg,exhibitionLayoutPng,exhibitionLayoutPdf}=await import('../src/lib/exhibitionOutputs.ts');
  const {PDFDocument}=await import('pdf-lib');
  const g=group(),r=room(g),a=work(),b=work(),c=work();a.title='海';b.title='光';c.title='風';g.panels[0].color='#2277aa';
  r.boardPlacements=[{groupId:g.id,face:'A',workId:a.id,x:100,bottom:100,rotation:0},{groupId:g.id,face:'A',workId:b.id,x:1100,bottom:100,rotation:0},{groupId:g.id,face:'B',workId:c.id,x:100,bottom:100,rotation:0}];
  const floor=exhibitionLayoutSvg(r,[a,b,c]);assert.match(floor,/data-board-floor-face="A"/);assert.match(floor,/data-board-floor-face="B"/);const svg=exhibitionLayoutSvg(r,[a,b,c],{view:`board:${g.id}:A`})+exhibitionLayoutSvg(r,[a,b,c],{view:`board:${g.id}:B`});assert.match(svg,/data-board-face="A"/);assert.match(svg,/data-board-face="B"/);assert.match(floor,/#2277aa/);assert.match(svg,/900.0 mm/);for(const w of [a,b,c])assert.ok(svg.includes(`data-label-id="work:${w.id}"`));
  const png=await sharp(exhibitionLayoutPng(r,[a,b,c])).metadata();assert.equal(png.width,2244);assert.ok(png.height!>1500);
  const pdf=await PDFDocument.load(await exhibitionLayoutPdf([r],[a,b,c]));assert.equal(pdf.getPageCount(),7);assert.ok(pdf.getPage(0).getWidth()>pdf.getPage(0).getHeight());
});

test("caption fitting preserves the print area and picks the largest size from 10pt down to 8pt",()=>{
  for(const [value,size,lines] of [["",10,1],["あ".repeat(100),10,4],["あ".repeat(101),9.7,4],["あ".repeat(150),8.2,5],["あ".repeat(155)+"i",8,5]] as const){
    const fitted=fitBoardCaption(value,measureBoardText);
    assert.equal(fitted.fontSize,size);assert.equal(fitted.lines.length,lines);assert.equal(fitted.fits,true);
    assert.equal(fitted.lines.join(''),value);
    assert.ok(fitted.lines.every(line=>measureBoardText(line,size)<=boardTextLayout.bodyWidth+.001));
    assert.ok((lines-1)*fitted.lineHeightMm+size*25.4/72<=captionTypography.heightMm+.001);
    if(size<10){const next=size+.1,wrapped=wrapBoardText(value,next,boardTextLayout.bodyWidth,measureBoardText);assert.ok((wrapped.length-1)*captionTypography.lineHeightMm*next/10+next*25.4/72>captionTypography.heightMm+.001);}
  }
  for(const value of ['あ'.repeat(156),'行\n'.repeat(5),'\n'.repeat(5)]){
    const fitted=fitBoardCaption(value,measureBoardText);assert.equal(fitted.fontSize,8);assert.equal(fitted.fits,false);
    const c=content();c.works[0].caption=value;assert.ok(validateBoardText(c).some(i=>i.path.endsWith('caption')&&i.message.includes('標準の8ptの枠に収まりません')));
  }
  const c=content();c.works[0].caption='i'.repeat(400);assert.ok(!validateBoardText(c).some(i=>i.path.endsWith('caption')));
  c.works[0].caption+='i';assert.ok(validateBoardText(c).some(i=>i.path.endsWith('caption')&&i.layout&&i.message.includes('400文字')));
});

test("PDF cards and layout previews accept longer captions at the fitted size without changing saved content",async()=>{
  const {generateTitleBoards}=await import('../src/lib/exhibitionOutputs.ts');
  const {titleBoardPreview}=await import('../src/lib/exhibitionTitleBoardPreview.ts');
  const {PDFDocument,PDFArray,PDFRawStream,decodePDFRawStream}=await import('pdf-lib');
  const {emptySubmission}=await import('../src/lib/exhibitionTypes.ts');
  const c=emptySubmission(),now=new Date().toISOString(),eid=uuid(),sectionId=uuid();
  c.name=c.authorName='作者';c.grade='1年';
  c.works=[100,101,155].map((n,i)=>({...work(),sectionId,kind:'book' as const,title:['標準','自動縮小','最小サイズ'][i],caption:'あ'.repeat(n)+(i===2?'i':''),photos:[]}));
  const exhibition={id:eid,title:'可変サイズ',revision:1,status:'open' as const,opensAt:'',closesAt:'',createdAt:now,updatedAt:now,schemas:[{version:1,sections:[{id:sectionId,title:'通常展示',description:''}],fields:[],captionLabel:'キャプション'}],rooms:[],albumId:uuid(),gallery:'staff' as const,googleForms:[]};
  const submission={id:uuid(),exhibitionId:eid,tokenHash:'',revision:1,schemaVersion:1,createdAt:now,updatedAt:now,draft:c,versions:[{version:1,schemaVersion:1,at:now,content:c,delivery:'delivered' as const,attempts:0,nextAttemptAt:0}],portfolioId:'author',qrConfirmed:true};
  const data={version:1 as const,exhibitions:[exhibition],submissions:[submission],assets:[]},before=structuredClone(data);
  const output=await generateTitleBoards(data,exhibition,'https://scharade.jp');
  assert.deepEqual(output.issues,[]);assert.ok(output.pdf);
  const pdf=await PDFDocument.load(output.pdf),streams=pdf.getPage(0).node.Contents();assert.ok(streams instanceof PDFArray);
  const commands=streams.asArray().map(ref=>{const stream=pdf.context.lookup(ref);assert.ok(stream instanceof PDFRawStream);return Buffer.from(decodePDFRawStream(stream).decode()).toString('utf8');}).join('\n');
  assert.equal([...commands.matchAll(/ 9\.7 Tf/g)].length,4);
  assert.equal([...commands.matchAll(/ 8 Tf/g)].length,5);
  for(const w of c.works){const preview=await titleBoardPreview({submission,work:w,qrUrl:'https://scharade.jp/Portfolio/author'},'https://scharade.jp');assert.deepEqual(preview.issues,[]);assert.equal((await sharp(preview.png).metadata()).width,840);}
  assert.deepEqual(data,before);
  c.works[0].caption='あ'.repeat(156);const rejected=await generateTitleBoards(data,exhibition,'https://scharade.jp');assert.equal(rejected.pdf,null);assert.ok(rejected.issues.some(i=>/キャプション|配置/.test(i.message)),JSON.stringify(rejected.issues));
});
