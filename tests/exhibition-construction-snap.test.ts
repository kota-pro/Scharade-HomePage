import test from 'node:test';import assert from 'node:assert/strict';
import {snapConstructionPoint,constructionReferencePoints} from '../src/lib/exhibitionConstructionSnap.ts';
import {roomFromPenPath,roomWalls,scaleRoomWall} from '../src/lib/exhibitionRoomPath.ts';
const near=(a:number,b:number)=>assert(Math.abs(a-b)<.001,`${a} != ${b}`);
const room=()=>roomFromPenPath([{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);
test('Shift constrains to 45 degree rays and reference intersections without grid breaking the direction',()=>{
 const origin={x:0,y:0},found=snapConstructionPoint({x:98,y:106},origin,[{x:100,y:220}],{shift:true,grid:50,tolerance:10});near(found.point.x,100);near(found.point.y,100);assert.equal(found.guides.length,2);
 const diagonal=snapConstructionPoint({x:155,y:180},origin,[],{shift:true,grid:50,tolerance:10});near(diagonal.point.x,diagonal.point.y);near(diagonal.point.x,150);
 const vertical=snapConstructionPoint({x:3,y:150},origin,[],{shift:true,tolerance:8});near(vertical.point.x,0);near(vertical.point.y,150);
 const raw={x:98,y:106};assert.deepEqual(snapConstructionPoint(raw,origin,[],{shift:true,alt:true,grid:50,tolerance:8}).point,raw);assert.deepEqual(snapConstructionPoint(raw,origin,[],{shift:false,grid:50,tolerance:8}).point,{x:100,y:100});
});
test('the first pen point can align to existing vertices and object axes; reference snapping can be switched off',()=>{
 const found=snapConstructionPoint({x:198,y:170},undefined,[{x:200,y:100}],{shift:true,tolerance:8});near(found.point.x,200);near(found.point.y,170);assert.equal(found.guides.length,1);
 const node={id:'existing',x:200,y:100};assert.deepEqual(snapConstructionPoint({x:200,y:100},undefined,[node],{shift:true,tolerance:8}).point,{x:200,y:100});
 const none=snapConstructionPoint({x:198,y:170},undefined,[{x:200,y:100}],{shift:true,referencesEnabled:false,tolerance:8});assert.deepEqual(none.point,{x:198,y:170});
});
test('reference points exclude hidden objects, moving vertices and external notes without modifying layout data',()=>{
 const r=room(),a={id:crypto.randomUUID(),kind:'rect' as const,x:1000,y:1000,width:1000,height:600,rotation:0,name:'受付',text:'外側の長い注記'.repeat(30),fontSize:140};r.annotations=[a];const before=structuredClone(r),points=constructionReferencePoints(r,[],'floor',[],[r.vertices[0].id!]);assert(!points.some(p=>p.x===0&&p.y===0));assert(points.some(p=>p.x===1500&&p.y===1300));assert.deepEqual(r,before);
 const onlyRoom=constructionReferencePoints(r,[],'floor',[`annotation:${a.id}`]);assert.equal(onlyRoom.length,4);r.editor={order:[],hidden:[`annotation:${a.id}`],locked:[],groups:[]};assert.equal(constructionReferencePoints(r,[],'floor').length,4);
});
test('wall length changes hold the selected endpoint on straight and curved walls and preserve the source',()=>{
 for(const curved of [false,true])for(const fixed of ['a','b'] as const){const r=room();if(curved){r.vertices[0].out={x:1800,y:-900};r.vertices[1].in={x:-1800,y:-900};}const original=structuredClone(r),wall=roomWalls(r)[0],result=scaleRoomWall(r,0,wall.length+500,fixed),changed=roomWalls(result)[0];near(changed.segment[fixed].x,wall.segment[fixed].x);near(changed.segment[fixed].y,wall.segment[fixed].y);assert(Math.abs(changed.length-wall.length-500)<.05);assert.equal(changed.id,wall.id);assert.deepEqual(r,original);}
});
