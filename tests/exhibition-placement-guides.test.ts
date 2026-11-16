import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {equalizeSurfaceWorks,surfaceMeasurements,setSurfaceGap,eyeHeightSnap,alignSurfaceEyeHeight,layoutWorkSummary,guideMeasurementsSvg} from '../src/lib/exhibitionPlacementGuides.ts';
import type {RoomLayout,LayoutWork} from '../src/lib/exhibitionTypes.ts';
import {addWorkTitleBoardPair} from '../src/lib/exhibitionLayoutModel.ts';
import {roomProblems} from '../src/lib/exhibitionGeometry.ts';
import {titleBoardPlacementProblems} from '../src/lib/exhibitionLayoutModel.ts';
const work=(width:number,height=200):LayoutWork=>({id:crypto.randomUUID(),sectionId:crypto.randomUUID(),kind:'single',title:'作品',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{assetId:crypto.randomUUID(),x:0,y:0,width,height,rotation:0}]});
const room=():RoomLayout=>({id:crypto.randomUUID(),name:'展示室',vertices:[{x:0,y:0},{x:3000,y:0},{x:3000,y:2500},{x:0,y:2500}],wallHeights:[3000,3000,3000,3000],openings:[],placements:[],tables:[],books:[]});
test('equal spacing reserves doors and moves linked title boards safely without changing the original room',()=>{
 const r=room();r.vertices[1].x=r.vertices[2].x=6000;
 const works=[work(700,300),work(700,300)];
 works.forEach((w,i)=>{w.title=`扉を避ける作品${i+1}`;addWorkTitleBoardPair(r,w,'wall:0',{x:200+i*3500,y:1500},{x:600+i*3500,y:2000});});
 r.openings=[{id:crypto.randomUUID(),wall:0,kind:'door',offset:1600,width:1000,height:2100,bottom:0}];
 const original=structuredClone(r),next=equalizeSurfaceWorks(r,works,'wall:0');
 assert.deepEqual(roomProblems(next,works),[]);assert.deepEqual(titleBoardPlacementProblems(next,works),[]);
 assert.equal(next.placements[0].x,450);assert.equal(next.placements[1].x,3950);
 next.titleBoards!.forEach((card,i)=>{assert.equal(card.x-next.placements[i].x,original.titleBoards![i].x-original.placements[i].x);assert.equal(card.bottom,original.titleBoards![i].bottom);});
 assert.deepEqual(r,original);
});
test('wall shapes and floor columns touching the wall are reserved; openings below the works do not consume width',()=>{
 const r=room(),works=[work(300),work(300)];r.placements=works.map((w,i)=>({workId:w.id,wall:0,x:50+i*1500,bottom:1000,rotation:0}));
 r.annotations=[{id:'column',name:'柱',kind:'rect',x:1200,y:0,width:600,height:400,rotation:0,text:'',fontSize:100},{id:'wall-column',name:'柱2',kind:'rect',surface:'wall:0',x:2400,y:0,width:200,height:3000,rotation:0,text:'',fontSize:100}];
 const next=equalizeSurfaceWorks(r,works,'wall:0');
 for(const p of next.placements)for(const [left,right] of [[1200,1800],[2400,2600]])assert.ok(p.x+300<=left+.01||p.x>=right-.01);
 const below=room();below.placements=structuredClone(r.placements);below.openings=[{id:'low',kind:'window',wall:0,offset:600,width:1800,height:300,bottom:0}];
 assert.deepEqual(equalizeSurfaceWorks(below,works,'wall:0').placements.map(p=>p.x),[800,1900]);
});
test('a blocked wall reports insufficient usable space without moving any work, and each staggered row measures its own wall ends',()=>{
 const r=room(),works=[work(700),work(700)];r.placements=works.map((w,i)=>({workId:w.id,wall:0,x:100+i*1800,bottom:1000,rotation:0}));
 r.openings=[{id:'wide',kind:'door',wall:0,offset:500,width:2000,height:3000,bottom:0}];const original=structuredClone(r);
 assert.throws(()=>equalizeSurfaceWorks(r,works,'wall:0'),/扉・窓・柱/);assert.deepEqual(r,original);
 r.openings=[];r.placements[1].bottom=1800;
 const edges=surfaceMeasurements(r,works,'wall:0',false).filter(m=>m.kind==='edge');assert.equal(edges.length,4);
 assert.deepEqual(edges.map(m=>m.value),[100,2200,1900,400]);assert.ok(edges.every(m=>m.label?.includes('端まで')));
});
test('equal spacing includes both wall ends, preserves order and physical widths, and handles one work',()=>{const r=room(),works=[work(200),work(400),work(600)];r.placements=works.map((w,i)=>({workId:w.id,wall:0,x:100+i*700,bottom:1000,rotation:0}));const next=equalizeSurfaceWorks(r,works,'wall:0'),gap=(3000-1200)/4;assert.deepEqual(next.placements.map(p=>p.x),[gap,gap+200+gap,gap+200+gap+400+gap]);assert.deepEqual(next.placements.map(p=>p.bottom),[1000,1000,1000]);const edges=surfaceMeasurements(next,works,'wall:0').filter(m=>m.kind!=='size');assert.equal(edges.filter(m=>m.axis==='x').length,4);edges.filter(m=>m.axis==='x').forEach(m=>assert.ok(Math.abs(m.value-gap)<.01));assert.deepEqual(layoutWorkSummary(next,works,'wall:0'),{count:3,width:1200});const only=room();only.placements=[{workId:works[0].id,wall:0,x:100,bottom:1000,rotation:0}];assert.equal(equalizeSurfaceWorks(only,works,'wall:0').placements[0].x,1400);});
test('panel distribution remains within each panel on A and reversed B faces',()=>{const r=room(),works=[work(200),work(300),work(400),work(100)],id=crypto.randomUUID();r.boardGroups=[{id,name:'連結パネル',x:0,y:0,rotation:0,panels:[{id:crypto.randomUUID(),name:'1',width:1000,height:2000,thickness:30,hingeAngle:0},{id:crypto.randomUUID(),name:'2',width:1400,height:2000,thickness:30,hingeAngle:30}]}];r.boardPlacements=works.map((w,i)=>({workId:w.id,groupId:id,face:i<2?'A':'B',x:i===0?100:i===1?1200:i===2?100:1600,bottom:1000,rotation:0}));for(const face of ['A','B']){const next=equalizeSurfaceWorks(r,works,`board:${id}:${face}`),gaps=surfaceMeasurements(next,works,`board:${id}:${face}`,false,true).filter(m=>m.kind==='panel-edge');assert.equal(gaps.length,4);assert.equal(next.boardPlacements!.filter(p=>p.face===face).length,2);for(const p of next.boardPlacements!.filter(p=>p.face===face))assert.ok(p.x>0);} });
test('gap editing fixes the chosen work or boundary, moves linked cards, rejects locks and insufficient width',()=>{const r=room(),works=[work(200),work(300)];r.placements=works.map((w,i)=>({workId:w.id,wall:0,x:200+i*600,bottom:1000,rotation:0}));const gap=surfaceMeasurements(r,works,'wall:0').find(m=>m.kind==='gap')!,next=setSurfaceGap(r,works,'wall:0',gap.id,500,works[0].id);assert.equal(next.placements[0].x,200);assert.equal(next.placements[1].x,900);const edge=surfaceMeasurements(next,works,'wall:0').find(m=>m.kind==='edge'&&m.b)!,again=setSurfaceGap(next,works,'wall:0',edge.id,300);assert.equal(again.placements[0].x,300);r.editor={order:[],groups:[],hidden:[],locked:[`work:${works[0].id}`]};assert.throws(()=>equalizeSurfaceWorks(r,works,'wall:0'),/ロック/);const large=work(4000);const small=room();small.placements=[{workId:large.id,wall:0,x:0,bottom:1000,rotation:0}];assert.throws(()=>equalizeSurfaceWorks(small,[large],'wall:0'),/収まり/);});
test('eye alignment uses work centers and readable dimension boxes never overlap each other',()=>{const r=room(),works=[work(200,200),work(400,400)];r.placements=works.map((w,i)=>({workId:w.id,wall:0,x:300+i*800,bottom:1000,rotation:0}));const next=alignSurfaceEyeHeight(r,works,'wall:0');assert.deepEqual(next.placements.map(p=>p.bottom),[1350,1250]);const snap=eyeHeightSnap(next,works,'wall:0',works.map(w=>`work:${w.id}`),3,8);assert.equal(snap?.dy,0);const rendered=guideMeasurementsSvg(surfaceMeasurements(next,works,'wall:0'),1,true);for(let i=0;i<rendered.boxes.length;i++)for(let j=i+1;j<rendered.boxes.length;j++){const a=rendered.boxes[i],b=rendered.boxes[j];assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));}assert.match(rendered.svg,/data-layout-auto-gap/);});

