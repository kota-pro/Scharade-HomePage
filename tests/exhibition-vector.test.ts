import {test} from 'node:test';import assert from 'node:assert/strict';
import {nodeSegment,segmentLength,segmentPoint,splitSegment,segmentBounds,compileVectorPath,pointAtLength,simpleClosedPath,splitPathEdge,strokePath,materializeVectorPath} from '../src/lib/exhibitionVector.ts';
import {roomWalls,roomWallPoint,ensureRoomPath,setRoomCornerRadius,validRoomPath,scaleRoomWall} from '../src/lib/exhibitionRoomPath.ts';
import {roomWallLabels} from '../src/lib/exhibitionLayoutScene.ts';
import {printLayoutStrokes} from '../src/lib/exhibitionOutputs.ts';
import {Resvg} from '@resvg/resvg-js';
import sharp from 'sharp';
import {insertRoomVertex} from '../src/lib/exhibitionEditing.ts';
import {parseRooms} from '../src/lib/exhibitionValidation.ts';
import type {RoomLayout} from '../src/lib/exhibitionTypes.ts';
const room=():RoomLayout=>({id:crypto.randomUUID(),name:'曲線',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[],placements:[],tables:[],books:[]});
test('cubic splitting preserves points and arc lengths; inverse length and exact bounds work',()=>{
 const s=nodeSegment({x:0,y:0,out:{x:0,y:1000}},{x:1000,y:0,in:{x:0,y:1000}}),len=segmentLength(s);assert.ok(Math.abs(len-2000)<.01);
 const [a,b]=splitSegment(s,.37);assert.ok(Math.abs(segmentLength(a)+segmentLength(b)-len)<.01);
 for(let t=0;t<=1;t+=.05){const p=segmentPoint(s,t),q=t<.37?segmentPoint(a,t/.37):segmentPoint(b,(t-.37)/.63);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-6);}
 assert.ok(Math.abs(pointAtLength(s,len/2).x-500)<.001);assert.equal(segmentBounds(s).height,750);
});
test('rounding a room corner creates an independent physical curved wall and keeps references stable',()=>{
 const r=room(),workId=crypto.randomUUID();r.placements=[{workId,wall:2,x:400,bottom:900,rotation:0}];ensureRoomPath(r);const id=r.placements[0].wallId;const rounded=setRoomCornerRadius(r,1,200),walls=roomWalls(rounded);assert.equal(walls.length,5);assert.ok(Math.abs(walls[4].length-Math.PI*100)<.001);assert.equal(walls[0].length,5800);assert.equal(walls[1].length,3800);assert.equal(rounded.placements[0].wallId,id);assert.ok(validRoomPath(rounded));const p=roomWallPoint(rounded,4,walls[4].length/2);assert.ok(Math.abs(p.x-(5800+200/Math.sqrt(2)))<.001);assert.throws(()=>setRoomCornerRadius(r,1,10000),/半径/);
});
test('legacy reads are non-mutating, self-crossing curves are rejected, strokes stay editable',()=>{
 const r=room(),before=JSON.stringify(r);roomWalls(r);assert.equal(JSON.stringify(r),before);const changed=scaleRoomWall(r,0,7000);assert.equal(roomWalls(changed)[0].length,7000);
 const crossing={nodes:[{x:0,y:0},{x:100,y:100},{x:100,y:0},{x:0,y:100}],closed:true};assert.equal(simpleClosedPath(crossing),false);
 const stroke=strokePath([{x:0,y:0},{x:100,y:80},{x:200,y:0},{x:300,y:50}],1);assert.equal(stroke.closed,false);assert.ok(compileVectorPath(stroke).svg.includes('C'));const split=splitPathEdge(stroke,0,.5);assert.equal(split.nodes.length,stroke.nodes.length+1);
});
test('ruler length changes keep the chosen physical endpoint fixed for rounded and curved walls',()=>{
  const rounded=setRoomCornerRadius(room(),1,200);
  for(const index of [0,1,4])for(const fixed of ['a','b'] as const){const before=roomWalls(rounded)[index],origin=fixed==='a'?before.segment.a:before.segment.b,next=scaleRoomWall(rounded,index,before.length*1.1,fixed),after=roomWalls(next).find(w=>w.id===before.id)!,endpoint=fixed==='a'?after.segment.a:after.segment.b;assert.ok(Math.hypot(origin.x-endpoint.x,origin.y-endpoint.y)<.05);assert.ok(Math.abs(after.length-before.length*1.1)<.05);}
  const curved=room();curved.vertices[0].out={x:1500,y:-1000};curved.vertices[1].in={x:-1500,y:-1000};const before=roomWalls(curved)[0],next=scaleRoomWall(curved,0,before.length*1.05,'b');assert.ok(Math.abs(roomWalls(next)[0].length-before.length*1.05)<.05);assert.ok(Math.hypot(next.vertices[1].x-6000,next.vertices[1].y)<.05);
});

