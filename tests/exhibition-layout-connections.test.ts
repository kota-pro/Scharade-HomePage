import test from 'node:test';import assert from 'node:assert/strict';
import type {RoomLayout,LayoutWork,VectorNode} from '../src/lib/exhibitionTypes.ts';
import {roomWalls,ensureRoomPath,setRoomWallName,validRoomPath} from '../src/lib/exhibitionRoomPath.ts';
import {wallConnectionChoices,reverseConnectionNodes} from '../src/lib/exhibitionWallConnections.ts';
import {copyLayoutSelection,pasteLayoutSelection,pasteLayoutRoom} from '../src/lib/exhibitionLayoutClipboard.ts';
import {layoutObjects} from '../src/lib/exhibitionLayoutModel.ts';
import {diffLayoutRooms,applyLayoutChanges,invertLayoutChanges} from '../src/lib/exhibitionLayoutChanges.ts';
import {parseRooms} from '../src/lib/exhibitionValidation.ts';
import {reusableRoom} from '../src/lib/exhibitionRoomReuse.ts';
import {insertRoomVertex} from '../src/lib/exhibitionEditing.ts';
const id=()=>crypto.randomUUID();
function room():RoomLayout {const r:RoomLayout={id:id(),name:'展示室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3100,3200,3300],placements:[],openings:[],tables:[],books:[],annotations:[],boardGroups:[]};ensureRoomPath(r);return r;}
const path=(r:RoomLayout,start=0,end=1):VectorNode[]=>[{...r.vertices[start]},{id:id(),x:1000,y:600},{id:id(),x:5000,y:600},{...r.vertices[end]}];
test('pen wall replacements preserve the other walls, stable IDs, names and attached objects and support atomic undo',()=>{
  const r=room();setRoomWallName(r,2,'奥の壁');r.openings=[{id:id(),wall:2,wallId:r.wallIds![2],kind:'door',offset:100,width:900,bottom:0,height:2100}];
  const before=structuredClone(r),choice=wallConnectionChoices(r,path(r),r.vertices[0].id!,r.vertices[1].id!)[0];assert(choice.room,choice.error??'Missing room');const next=choice.room;
  assert.equal(next.vertices.length,6);assert(validRoomPath(next));assert.equal(roomWalls(next).find(w=>w.id===r.wallIds![2])!.label,'奥の壁');assert.equal(next.openings[0].wallId,r.openings[0].wallId);assert.equal(next.openings[0].wall,4);assert.deepEqual(r,before);parseRooms([next]);
  const changes=diffLayoutRooms([r],[next]);assert.deepEqual(JSON.parse(JSON.stringify(applyLayoutChanges([r],changes))),JSON.parse(JSON.stringify([next])));assert.deepEqual(JSON.parse(JSON.stringify(applyLayoutChanges([next],invertLayoutChanges(changes)))),JSON.parse(JSON.stringify([r])));
  const reverse=wallConnectionChoices(r,reverseConnectionNodes(path(r)),r.vertices[1].id!,r.vertices[0].id!)[1];assert(reverse.room);assert.deepEqual(reverse.room.vertices.map(({x,y})=>({x,y})),next.vertices.map(({x,y})=>({x,y})));
});
test('disconnected endpoints, intersections, occupied walls and branches are refused without changing the room',()=>{
  const r=room(),before=structuredClone(r);const crossing=[r.vertices[0],{x:4000,y:3000},{x:1000,y:3000},{x:4000,y:1000},r.vertices[1]];
  assert.match(wallConnectionChoices(r,crossing,r.vertices[0].id!,r.vertices[1].id!)[0].error!,/交差|外周/);
  assert.throws(()=>wallConnectionChoices(r,path(r),r.vertices[0].id!,r.vertices[0].id!),/異なる/);
  assert.throws(()=>wallConnectionChoices(r,[{x:100,y:100},r.vertices[1]],r.vertices[0].id!,r.vertices[1].id!),/両端/);
  assert.deepEqual(r,before);r.openings=[{id:id(),wall:0,kind:'door',offset:0,width:900,bottom:0,height:2100}];assert.match(wallConnectionChoices(r,path(r),r.vertices[0].id!,r.vertices[1].id!)[0].error!,/再配置/);
  r.openings=[];r.tables=[{id:id(),name:'台',x:0,y:0,width:900,depth:600,rotation:0,attachment:{wallId:r.wallIds![0],offset:0,distance:0}}];assert.match(wallConnectionChoices(r,path(r),r.vertices[0].id!,r.vertices[1].id!)[0].error!,/再配置/);
});
test('non-adjacent wall endpoints expose both exterior routes and curved pen segments stay curved',()=>{
  const r=room(),nodes=[r.vertices[0],{id:id(),x:3000,y:2000},r.vertices[2]],choices=wallConnectionChoices(r,nodes,r.vertices[0].id!,r.vertices[2].id!);assert.equal(choices.length,2);assert(choices.every(c=>c.room));assert(choices.every(c=>c.replacedWallIds.length===2));
  const curved=path(r);curved[0]={...curved[0],out:{x:200,y:0}};curved[1]={...curved[1],in:{x:-200,y:0}};const next=wallConnectionChoices(r,curved,r.vertices[0].id!,r.vertices[1].id!)[0].room!;assert.deepEqual(next.vertices[0].out,{x:200,y:0});parseRooms([next]);
});
test('custom wall and figure names round-trip, survive anchor insertion and template reuse, and appear in layer labels',()=>{
  const r=room();setRoomWallName(r,0,'入口 <東>');r.annotations=[{id:id(),name:'受付の枠',kind:'rect',x:100,y:100,width:300,height:200,rotation:0,text:'注記',fontSize:100}];r.openings=[{id:id(),name:'搬入口',wall:1,kind:'door',offset:0,width:900,bottom:0,height:2100}];
  const parsed=parseRooms([r])[0];assert.equal(roomWalls(parsed)[0].label,'入口 <東>');assert.equal(layoutObjects(parsed,[]).find(o=>o.kind==='annotation')!.label,'受付の枠');assert.equal(layoutObjects(parsed,[]).find(o=>o.kind==='opening')!.label,'搬入口');
  const split=insertRoomVertex(parsed,0);assert.equal(roomWalls(split).find(w=>w.id===r.wallIds![0])!.label,'入口 <東>');assert.equal(roomWalls(reusableRoom(parsed))[0].label,'入口 <東>');
  const changed=structuredClone(parsed);setRoomWallName(changed,0,'');const edits=diffLayoutRooms([parsed],[changed]);assert.equal(roomWalls(applyLayoutChanges([parsed],edits)[0])[0].label,'壁1');assert.throws(()=>setRoomWallName(parsed,0,'あ'.repeat(151)),/150/);
});
test('shape, opening, table and grouped board copies get fresh identities and preserve styles without copying works',()=>{
  const r=room(),a=id(),board=id(),panel=id();r.annotations=[{id:a,name:'自由線',kind:'path',x:200,y:300,width:400,height:200,rotation:30,text:'',fontSize:100,color:'#123456',opacity:.5,path:{closed:false,nodes:[{id:id(),x:0,y:0,out:{x:100,y:50}},{id:id(),x:400,y:200}]}}];
  r.tables=[{id:id(),name:'本の台',x:1000,y:1000,width:900,depth:600,rotation:0}];r.openings=[{id:id(),name:'扉',wall:0,wallId:r.wallIds![0],kind:'door',offset:500,width:900,bottom:0,height:2100}];r.boardGroups=[{id:board,name:'展示パネル',x:1000,y:2500,rotation:0,panels:[{id:panel,name:'1枚目',width:1000,height:2000,thickness:40,hingeAngle:0}]}];
  const work={id:id(),sectionId:id(),kind:'single',title:'作品',caption:'',location:'',equipment:'',settings:'',photos:[{assetId:id(),x:0,y:0,width:200,height:300,rotation:0}],fields:{}} as LayoutWork;r.placements=[{workId:work.id,wall:2,x:100,bottom:1000,rotation:0}];r.boardPlacements=[{workId:id(),groupId:board,face:'A',x:100,bottom:100,rotation:0}];
  const objects=layoutObjects(r,[work]),clip=copyLayoutSelection(r,[work],'floor',objects)!;const pasted=pasteLayoutSelection(r,'floor',clip).room;assert.equal(pasted.annotations!.length,2);assert.equal(pasted.tables.length,2);assert.equal(pasted.openings.length,2);assert.equal(pasted.boardGroups!.length,2);assert.equal(pasted.placements.length,1);assert.equal(pasted.boardPlacements!.length,1);
  assert.notEqual(pasted.annotations![1].path!.nodes[0].id,r.annotations[0].path!.nodes[0].id);assert.deepEqual(pasted.annotations![1].path!.nodes[0].out,{x:100,y:50});assert.equal(pasted.annotations![1].opacity,.5);assert.equal(pasted.annotations![1].x,300);assert.notEqual(pasted.boardGroups![1].panels[0].id,panel);parseRooms([pasted]);
  assert.equal(copyLayoutSelection(r,[work],'floor',objects.filter(o=>o.kind==='work')),undefined);
});
test('wall and panel annotations, images and dimensions remap their surfaces and targets on paste',()=>{
  const r=room(),a=id();r.annotations=[{id:a,kind:'image',assetId:id(),surface:'wall:0',surfaceWallId:r.wallIds![0],x:200,y:300,width:300,height:200,rotation:0,text:'',fontSize:100}];r.dimensions=[{id:id(),surface:'wall:0',surfaceWallId:r.wallIds![0],a:{kind:'object',objectId:`annotation:${a}`,u:0,v:0},b:{kind:'object',objectId:`annotation:${a}`,u:1,v:0},offset:100,color:'#777777'}];
  const clip=copyLayoutSelection(r,[],'wall:0',layoutObjects(r,[],'wall:0'))!,pasted=pasteLayoutSelection(r,'wall:1',clip).room;const copied=pasted.annotations![1],dimension=pasted.dimensions![1];assert.equal(copied.surface,'wall:1');assert.equal(copied.surfaceWallId,r.wallIds![1]);assert.equal(copied.assetId,r.annotations[0].assetId);assert.equal((dimension.a as any).objectId,`annotation:${copied.id}`);parseRooms([pasted]);
  const whole=copyLayoutSelection(r,[],'floor',[],true)!;const copy=pasteLayoutRoom(whole);assert.equal(copy.annotations![0].kind,'image');assert.notEqual(copy.id,r.id);assert.equal(reusableRoom(r).annotations!.length,0);parseRooms([copy]);
});
test('board copies include venue annotations and measurements on both faces, remapping panel and group references',()=>{
  const r=room(),board=id(),panel=id(),a=id();r.boardGroups=[{id:board,name:'二面パネル',x:1000,y:2000,rotation:0,panels:[{id:panel,name:'1枚目',width:1200,height:2000,thickness:40,hingeAngle:0}]}];
  r.annotations=[{id:a,name:'案内',kind:'rect',surface:`board:${board}:B`,x:100,y:200,width:300,height:200,rotation:0,text:'',fontSize:100}];
  r.dimensions=[{id:id(),surface:`board:${board}:B`,a:{kind:'panel',panelId:panel,u:0,v:0},b:{kind:'panel',panelId:panel,u:1,v:0},offset:100,color:'#777777'}];
  const pasted=pasteLayoutSelection(r,'floor',copyLayoutSelection(r,[],'floor',layoutObjects(r,[]))!).room,newBoard=pasted.boardGroups![1];
  assert.equal(pasted.annotations![1].surface,`board:${newBoard.id}:B`);assert.equal(pasted.annotations![1].x,100);assert.equal((pasted.dimensions![1].a as any).panelId,newBoard.panels[0].id);parseRooms([pasted]);
});
