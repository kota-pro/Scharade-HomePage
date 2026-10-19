import test from 'node:test';
import assert from 'node:assert/strict';
import { addWorkTitleBoardPair, selectedLayoutObjects, translateLayoutObjects, rotateLayoutObjects, layoutObjects, removeLayoutObjects, objectHidden, objectLocked, snapLayoutMovement, LayoutHistory, boxCenter, titleBoardBox } from '../src/lib/exhibitionLayoutModel.ts';
import { parseRooms } from '../src/lib/exhibitionValidation.ts';
import { reusableRoom } from '../src/lib/exhibitionRoomReuse.ts';
import { joinBoardGroups, detachBoardGroup, boardPlacementProblems } from '../src/lib/exhibitionBoards.ts';
import { insertRoomVertex, removeRoomVertex } from '../src/lib/exhibitionEditing.ts';
import { layoutScene } from '../src/lib/exhibitionLayoutScene.ts';
import type { RoomLayout, LayoutWork } from '../src/lib/exhibitionTypes.ts';
const id=()=>crypto.randomUUID();
const room=():RoomLayout=>({id:id(),name:'展示室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],placements:[],openings:[],books:[],tables:[]});
const work=():LayoutWork=>({id:id(),kind:'single',sectionId:id(),title:'記憶',caption:'',location:'',equipment:'',settings:'',photos:[{assetId:id(),x:120,y:50,width:210,height:297,rotation:0}],fields:{}});
test('a work and fixed physical card are one group, with independently editable coordinates',()=>{
 const r=room(),w=work(),c=addWorkTitleBoardPair(r,w,'wall:1',{x:400,y:1000},{x:700,y:1300});
 assert.equal(r.placements[0].bottom,1703);assert.deepEqual(titleBoardBox(r,c),{x:700,y:1300,width:105,height:74.25,orientation:'横'});
 const selected=selectedLayoutObjects(r,[w],'wall:1',[`work:${w.id}`]);assert.equal(selected.length,2);
 translateLayoutObjects(r,[w],'wall:1',selected.map(o=>o.id),100,-50);assert.equal(c.x,800);assert.equal(c.bottom,1675.75);
 const individual=selectedLayoutObjects(r,[w],'wall:1',[`titleboard:${c.id}`],true);assert.equal(individual.length,1);
 translateLayoutObjects(r,[w],'wall:1',individual.map(o=>o.id),30,40);assert.equal(c.x,830);assert.equal(r.placements[0].x,500);
 const centers=layoutObjects(r,[w],'wall:1').map(o=>boxCenter(o.box));rotateLayoutObjects(r,[w],'wall:1',selected.map(o=>o.id),90,{x:0,y:0});
 const rotated=layoutObjects(r,[w],'wall:1');rotated.forEach((o,i)=>{const p=boxCenter(o.box);assert.ok(Math.abs(p.x+centers[i].y)<.1);assert.ok(Math.abs(p.y-centers[i].x)<.1);});
 assert.equal(c.rotation,90);assert.equal(rotated[1].box.width,74.25);assert.equal(rotated[1].box.height,105);
 assert.throws(()=>addWorkTitleBoardPair(r,w,'wall:1',{x:0,y:0},{x:0,y:0}),/配置済み/);
 assert.equal(parseRooms([r])[0].titleBoards!.length,1);
 removeLayoutObjects(r,[`titleboard:${c.id}`]);assert.equal(r.placements.length,1);assert.equal(r.editor!.groups.length,0);
 const again=addWorkTitleBoardPair;assert.ok(again);r.titleBoards=[c];removeLayoutObjects(r,[`work:${w.id}`]);assert.equal(r.titleBoards.length,0);
});
test('legacy rooms keep no cards; card ownership, metadata and global placement uniqueness are validated',()=>{
 const r=room(),w=work();r.placements=[{workId:w.id,wall:0,x:100,bottom:1000,rotation:0}];assert.deepEqual(parseRooms([r])[0].titleBoards,[]);
 r.titleBoards=[{id:id(),workId:w.id,surface:'wall:1',x:0,bottom:0,rotation:0}];assert.throws(()=>parseRooms([r]),/同じ壁面/);
 r.titleBoards[0].surface='wall:0';r.editor={order:[`titleboard:${r.titleBoards[0].id}`],hidden:[],locked:[],groups:[]};assert.equal(parseRooms([r])[0].editor!.order.length,1);
 r.editor.hidden=['annotation:missing'];assert.throws(()=>parseRooms([r]),/存在しない/);r.editor.hidden=[];
 const second={...structuredClone(r),id:id(),titleBoards:[],editor:undefined};assert.throws(()=>parseRooms([r,second]),/重複/);
});
test('hidden and locked parents apply to children; output visibility does not discard physical data',()=>{
 const r=room(),w=work(),g={id:id(),name:'ボード',x:0,y:0,rotation:0,panels:[{id:id(),name:'1',width:900,height:1800,thickness:30,hingeAngle:0}]};r.boardGroups=[g];const c=addWorkTitleBoardPair(r,w,`board:${g.id}:A`,{x:100,y:500},{x:400,y:800});r.editor!.hidden=[`board:${g.id}`];r.editor!.locked=[`board:${g.id}`];
 assert.ok(objectHidden(r,`work:${w.id}`));assert.ok(objectHidden(r,`titleboard:${c.id}`));assert.ok(objectLocked(r,`titleboard:${c.id}`));assert.doesNotMatch(layoutScene(r,[w],`board:${g.id}:A`).svg,/data-layout-object=/);assert.equal(r.titleBoards!.length,1);
 c.x=850;assert.match(boardPlacementProblems(r,[w]).join(''),/タイトルボード/);
});
test('board joins and detaches preserve card offsets on A and reversed B faces',()=>{
 for(const face of ['A','B'] as const){const r=room(),w=work(),a={id:id(),name:'a',x:0,y:0,rotation:0,panels:[{id:id(),name:'a',width:900,height:1800,thickness:30,hingeAngle:0}]},b={...structuredClone(a),id:id(),name:'b',x:900,panels:[{...a.panels[0],id:id()}]};r.boardGroups=[a,b];const c=addWorkTitleBoardPair(r,w,`board:${b.id}:${face}`,{x:100,y:500},{x:400,y:800}),joined=joinBoardGroups(r,a.id,b.id);assert.equal(joined.titleBoards![0].x,face==='A'?1300:400);const detached=detachBoardGroup(joined,a.id,1,[w]);assert.equal(detached.titleBoards![0].x,c.x);assert.equal(detached.titleBoards![0].bottom,c.bottom);assert.equal(detached.titleBoards![0].surface,`board:${detached.boardGroups![1].id}:${face}`);}
});
test('templates remap venue IDs and clear every work/card reference; wall insertion shifts card surfaces',()=>{
 const r=room(),w=work(),a={id:id(),kind:'rect' as const,x:10,y:20,width:200,height:200,rotation:0,fontSize:100,text:''};r.annotations=[a];const c=addWorkTitleBoardPair(r,w,'wall:2',{x:100,y:1000},{x:400,y:1300});r.editor!.hidden=[`annotation:${a.id}`];const t=reusableRoom(r);assert.equal(t.titleBoards!.length,0);assert.equal(t.placements.length,0);assert.equal(t.editor!.groups.length,0);assert.equal(t.editor!.hidden[0],`annotation:${t.annotations![0].id}`);assert.notEqual(t.annotations![0].id,a.id);assert.doesNotThrow(()=>parseRooms([t]));
 const inserted=insertRoomVertex(r,0);assert.equal(inserted.titleBoards![0].surface,'wall:3');const removed=removeRoomVertex(inserted,1);assert.equal(removed.titleBoards![0].surface,c.surface);
});
test('smart guides beat grids and equal spacing; history is document-wide and bounded to 100',()=>{
 const snapped=snapLayoutMovement({x:20,y:20,width:10,height:10},[{x:100,y:100,width:10,height:10}],79,79,6,50);assert.equal(snapped.dx,80);assert.equal(snapped.dy,80);
 const spaced=snapLayoutMovement({x:44,y:0,width:10,height:10},[{x:0,y:0,width:10,height:10},{x:100,y:0,width:10,height:10}],1,0,6);assert.equal(spaced.dx,6);assert.equal(spaced.spacingX,40);
 const h=new LayoutHistory(),r=room();let current=[r,room()];for(let i=0;i<110;i++){const before=structuredClone(current);current[0].name=String(i);h.commit(before,current);}let count=0;while(h.canUndo){current=h.undo(current)!;count++;}assert.equal(count,100);assert.equal(current[0].name,'9');assert.equal(h.redo(current)![0].name,'10');
});
test('alignment moves the work/card group as a rigid unit, direct selection can align its children',async()=>{
 const {alignLayoutObjects,distributeLayoutObjects}=await import('../src/lib/exhibitionLayoutModel.ts');const r=room(),a=work(),b=work(),ca=addWorkTitleBoardPair(r,a,'wall:0',{x:100,y:1000},{x:500,y:1500}),cb=addWorkTitleBoardPair(r,b,'wall:0',{x:1000,y:1100},{x:1500,y:1600}),ids=layoutObjects(r,[a,b],'wall:0').map(o=>o.id);
 const offset=cb.x-r.placements[1].x;alignLayoutObjects(r,[a,b],'wall:0',ids,'top');assert.equal(cb.x-r.placements[1].x,offset);assert.equal(r.placements[0].bottom,r.placements[1].bottom);
 distributeLayoutObjects(r,[a,b],'wall:0',ids,'x',40);assert.equal(cb.x-r.placements[1].x,offset);
 alignLayoutObjects(r,[a,b],'wall:0',[`work:${a.id}`,`titleboard:${ca.id}`],'left',undefined,true);assert.equal(ca.x,r.placements[0].x);
});