test('making rounded corners explicit and splitting circular arcs preserves exact geometry and saved references',()=>{
 const r=setRoomCornerRadius(room(),1,200),original=roomWalls(r),rounded=original[4],p=segmentPoint(rounded.segment,.37);r.placements.push({workId:crypto.randomUUID(),wall:2,wallId:original[2].id,x:400,bottom:900,rotation:0});
 const path={nodes:r.vertices,closed:true},explicit=materializeVectorPath(path),a=compileVectorPath(path),b=compileVectorPath(explicit);assert.equal(b.segments.length,5);for(let i=0;i<a.segments.length;i++)for(let t=0;t<=1;t+=.1){const p=segmentPoint(a.segments[i],t),q=segmentPoint(b.segments[i],t);assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<1e-6);}
 const next=insertRoomVertex(r,4,p),walls=roomWalls(next),arc=walls.find(w=>w.id===rounded.id)!;assert.equal(next.vertices.length,6);assert.ok(Math.abs(walls.reduce((n,w)=>n+w.length,0)-original.reduce((n,w)=>n+w.length,0))<1e-6);assert.ok(Math.hypot(arc.segment.b.x-p.x,arc.segment.b.y-p.y)<.001);assert.equal(walls[next.placements[0].wall].id,original[2].id);assert.equal(next.placements[0].wallId,original[2].id);const parsed=parseRooms([next])[0];assert.deepEqual(parsed.vertices,next.vertices);
 for(const fixed of ['a','b'] as const){const result=scaleRoomWall(next,arc.index,arc.length*1.05,fixed),resized=roomWalls(result).find(w=>w.id===arc.id)!,origin=fixed==='a'?arc.segment.a:arc.segment.b,endpoint=fixed==='a'?resized.segment.a:resized.segment.b;assert.ok(Math.abs(resized.length-arc.length*1.05)<.05);assert.ok(Math.hypot(endpoint.x-origin.x,endpoint.y-origin.y)<.05);}
 r.openings.push({id:crypto.randomUUID(),kind:'window',wall:4,wallId:rounded.id,offset:20,width:100,bottom:0,height:1000});assert.throws(()=>insertRoomVertex(r,4,p),/再配置/);
});

test('exported room lines remain legible after shrinking physical millimetres onto an A4 page',async()=>{
 const source='<path d="M0 1000H6000" stroke="#000" stroke-width="4" vector-effect="non-scaling-stroke"/><path d="M0 500H6000" stroke="#000" stroke-width="20"/>',svg=`<svg xmlns="http://www.w3.org/2000/svg" width="620" height="140"><rect width="620" height="140" fill="white"/><g transform="translate(10 10) scale(.1)">${printLayoutStrokes(source,.1)}</g></svg>`,png=new Resvg(svg).render().asPng(),image=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
 const dark=(y:number)=>image.data[(y*image.info.width+300)*image.info.channels]<128;assert.ok([108,109,110,111].every(dark));assert.ok([59,60].every(dark));assert.equal(dark(57),false);assert.equal(dark(62),false);
});

test('labels for adjacent short curved walls remain distinct on exported and editing plans',()=>{
 const r=setRoomCornerRadius(room(),0,200),next=insertRoomVertex(r,4,segmentPoint(roomWalls(r)[4].segment,.5)),labels=roomWallLabels(next,15);assert.equal(labels.length,6);for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i].box,b=labels[j].box;assert.equal(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y,false);}
});