test('connected panel heights use only the leftmost full height and adjacent height differences on either face',()=>{
 const r=room(),id=crypto.randomUUID();r.boardGroups=[{id,name:'連続ボード',x:0,y:0,rotation:0,panels:[2000,2000,2400,2100].map((height,i)=>({id:`panel-${i}`,name:`ボード${i+1}`,width:900,height,thickness:30,hingeAngle:0}))}];
 for(const [face,firstHeight,differences] of [['A',2000,[400,300]],['B',2100,[300,400]]] as const){
  const view=`board:${id}:${face}`,sizes=surfaceMeasurements(r,[],view),vertical=sizes.filter(m=>m.axis==='y');
  assert.equal(vertical.length,3);assert.equal(vertical[0].id,'size:surface:y');assert.equal(vertical[0].x1,-100);assert.equal(vertical[0].value,firstHeight);assert.equal(vertical[0].y1,2400-firstHeight);assert.equal(vertical[0].y2,2400);
  assert.deepEqual(vertical.slice(1).map(m=>m.value),differences);assert.ok(vertical.slice(1).every(m=>m.label==='高さ差 '&&m.value===m.y2-m.y1));
  assert.match(guideMeasurementsSvg(sizes,1).svg,/高さ差 400.0 mm/);
  assert.equal(surfaceMeasurements(r,[],view,false).length,0);
 }
 r.boardGroups[0].panels.forEach(p=>p.height=2000);
 for(const face of ['A','B'])assert.equal(surfaceMeasurements(r,[],`board:${id}:${face}`).filter(m=>m.axis==='y').length,1);
 r.boardGroups[0].panels.length=1;assert.equal(surfaceMeasurements(r,[],`board:${id}:A`).filter(m=>m.axis==='y').length,1);
 const wall=surfaceMeasurements(r,[],'wall:0').find(m=>m.axis==='y');assert.equal(wall?.value,3000);
});
