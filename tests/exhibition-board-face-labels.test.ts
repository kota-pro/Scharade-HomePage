import test from 'node:test';import assert from 'node:assert/strict';
import {boardFaceLabels} from '../src/lib/exhibitionBoardFaceLabels.ts';
import {roomSurfaces,surfacePlacements} from '../src/lib/exhibitionSurface.ts';
import {layoutScene} from '../src/lib/exhibitionLayoutScene.ts';import {roomPreview} from '../src/lib/exhibitionRoomPreview.ts';
import {layoutOutputViews,layoutOutputPages,exhibitionLayoutSvgFiles,exhibitionLayoutPdf} from '../src/lib/exhibitionOutputs.ts';
import {connectTouchingBoards,boardChain} from '../src/lib/exhibitionBoards.ts';import {roomFromPenPath} from '../src/lib/exhibitionRoomPath.ts';
import type {BoardGroup} from '../src/lib/exhibitionTypes.ts';import {PDFDocument} from 'pdf-lib';
const group=(x:number,y=1000):BoardGroup=>({id:crypto.randomUUID(),name:'展示ボード',x,y,rotation:0,panels:[{id:crypto.randomUUID(),name:'パネル',width:900,height:1800,thickness:30,hingeAngle:0}]});
function room(){const r=roomFromPenPath([{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);r.boardGroups=[group(1000),group(3000)];return r;}
const visibleLabels=(svg:string,prefix='')=>[...svg.matchAll(new RegExp(`data-${prefix}board-face-label="([A-Z]+)"`,'g'))].map(m=>m[1]);
test('each independent run receives a sequential pair while stored A/B surface references remain unchanged',()=>{
 const r=room(),g=r.boardGroups![1],workId=crypto.randomUUID();r.boardPlacements=[{workId,groupId:g.id,face:'A',x:100,bottom:500,rotation:0}];r.titleBoards=[{id:crypto.randomUUID(),workId,surface:`board:${g.id}:A`,x:400,bottom:500,rotation:0}];r.annotations=[{id:crypto.randomUUID(),kind:'text',surface:`board:${g.id}:B`,x:100,y:100,width:100,height:65,text:'裏面',fontSize:50,rotation:0}];const before=structuredClone(r),surfaces=roomSurfaces(r).filter(s=>s.groupId);
 assert.deepEqual(surfaces.map(s=>s.label),['展示ボード・A面','展示ボード・B面','展示ボード・C面','展示ボード・D面']);assert.deepEqual(surfaces.map(s=>s.face),['A','B','A','B']);assert.deepEqual(surfaces.map(s=>s.key),r.boardGroups!.flatMap(g=>[`board:${g.id}:A`,`board:${g.id}:B`]));assert.equal(surfacePlacements(r,surfaces[2])[0],r.boardPlacements[0]);assert.equal(surfaces[3].panels![0].panel.id,g.panels[0].id);layoutScene(r,[],surfaces[3].key);assert.deepEqual(r,before);
});
test('legacy touching panels and folded canonical groups share one pair, stable across connection',()=>{
 const r=room(),start=group(1000),middle=group(1900),isolated=group(4000);r.boardGroups=[middle,isolated,start];const labels=boardFaceLabels(r.boardGroups);assert.deepEqual(labels.get(start.id),labels.get(middle.id));assert.deepEqual(labels.get(isolated.id),{A:'A',B:'B'});assert.deepEqual(labels.get(start.id),{A:'C',B:'D'});
 const joined=connectTouchingBoards(r),next=boardFaceLabels(joined.boardGroups!);for(const g of joined.boardGroups!)assert.deepEqual(next.get(g.id),labels.get(g.id));assert.equal(boardChain(joined.boardGroups!.find(g=>g.id===start.id)!).length,2);joined.boardGroups!.find(g=>g.id===start.id)!.panels[1].hingeAngle=90;assert.deepEqual(boardFaceLabels(joined.boardGroups!).get(start.id),{A:'C',B:'D'});
});
test('floor, overview and output headings use the same labels, unaffected by layer order or hidden groups',()=>{
 const r=room(),before=structuredClone(r);assert.deepEqual(visibleLabels(layoutScene(r,[],'floor').svg),['A','B','C','D']);assert.deepEqual(visibleLabels(roomPreview(r,[]).svg,'preview-'),['A','B','C','D']);assert.deepEqual(r,before);
 r.editor={order:r.boardGroups!.map(g=>`board:${g.id}`).reverse(),hidden:[],locked:[],groups:[]};assert.deepEqual(visibleLabels(layoutScene(r,[],'floor').svg).sort(),['A','B','C','D']);r.editor.hidden=[`board:${r.boardGroups![0].id}`];assert.deepEqual(visibleLabels(layoutScene(r,[],'floor').svg),['C','D']);assert.deepEqual(layoutOutputViews(r).filter(s=>s.key.startsWith('board:')).map(s=>s.label),['展示ボード・C面','展示ボード・D面']);
 const legacy=room();legacy.boardGroups=[group(1000),group(1900),group(2800)];legacy.editor={order:[],hidden:[`board:${legacy.boardGroups[1].id}`],locked:[],groups:[]};assert.deepEqual(visibleLabels(layoutScene(legacy,[],'floor').svg),['A','B']);
});
test('the alphabet continues beyond Z without collisions and a single run retains A/B',()=>{
 const groups=Array.from({length:14},(_,i)=>group(i*2000));const labels=boardFaceLabels(groups);assert.deepEqual(labels.get(groups[12].id),{A:'Y',B:'Z'});assert.deepEqual(labels.get(groups[13].id),{A:'AA',B:'AB'});assert.equal(new Set([...labels.values()].flatMap(p=>[p.A,p.B])).size,28);assert.deepEqual(boardFaceLabels([groups[0]]).get(groups[0].id),{A:'A',B:'B'});
});
test('SVG artboards and PDF pages include every independently named surface without changing physical data',async()=>{
 const r=room(),before=structuredClone(r),surfaces=roomSurfaces(r).filter(s=>s.groupId);for(const surface of surfaces)assert.ok(layoutOutputPages(r,[],surface.key)[0].includes(surface.label));const files=exhibitionLayoutSvgFiles(r,[]);for(const letter of ['A','B','C','D'])assert.equal(files.filter(f=>f.name.endsWith(`・${letter}面.svg`)).length,1);assert.equal(files.length,9);assert.ok(files.every(f=>!new TextDecoder().decode(f.bytes).includes('<text')));const pdf=await PDFDocument.load(await exhibitionLayoutPdf([r],[]));assert.equal(pdf.getPageCount(),9);assert.deepEqual(r,before);
});
