import test from 'node:test';import assert from 'node:assert/strict';
import sharp from 'sharp';import {Resvg} from '@resvg/resvg-js';
import type {RoomAnnotation} from '../src/lib/exhibitionTypes.ts';
import {hatchPaint,hatchable,shapeNoteLayout,shapeNoteBox} from '../src/lib/exhibitionShapeAppearance.ts';
import {annotationSvg} from '../src/lib/exhibitionRoomSymbols.ts';
import {annotationIntrinsicBounds} from '../src/lib/exhibitionAnnotationPath.ts';
import {outlineSvgText} from '../src/lib/exhibitionSvgText.ts';
import {parseLayoutAnnotation,parseRooms} from '../src/lib/exhibitionValidation.ts';
import {roomFromPenPath,validRoomPath} from '../src/lib/exhibitionRoomPath.ts';
import {diffLayoutRooms,applyLayoutChanges,invertLayoutChanges} from '../src/lib/exhibitionLayoutChanges.ts';
const id=()=>crypto.randomUUID();
const annotation=(patch:Partial<RoomAnnotation>={}):RoomAnnotation=>({id:id(),kind:'rect',x:0,y:0,width:800,height:500,rotation:0,text:'',fontSize:100,color:'#343434',...patch});
test('closed primitives and paths use deterministic, sparse hand-sketched hatch strokes with independent style IDs',()=>{
  for(const kind of ['rect','ellipse','power','door','window'] as const){const a=annotation({kind,fill:'#247fbd'}),paint=hatchPaint(a),svg=annotationSvg(a);assert(hatchable(a));assert.match(paint.defs,/<pattern/);assert.match(svg,/data-layout-hatch/);assert.match(paint.defs,/Q/);assert.doesNotMatch(svg,/<(?:rect|ellipse|path)[^>]*fill="#247fbd"/);assert.equal(hatchPaint(a).fill,paint.fill);assert.notEqual(hatchPaint({...a,fill:'#e87471'}).fill,paint.fill);}
  assert.equal(hatchPaint(annotation()).fill,'none');assert.equal(hatchPaint(annotation({kind:'image',fill:'#247fbd'})).fill,'none');
  assert.equal(hatchable(annotation({kind:'path',path:{closed:false,nodes:[{x:0,y:0},{x:400,y:300}]}})),false);
});
test('hatch rendering leaves most of the interior white and survives outlined vector export',async()=>{
  const a=annotation({x:20,y:20,fill:'#247fbd',name:'案内',text:'図形の外側の注記'}),raw=`<svg xmlns="http://www.w3.org/2000/svg" width="840" height="540" viewBox="0 0 840 540"><rect width="840" height="540" fill="white"/>${annotationSvg(a)}</svg>`;
  const outlined=outlineSvgText(raw);assert.doesNotMatch(outlined,/<text\b/);assert.match(outlined,/<pattern/);assert.match(outlined,/clip-path="url\(#name-/);
  const png=new Resvg(outlined).render().asPng(),pixels=await sharp(png).extract({left:30,top:30,width:780,height:480}).removeAlpha().raw().toBuffer();let colored=0,white=0,dark=0;
  for(let i=0;i<pixels.length;i+=3){if(pixels[i]<120&&pixels[i+1]<120&&pixels[i+2]<120)dark++;if(pixels[i+2]>pixels[i]+15)colored++;if(pixels[i]>245&&pixels[i+1]>245&&pixels[i+2]>245)white++;}
  const area=pixels.length/3;assert(colored/area>.02&&colored/area<.4);assert(white/area>.5);assert(dark>100,'outlined internal name must remain visible in the raster export');
});
test('notes wrap and shrink inside rectangles, ellipses and concave paths without enlarging the figure selection',()=>{
  const path={closed:true,nodes:[{x:0,y:0},{x:600,y:0},{x:600,y:150},{x:150,y:150},{x:150,y:600},{x:0,y:600}]};
  for(const a of [annotation(),annotation({kind:'ellipse'}),annotation({kind:'path',path,width:600,height:600})]){
    a.text='受付のご案内です。こちらでお待ちください。\n写真展へのご来場ありがとうございます。';const original=annotationIntrinsicBounds({...a,text:''}),layout=shapeNoteLayout(a);
    assert.deepEqual(annotationIntrinsicBounds(a),original);assert(layout.lines.length>1);assert(layout.size<=a.fontSize);assert(layout.top>=layout.box.y);assert(layout.top+layout.lines.length*layout.lineHeight<=layout.box.y+layout.box.height+.001);assert.match(annotationSvg({...a,name:a.text}),/data-layout-shape-name/);
    if(a.path){const b=shapeNoteBox(a);assert(b.x+b.width<=150.01||b.y+b.height<=150.01);}
  }
  const narrow=shapeNoteLayout(annotation({width:20,height:200,fontSize:60,text:'W'}));assert(narrow.size<60);
});
test('note clipping, style persistence and existing rich text survive reflection and scale',()=>{
  const a=annotation({text:'入口 <東>\n案内',fill:'#739cba',rotation:35,flipX:true});assert.equal(parseLayoutAnnotation(a).fill,a.fill);assert.match(annotationSvg(a,2,true),/scale\(2 -2\)/);assert.match(annotationSvg(a),/入口 &lt;東&gt;/);
  const text=annotation({kind:'text',text:'文字',runs:[{text:'文字',bold:true}],fill:'#739cba'});assert.match(annotationSvg(text),/font-weight="700"/);assert.doesNotMatch(annotationSvg(text),/data-layout-hatch/);
});
test('an empty canvas pen creates independent closed rooms, rejecting incomplete, crossing and out-of-range outlines',()=>{
  const nodes=[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],room=roomFromPenPath(nodes);assert(validRoomPath(room));assert.equal(parseRooms([room])[0].vertices.length,4);assert(nodes.every(n=>!('id'in n)));assert.notEqual(roomFromPenPath(nodes).id,room.id);
  assert.throws(()=>roomFromPenPath(nodes.slice(0,2)),/3〜32/);assert.throws(()=>roomFromPenPath([nodes[0],nodes[2],nodes[1],nodes[3]]),/交差/);assert.throws(()=>roomFromPenPath([{x:-100001,y:0},...nodes.slice(1)]),/100000/);
});
test('removing all venue rooms is one reversible layout operation and leaves the submitted work records unchanged',()=>{
  const room=roomFromPenPath([{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);room.annotations=[annotation({fill:'#739cba',text:'案内'})];const second={...structuredClone(room),id:id(),name:'第二展示室'};const source=[room,second],changes=diffLayoutRooms(source,[]);
  assert.equal(changes.length,2);assert(changes.every(c=>c.collection==='room'&&c.after===null));assert.deepEqual(applyLayoutChanges(source,changes),[]);assert.deepEqual(applyLayoutChanges([],invertLayoutChanges(changes)),source);
});
