import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomFromPenPath,roomWalls,roomWallPoint} from '../src/lib/exhibitionRoomPath.ts';
import {wallSurfaces,wallSurface,wallSurfaceContains,wallViewSource,storeWallViewAnnotation} from '../src/lib/exhibitionWallSurfaces.ts';
import {layoutObjects,translateLayoutObjects,addWorkTitleBoardPair,titleBoardPlacementProblems,placementSurface} from '../src/lib/exhibitionLayoutModel.ts';
import {layoutScene} from '../src/lib/exhibitionLayoutScene.ts';
import {roomProblems} from '../src/lib/exhibitionGeometry.ts';
import {parseRooms} from '../src/lib/exhibitionValidation.ts';
import {equalizeSurfaceWorks,surfaceMeasurements,setSurfaceGap} from '../src/lib/exhibitionPlacementGuides.ts';
import {dimensionGeometry} from '../src/lib/exhibitionDimensions.ts';
import {changeDimension} from '../src/lib/exhibitionDimensionEditing.ts';
import {rulerSnap} from '../src/lib/exhibitionRulerSnap.ts';
import {copyLayoutSelection,pasteLayoutSelection} from '../src/lib/exhibitionLayoutClipboard.ts';
import {attachEquipment,syncWallEquipment} from '../src/lib/exhibitionWallEquipment.ts';
import type {LayoutWork,LayoutDimension} from '../src/lib/exhibitionTypes.ts';
import {setLayoutLabelPosition,cleanLayoutLabelPositions} from '../src/lib/exhibitionLabelPositions.ts';
const uid=()=>crypto.randomUUID(),near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.02,`${a} ≈ ${b}`);
function room(){return roomFromPenPath([{x:0,y:0},{x:2000,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);}
function work(title:string):LayoutWork{return {id:uid(),sectionId:uid(),kind:'single',title,caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{assetId:'',x:0,y:0,width:400,height:600,rotation:0}]};}
function fixture(){const r=room(),works=[work('左の作品'),work('右の作品')];r.placements=works.map((w,i)=>({workId:w.id,wall:i,wallId:roomWalls(r)[i].id,x:300,bottom:1000,rotation:0}));return {r,works};}
test('only consecutive collinear walls join, including the cyclic start, rotated lines and unchanged physical identities',()=>{
 const r=room(),before=structuredClone(r),s=wallSurfaces(r);assert.equal(s.length,4);assert.equal(s[0].width,6000);assert.deepEqual(s[0].walls.map(p=>p.wall.index),[0,1]);assert.deepEqual(r,before);
 const wrapped=roomFromPenPath([{x:2000,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000},{x:0,y:0}]);assert.deepEqual(wallSurface(wrapped,0)!.walls.map(p=>p.wall.index),[4,0]);assert.equal(wallSurface(wrapped,0)!.width,6000);
 const rotated=structuredClone(r);rotated.vertices.forEach(p=>{const x=p.x,y=p.y;p.x=(x-y)/Math.sqrt(2);p.y=(x+y)/Math.sqrt(2);});assert.equal(wallSurfaces(rotated).length,4);
 const bend=room();bend.vertices[1].y=10;assert.equal(wallSurfaces(bend).length,5);
 const curved=room();curved.vertices[0].out={x:500,y:100};assert.equal(wallSurfaces(curved).length,5);
 const controlled=room();controlled.vertices[0].out={x:500,y:0};controlled.vertices[1].in={x:-500,y:0};assert.equal(wallSurfaces(controlled).length,4);
 const notch=roomFromPenPath([{x:0,y:0},{x:2000,y:0},{x:2000,y:1000},{x:3000,y:1000},{x:3000,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);assert.equal(wallSurfaces(notch).length,8);
});
test('one elevation contains all original works, cards, shapes, openings, attached equipment and labels without modifying data',()=>{
 const {r,works}=fixture();r.wallHeights[1]=3500;
 r.openings=[{id:uid(),wall:1,wallId:roomWalls(r)[1].id,kind:'window',offset:1500,width:600,bottom:1000,height:800}];
 r.annotations=[{id:uid(),surface:'wall:1',surfaceWallId:roomWalls(r)[1].id,kind:'rect',name:'案内',text:'注記',x:1200,y:600,width:400,height:300,rotation:0,fontSize:50}];
 r.titleBoards=[{id:uid(),workId:works[1].id,surface:'wall:1',wallId:roomWalls(r)[1].id,x:800,bottom:1000,rotation:0}];
 r.tables=[{id:uid(),name:'机',x:0,y:0,width:600,depth:400,height:700,rotation:0}];attachEquipment(r,r.tables[0],roomWalls(r)[1].id,2200);
 const before=structuredClone(r),objects=layoutObjects(r,works,'wall:0');assert.equal(objects.filter(o=>o.kind==='work').length,2);assert.equal(objects.find(o=>o.id===`work:${works[1].id}`)!.box.x,2300);
 assert.equal(objects.find(o=>o.kind==='opening')!.box.x,3500);assert.equal(objects.find(o=>o.kind==='annotation')!.box.x,3200);assert.equal(objects.find(o=>o.kind==='annotation')!.box.y,600);
 assert.equal(objects.find(o=>o.kind==='table')!.box.x,4200);assert.equal(objects.find(o=>o.kind==='titleboard')!.box.x,2800);
 const scene=layoutScene(r,works,'wall:1',{interactive:true});assert.match(scene.svg,/data-layout-wall-part="0"/);assert.match(scene.svg,/data-layout-wall-part="1"/);assert.match(scene.svg,/data-wall-part-label="1"/);assert.match(scene.svg,/注記/);assert.equal(scene.svg.match(/data-layout-kind="work"/g)!.length,2);assert.deepEqual(r,before);
 const lens=objects.find(o=>o.kind==='annotation')!.source;lens.name='更新';lens.x+=100;delete lens.text;assert.equal(r.annotations[0].name,'更新');assert.equal(r.annotations[0].x,1300);assert.equal(r.annotations[0].text,undefined);
});
test('moving and adding across a seam retains local coordinates and survives validation, reload and floor projection',()=>{
 const {r,works}=fixture(),before=structuredClone(r.vertices),old=roomWallPoint(r,1,300);
 translateLayoutObjects(r,works,'wall:0',[`work:${works[1].id}`],-1500,100);assert.equal(r.placements[1].x,-1200);assert.equal(r.placements[1].bottom,900);near(roomWallPoint(r,1,r.placements[1].x).x,old.x-1500);
 const extra=work('追加');works.push(extra);const card=addWorkTitleBoardPair(r,extra,'wall:0',{x:4500,y:1200},{x:5000,y:1500});assert.equal(placementSurface(r,extra.id),'wall:0');assert.equal(titleBoardPlacementProblems(r,works).length,0);
 const parsed=parseRooms([r])[0];assert.deepEqual(parsed.vertices,before);assert.equal(layoutObjects(parsed,works,'wall:0').filter(o=>o.kind==='work').length,3);assert.equal(parsed.titleBoards![0].id,card.id);assert.equal(roomProblems(parsed,works).length,0);
 // A work and its card can be saved against different subdivisions of the same wall.
 parsed.titleBoards![0].surface='wall:1';parsed.titleBoards![0].wallId=roomWalls(parsed)[1].id;parsed.titleBoards![0].x-=2000;assert.doesNotThrow(()=>parseRooms([parsed]));
});
test('uniform spacing and editable gaps use both wall ends and include all subdivisions',()=>{
 const {r,works}=fixture();const equal=equalizeSurfaceWorks(r,works,'wall:0'),objects=layoutObjects(equal,works,'wall:0').filter(o=>o.kind==='work');near(objects[0].box.x,(6000-800)/3);near(objects[1].box.x,2*(6000-800)/3+400);
 const m=surfaceMeasurements(equal,works,'wall:0').find(m=>m.kind==='gap')!;near(m.value,(6000-800)/3);const changed=setSurfaceGap(equal,works,'wall:0',m.id,300,m.a);near(surfaceMeasurements(changed,works,'wall:0').find(m=>m.kind==='gap')!.value,300);assert.deepEqual(changed.vertices,r.vertices);
});
test('different heights preserve their stepped outline and reject artwork above a shorter section even across seams',()=>{
 const r=room();r.wallHeights=[3000,2000,3000,3000,3000];const s=wallSurface(r,0)!;
 assert.equal(s.height,3000);assert.equal(s.walls[1].top,1000);assert.ok(wallSurfaceContains(s,[{x:1800,y:1000},{x:2400,y:1000},{x:2400,y:1800},{x:1800,y:1800}]));assert.ok(!wallSurfaceContains(s,[{x:1800,y:900},{x:2400,y:900},{x:2400,y:1800},{x:1800,y:1800}]));
 const w=work('跨ぐ写真');r.placements=[{workId:w.id,wall:0,x:1800,bottom:1800,rotation:0}];assert.match(roomProblems(r,[w]).join(),/はみ出/);r.placements[0].bottom=1000;assert.deepEqual(roomProblems(r,[w]),[]);
});
test('dimensions, ruler snapping and distance edits resolve both legacy and cross-subdivision anchors',()=>{
 const {r,works}=fixture();r.wallHeights[1]=3500;
 const legacy:LayoutDimension={id:uid(),surface:'wall:1',surfaceWallId:roomWalls(r)[1].id,a:{kind:'surface',u:0,v:0},b:{kind:'free',x:500,y:0},offset:100,color:'#777777'};r.dimensions=[legacy];const g=dimensionGeometry(r,legacy,layoutObjects(r,works,'wall:0'))!;assert.deepEqual(g.a,{x:2000,y:0});assert.deepEqual(g.b,{x:2500,y:0});
 const d:LayoutDimension={id:uid(),surface:'wall:0',surfaceWallId:roomWalls(r)[0].id,a:{kind:'object',objectId:`work:${works[0].id}`,u:0,v:0},b:{kind:'object',objectId:`work:${works[1].id}`,u:0,v:0},offset:0,color:'#777777'};r.dimensions.push(d);assert.doesNotThrow(()=>parseRooms([r]));near(dimensionGeometry(r,d,layoutObjects(r,works,'wall:0'))!.value,2000);const next=changeDimension(r,works,d.id,1500,'a');near(dimensionGeometry(next,next.dimensions![1],layoutObjects(next,works,'wall:0'))!.value,1500);
 const snap=rulerSnap(r,works,'wall:0',{x:5999,y:3498},{tolerance:10});assert.equal(snap.snapped,true);assert.deepEqual(snap.point,{x:6000,y:3500});const measure={...d,a:{kind:'free' as const,x:0,y:0},b:snap.anchor};assert.deepEqual(dimensionGeometry(r,measure,[])!.b,snap.point);
});
test('copy/paste and opening/equipment movement retain combined coordinates and original wall geometry',()=>{
 const {r,works}=fixture();r.annotations=[{id:uid(),kind:'rect',surface:'wall:1',surfaceWallId:roomWalls(r)[1].id,x:500,y:500,width:300,height:200,rotation:0,text:'',fontSize:50}];
 const objects=layoutObjects(r,works,'wall:0'),clipboard=copyLayoutSelection(r,works,'wall:0',objects.filter(o=>o.kind==='annotation'))!;const next=pasteLayoutSelection(r,'wall:0',clipboard).room;assert.equal(layoutObjects(next,works,'wall:0').find(o=>o.id!==objects.find(o=>o.kind==='annotation')!.id&&o.kind==='annotation')!.box.x,2600);assert.doesNotThrow(()=>parseRooms([next]));
 r.openings=[{id:uid(),wall:1,wallId:roomWalls(r)[1].id,kind:'window',offset:200,width:400,bottom:500,height:800}];translateLayoutObjects(r,works,'wall:0',[`opening:${r.openings[0].id}`],-1000,0);syncWallEquipment(r);assert.equal(r.openings[0].wall,0);assert.equal(r.openings[0].offset,1200);assert.doesNotThrow(()=>parseRooms([r]));
 r.tables=[{id:uid(),name:'展示台',x:0,y:0,width:600,depth:400,height:700,rotation:0}];attachEquipment(r,r.tables[0],roomWalls(r)[1].id,100);translateLayoutObjects(r,works,'wall:0',[`table:${r.tables[0].id}`],-500,0);assert.equal(r.tables[0].attachment!.wallId,roomWalls(r)[0].id);assert.equal(r.tables[0].attachment!.offset,1600);assert.doesNotThrow(()=>parseRooms([r]));
});
test('export artboards enumerate one elevation per run and retain all works and physical subdivisions',async()=>{
 const {r,works}=fixture(),before=structuredClone(r);const {layoutOutputViews,exhibitionLayoutSvg}=await import('../src/lib/exhibitionOutputs.ts');const views=layoutOutputViews(r);assert.equal(views.length,5);assert.ok(!views.some(v=>v.key==='wall:1'));const svg=exhibitionLayoutSvg(r,works,{view:'wall:0'});assert.match(svg,/data-layout-wall-part="1"/);assert.equal(svg.match(/data-layout-kind="work"/g)!.length,2);assert.deepEqual(r,before);
});

test('shorter first sections keep text origins and label offsets stable across editing and repeated saves',()=>{
 const {r,works}=fixture();r.wallHeights[1]=3500;const a={id:uid(),surface:'wall:0',kind:'text' as const,x:300,y:100,width:500,height:100,rotation:0,fontSize:50,text:'案内'};r.annotations=[a];const lens=wallViewSource(r,a.surface,a,['x','y']);assert.equal(lens.y,600);lens.y+=200;assert.equal(a.y,300);assert.equal(storeWallViewAnnotation(r,{...lens}).y,300);
 const label={id:uid(),surface:'wall:1',target:`work:${works[1].id}`,dx:100,dy:200};r.labelPositions=[label];const next=setLayoutLabelPosition(r,'wall:0',label.target,300,400);assert.equal(next.id,label.id);cleanLayoutLabelPositions(r);setLayoutLabelPosition(r,'wall:0',label.target,500,600);cleanLayoutLabelPositions(r);assert.equal(r.labelPositions.length,1);assert.equal(r.labelPositions[0].surface,'wall:1');assert.equal(r.labelPositions[0].dx,500);assert.doesNotThrow(()=>parseRooms([r]));
});


test('opposite signs at the 180 degree boundary join at the displayed direction precision, without flattening saved walls',()=>{
 const r=roomFromPenPath([{x:6000,y:0},{x:4000,y:.5},{x:0,y:0},{x:0,y:4000},{x:6000,y:4000}]),before=structuredClone(r),walls=roomWalls(r);
 const angle=(i:number)=>Math.round(Math.atan2(walls[i].segment.b.y-walls[i].segment.a.y,walls[i].segment.b.x-walls[i].segment.a.x)*1800/Math.PI)/10;
 assert.deepEqual([angle(0),angle(1)],[180,-180]);assert.deepEqual(wallSurface(r,0)!.walls.map(p=>p.wall.index),[0,1]);assert.deepEqual(r,before);
 const tooBent=structuredClone(r);tooBent.vertices[1].y=10;assert.equal(wallSurface(tooBent,0)!.walls.length,1);
 const clockwise=roomFromPenPath([{x:6000,y:0},{x:4000,y:-.5},{x:0,y:0},{x:0,y:4000},{x:6000,y:4000}]);assert.deepEqual(wallSurface(clockwise,0)!.walls.map(p=>p.wall.index),[0,1]);
 const exact=roomFromPenPath([{x:6000,y:0},{x:4000,y:-0},{x:0,y:0},{x:0,y:4000},{x:6000,y:4000}]);assert.equal(wallSurface(exact,0)!.walls.length,2);
});

test('direction precision cannot accumulate into a bent run or merge opposite travel directions',()=>{
 const r=roomFromPenPath([{x:0,y:0},{x:1000,y:.4},{x:2000,y:1.2},{x:3000,y:2.4},{x:4000,y:4},{x:4000,y:4000},{x:0,y:4000}]);assert.deepEqual(wallSurface(r,0)!.walls.map(p=>p.wall.index),[0,1]);assert.deepEqual(wallSurface(r,3)!.walls.map(p=>p.wall.index),[2,3]);
 const tinyBend=roomFromPenPath([{x:0,y:0},{x:1,y:.05},{x:2,y:0},{x:2,y:4},{x:0,y:4}]);assert.equal(wallSurface(tinyBend,0)!.walls.length,1);
});
