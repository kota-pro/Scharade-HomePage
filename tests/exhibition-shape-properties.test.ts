import {diffLayoutRooms,applyLayoutChanges,invertLayoutChanges} from '../src/lib/exhibitionLayoutChanges.ts';
import {parseLayoutAnnotation,parseRooms} from '../src/lib/exhibitionValidation.ts';
import {shapeNameSvg} from '../src/lib/exhibitionShapeAppearance.ts';
import {reusableRoom} from '../src/lib/exhibitionRoomReuse.ts';
import {copyLayoutSelection,pasteLayoutSelection} from '../src/lib/exhibitionLayoutClipboard.ts';
import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';import {Resvg} from '@resvg/resvg-js';
import type {RoomAnnotation} from '../src/lib/exhibitionTypes.ts';
import {annotationSvg} from '../src/lib/exhibitionRoomSymbols.ts';
import {shapeExternalNoteLayout,shapeNoteWorldBounds,shapeNoteLayout,DEFAULT_SHAPE_STROKE_WIDTH} from '../src/lib/exhibitionShapeAppearance.ts';
import {annotationIntrinsicBounds,annotationWorldPoint} from '../src/lib/exhibitionAnnotationPath.ts';
import {roomFromPenPath} from '../src/lib/exhibitionRoomPath.ts';import {layoutObjects,alignLayoutObjects} from '../src/lib/exhibitionLayoutModel.ts';
import {snapShapePlacement} from '../src/lib/exhibitionShapePlacementSnap.ts';import {outlineSvgText} from '../src/lib/exhibitionSvgText.ts';import {compileVectorPath,segmentPoint} from '../src/lib/exhibitionVector.ts';import {annotationPath} from '../src/lib/exhibitionAnnotationPath.ts';
const a=(patch:Partial<RoomAnnotation>={}):RoomAnnotation=>({id:crypto.randomUUID(),kind:'rect',x:1000,y:1000,width:1000,height:600,rotation:0,name:'受付',text:'外側に表示する注記',fontSize:120,color:'#343434',fill:'#739cba',...patch});
const room=()=>roomFromPenPath([{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);
test('names use a clear knockout inside figures; annotations wrap outside without affecting physical bounds or alignment',()=>{
 const shape=a(),bounds=annotationIntrinsicBounds(shape),note=shapeExternalNoteLayout(shape)!;assert(note.y>shape.height);assert.match(annotationSvg(shape),/data-layout-name-knockout/);assert.match(annotationSvg(shape),/data-layout-shape-name/);assert.match(annotationSvg(shape),/data-layout-shape-note/);
 assert.deepEqual(annotationIntrinsicBounds({...shape,text:'非常に長い注記'.repeat(100),name:'図形の長い名前'.repeat(10)}),bounds);
 const r=room();r.annotations=[shape];alignLayoutObjects(r,[],'floor',[`annotation:${shape.id}`],'centerX',{x:0,y:0,width:6000,height:4000});assert.equal(shape.x,2500);assert.equal(shape.width,1000);
 const rotated=a({rotation:40,flipX:true}),world=shapeNoteWorldBounds(rotated)!;const point=annotationWorldPoint(rotated,{x:note.x,y:note.y});assert(point.x>=world.x-.01&&point.y>=world.y-.01);assert.equal(DEFAULT_SHAPE_STROKE_WIDTH,8);
});
test('raster exports leave the name backing free of hatch ink and retain outlined text',async()=>{
 const shape=a({x:50,y:50,width:800,height:500,fontSize:100,text:''}),raw=`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="650"><rect width="900" height="650" fill="white"/>${annotationSvg(shape)}</svg>`,outlined=outlineSvgText(raw);assert.doesNotMatch(outlined,/<text\b/);const image=new Resvg(outlined).render().asPng(),layout=shapeNoteLayout({...shape,text:shape.name!}),pad=layout.size*.18;
 const pixels=await sharp(image).extract({left:Math.ceil(shape.x+layout.x-110),top:Math.ceil(shape.y+layout.top-pad+1),width:220,height:8}).removeAlpha().raw().toBuffer();let colored=0;for(let i=0;i<pixels.length;i+=3)if(pixels[i+2]>pixels[i]+15)colored++;assert.equal(colored,0,'hatch lines must not cross the clear space around the name');
 assert.match(annotationSvg(a()),/stroke-width="8"/);assert.match(annotationSvg(a({strokeWidth:40})),/stroke-width="40"/);assert.doesNotMatch(annotationSvg(a()),/non-scaling-stroke/);
});
test('placement snaps to walls and actual reflected rotated curves without modifying saved geometry',()=>{
 const r=room(),ellipse=a({kind:'ellipse',rotation:25,flipX:true});r.annotations=[ellipse];const before=structuredClone(r),options={tolerance:10,grid:50};assert.deepEqual(snapShapePlacement(r,[],'floor',{x:3,y:500},options).point,{x:0,y:500});
 const local=segmentPoint(compileVectorPath(annotationPath(ellipse)).ordered[0].segment,.37),p=annotationWorldPoint(ellipse,local),snapped=snapShapePlacement(r,[],'floor',{x:p.x+2,y:p.y-2},options);assert(snapped.snapped);assert(Math.hypot(snapped.point.x-p.x,snapped.point.y-p.y)<4);assert.deepEqual(r,before);
 const raw={x:3,y:500};assert.deepEqual(snapShapePlacement(r,[],'floor',raw,{...options,alt:true}).point,raw);assert.deepEqual(snapShapePlacement(r,[],'floor',raw,{...options,enabled:false}).point,{x:0,y:500});
 const surface=snapShapePlacement(r,[],'wall:0',{x:2500,y:3},options);assert.deepEqual(surface.point,{x:2500,y:0});
});
test('hidden contours and external notes are excluded from snapping and selection measurements',()=>{
 const r=room(),shape=a();r.annotations=[shape];r.editor={order:[],hidden:[`annotation:${shape.id}`],locked:[],groups:[]};const options={tolerance:8};assert.equal(snapShapePlacement(r,[],'floor',{x:1500,y:1002},options).snapped,false);r.editor.hidden=[];
 const note=shapeExternalNoteLayout(shape)!,p={x:shape.x+note.x+50,y:shape.y+note.y+note.height};assert.equal(snapShapePlacement(r,[],'floor',p,options).snapped,false);const o=layoutObjects(r,[],'floor')[0];assert.equal(o.box.width,1000);assert.equal(o.box.height,600);
});

test('name and note sizes persist independently, preserve legacy defaults and survive copy and venue reuse',()=>{
 const old=a(),legacy=parseLayoutAnnotation(old);assert.equal(legacy.nameFontSize,undefined);assert.equal(legacy.noteFontSize,undefined);assert.equal(shapeExternalNoteLayout(legacy)!.size,old.fontSize);
 const custom=parseLayoutAnnotation({...old,nameFontSize:60,noteFontSize:180}),nameSvg=shapeNameSvg(custom);assert.match(nameSvg,/font-size="60"/);assert.equal(shapeExternalNoteLayout(custom)!.size,180);assert.equal(shapeNameSvg({...custom,noteFontSize:260}),nameSvg);assert.equal(shapeExternalNoteLayout({...custom,nameFontSize:300})!.size,180);assert.deepEqual(annotationIntrinsicBounds(custom),annotationIntrinsicBounds(old));
 const r=room();r.annotations=[custom];const copied=pasteLayoutSelection(r,'floor',copyLayoutSelection(r,[],'floor',layoutObjects(r,[],'floor'))!).room;assert.equal(parseRooms([copied])[0].annotations![1].nameFontSize,60);assert.equal(parseRooms([reusableRoom(r)])[0].annotations![0].noteFontSize,180);
 for(const key of ['nameFontSize','noteFontSize'])for(const bad of [0,-1,3001,NaN,Infinity,'120'])assert.throws(()=>parseLayoutAnnotation({...old,[key]:bad}));
});


test('shape names default to visible and can be hidden without removing their notes, hatching or physical geometry',()=>{
 const shape=a(),original=structuredClone(shape),visible=annotationSvg(shape),hidden={...shape,showName:false};
 assert.match(visible,/data-layout-shape-name/);assert.match(visible,/data-layout-name-knockout/);
 for(const flipY of [false,true]){const svg=annotationSvg(hidden,1,flipY);assert.doesNotMatch(svg,/data-layout-shape-name|data-layout-name-knockout/);assert.match(svg,/data-layout-shape-note/);assert.match(svg,/data-layout-hatch/);assert.doesNotMatch(outlineSvgText(`<svg xmlns="http:\/\/www.w3.org/2000/svg">${svg}</svg>`),/data-layout-shape-name/);}
 assert.deepEqual(annotationIntrinsicBounds(hidden),annotationIntrinsicBounds(shape));assert.equal(annotationSvg({...hidden,showName:true}),visible);assert.deepEqual(shape,original);
 const fallback=a({name:undefined,text:''});assert.match(annotationSvg(fallback),/四角形/);assert.doesNotMatch(annotationSvg({...fallback,showName:false}),/data-layout-shape-name/);
});
test('name visibility survives validation, copying, venue reuse and undo while legacy data keeps its default',()=>{
 const legacy=a();assert.equal(parseLayoutAnnotation(legacy).showName,undefined);const r=room();r.annotations=[parseLayoutAnnotation({...legacy,showName:false})];assert.equal(r.annotations[0].name,'受付');
 assert.equal(parseRooms([r])[0].annotations![0].showName,false);
 const copied=pasteLayoutSelection(r,'floor',copyLayoutSelection(r,[],'floor',layoutObjects(r,[],'floor'))!).room;assert.equal(parseRooms([copied])[0].annotations![1].showName,false);assert.equal(parseRooms([reusableRoom(r)])[0].annotations![0].showName,false);
 const before=structuredClone(r);delete before.annotations![0].showName;const changes=diffLayoutRooms([before],[r]);assert.equal(changes.length,1);assert.equal(changes[0].collection,'annotations');assert.equal(applyLayoutChanges([before],changes)[0].annotations![0].showName,false);assert.deepEqual(applyLayoutChanges([r],invertLayoutChanges(changes)),[before]);
 for(const bad of ['false',0,1,null,{},[]])assert.throws(()=>parseLayoutAnnotation({...legacy,showName:bad}),/名前の表示設定/);
});
