import {roomFloorBounds} from '../src/lib/exhibitionSurface.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {annotationWorldPoint,annotationLocalPoint,annotationWorldBounds} from '../src/lib/exhibitionAnnotationPath.ts';
import {reflectLayoutAnnotations} from '../src/lib/exhibitionReflection.ts';
import {openingPath,setDoorOpening} from '../src/lib/exhibitionOpeningPath.ts';
import {openingFloorSvg,annotationSvg} from '../src/lib/exhibitionRoomSymbols.ts';
import {layoutScene} from '../src/lib/exhibitionLayoutScene.ts';
import {layoutObjects,selectionBounds} from '../src/lib/exhibitionLayoutModel.ts';
import {layoutFrame,framePoint,cornerFactors,resizeLayoutFromCorner} from '../src/lib/exhibitionTransforms.ts';
import {parseRooms} from '../src/lib/exhibitionValidation.ts';
import {reusableRoom} from '../src/lib/exhibitionRoomReuse.ts';
import type {RoomLayout,RoomAnnotation} from '../src/lib/exhibitionTypes.ts';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function fixture():RoomLayout{return{id:crypto.randomUUID(),name:'反転の確認',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[{id:crypto.randomUUID(),kind:'door',wall:0,offset:1200,width:900,height:2100,bottom:0,swingAngle:60}],placements:[],books:[],tables:[],annotations:[{id:crypto.randomUUID(),kind:'path',x:1200,y:1000,width:600,height:400,rotation:37,text:'',fontSize:32,strokeWidth:8,path:{closed:true,nodes:[{id:crypto.randomUUID(),x:-80,y:-20,out:{x:100,y:-60}},{id:crypto.randomUUID(),x:520,y:40,in:{x:-50,y:70}},{id:crypto.randomUUID(),x:120,y:380}]}}]};}
test('door presets distinguish both hinges and room sides for either polygon winding without changing dimensions',()=>{
 for(const reverse of [false,true])for(const hinge of ['start','end'] as const)for(const side of ['inward','outward'] as const){const room=fixture();if(reverse)room.vertices.reverse();const door=room.openings[0],before={...door};door.visualPath=openingPath(room,door);setDoorOpening(door,hinge,side);assert.equal(door.visualPath,undefined);const p=openingPath(room,door),sign=(reverse?-1:1)*(side==='outward'?-1:1);close(p.nodes[0].x,hinge==='end'?900:0);close(p.nodes[2].x,450);close(p.nodes[2].y,sign*900*Math.sqrt(3)/2);for(const key of ['id','offset','width','height','bottom','swingAngle'] as const)assert.equal(door[key],before[key]);assert.match(openingFloorSvg(room,door),/A900 900/);assert.equal(parseRooms([room])[0].openings[0].hingeSide,hinge);assert.equal(parseRooms([room])[0].openings[0].swingSide,side);}
 const room=fixture();setDoorOpening(room.openings[0],'end','outward');assert.equal(reusableRoom(room).openings[0].swingSide,'outward');assert.match(layoutScene(room,[],'wall:0').svg,/circle cx="1335"/);
});
test('rotated curves reflect every world point about the selection centre and two reflections restore the original geometry',()=>{
 for(const axis of ['x','y'] as const){const room=fixture(),a=room.annotations![0],original=structuredClone(a),before=annotationWorldBounds(a),centre={x:before.x+before.width/2,y:before.y+before.height/2},points=a.path!.nodes.map(n=>annotationWorldPoint(a,n));reflectLayoutAnnotations(room,[],'floor',[`annotation:${a.id}`],axis);a.path!.nodes.forEach((n,i)=>{const p=annotationWorldPoint(a,n);close(p.x,axis==='x'?2*centre.x-points[i].x:points[i].x);close(p.y,axis==='y'?2*centre.y-points[i].y:points[i].y);const q=annotationLocalPoint(a,p);close(q.x,n.x);close(q.y,n.y);});assert.deepEqual(a.path,original.path);const after=annotationWorldBounds(a);close(after.x,before.x);close(after.y,before.y);close(after.width,before.width);close(after.height,before.height);reflectLayoutAnnotations(room,[],'floor',[`annotation:${a.id}`],axis);close(a.x,original.x);close(a.y,original.y);assert.equal(a.rotation,original.rotation);assert.equal(a.flipX,undefined);assert.equal(a.flipY,undefined);}
});
test('multiple text and image objects reflect as a group, persist, export and retain editable text/image content',()=>{
 const room=fixture(),base=room.annotations![0];room.annotations!.push({...structuredClone(base),id:crypto.randomUUID(),kind:'text',path:undefined,x:3000,text:'左右反転',runs:[{text:'左右反転',bold:true}],rotation:-20}, {...structuredClone(base),id:crypto.randomUUID(),kind:'image',path:undefined,x:4200,assetId:crypto.randomUUID(),rotation:15});
 const before=structuredClone(room.annotations!),ids=before.map(a=>`annotation:${a.id}`),b=selectionBounds(layoutObjects(room,[]).filter(o=>ids.includes(o.id))),cx=b.x+b.width/2;
 reflectLayoutAnnotations(room,[],'floor',ids,'x');room.annotations!.forEach((a,i)=>{const p=annotationWorldPoint(a,{x:40,y:70}),q=annotationWorldPoint(before[i],{x:40,y:70});close(p.x,2*cx-q.x);close(p.y,q.y);assert.equal(a.width,before[i].width);assert.equal(a.height,before[i].height);});
 const saved=parseRooms([room])[0];assert.ok(saved.annotations!.every(a=>a.flipX));assert.deepEqual(saved.annotations![1].runs,before[1].runs);assert.equal(saved.annotations![2].assetId,before[2].assetId);
 assert.match(annotationSvg(saved.annotations![1]),/scale\(-1 1\)/);assert.match(annotationSvg(saved.annotations![2],1,false,undefined,'data:image/png;base64,fixture'),/scale\(-1 1\)/);assert.equal(reusableRoom(saved).annotations![0].flipX,true);
});
test('all four resize handles keep the opposite corner fixed for reflected curves and text',()=>{
 for(const kind of ['path','text'] as const)for(const axis of ['x','y'] as const)for(const corner of ['nw','ne','se','sw'] as const){const room=fixture(),a=room.annotations![0];if(kind==='text'){a.kind='text';delete a.path;a.text='展示室';}const id=`annotation:${a.id}`;reflectLayoutAnnotations(room,[],'floor',[id],axis);const o=layoutObjects(room,[]).find(o=>o.id===id)!,before=layoutFrame(room,'floor',o),k=cornerFactors[corner],fixed=framePoint(before,(1-k.x)*before.width,(1-k.y)*before.height);resizeLayoutFromCorner(room,[],'floor',id,corner,120,80);const after=layoutFrame(room,'floor',o),actual=framePoint(after,(1-k.x)*after.width,(1-k.y)*after.height);close(actual.x,fixed.x);close(actual.y,fixed.y);}
});
test('invalid reflection settings and protected selections cannot change saved artwork',()=>{
 const room=fixture();for(const flag of ['flipX','flipY']){const bad=structuredClone(room);(bad.annotations![0] as any)[flag]='false';assert.throws(()=>parseRooms([bad]),/反転/);}for(const field of ['hingeSide','swingSide']){const bad=structuredClone(room);(bad.openings[0] as any)[field]='invalid';assert.throws(()=>parseRooms([bad]),/ドア/);}
 room.editor={order:[],groups:[],hidden:[],locked:[`annotation:${room.annotations![0].id}`]};const before=structuredClone(room);assert.throws(()=>reflectLayoutAnnotations(room,[],'floor',room.editor!.locked,'x'),/選択/);assert.deepEqual(room,before);assert.throws(()=>reflectLayoutAnnotations(room,[],'floor',[`opening:${room.openings[0].id}`],'x'),/選択/);
});

test('fit includes outward door leaves without changing the physical room size',()=>{const room=fixture();setDoorOpening(room.openings[0],'end','outward');const b=roomFloorBounds(room);assert.ok(b.y<-700);assert.equal(b.x,0);assert.equal(b.width,6000);close(b.y+b.height,4000);assert.deepEqual(room.vertices.map(p=>[p.x,p.y]),[[0,0],[6000,0],[6000,4000],[0,4000]]);});
