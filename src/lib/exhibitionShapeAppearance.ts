import type {RoomAnnotation} from './exhibitionTypes.ts';
import {compileVectorPath} from './exhibitionVector.ts';
import {annotationPath,annotationWorldPoint} from './exhibitionAnnotationPath.ts';
import {measureLayoutText} from './exhibitionRichText.ts';
type Box={x:number;y:number;width:number;height:number};
export const DEFAULT_SHAPE_STROKE_WIDTH=8;
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const color=(s:string|undefined,fallback='#343434')=>/^#[\da-f]{6}$/i.test(s??'')?s!:fallback;
const boxes=new Map<string,Box>();
type NoteLayout={box:Box;size:number;lines:string[];lineHeight:number;x:number;top:number};
const notes=new Map<string,NoteLayout>();
export function invalidateShapeTextLayout(){notes.clear();}
function hash(s:string){let value=2166136261;for(let i=0;i<s.length;i++)value=Math.imul(value^s.charCodeAt(i),16777619);return(value>>>0).toString(16);}
export const shapeBounds=(a:RoomAnnotation):Box=>a.path?compileVectorPath(a.path).bounds:{x:0,y:0,width:a.width,height:a.height};
export const hatchable=(a:RoomAnnotation)=>!['text','image'].includes(a.kind)&&(a.path?a.path.closed:!['path','freehand'].includes(a.kind));
export function shapeContour(a:RoomAnnotation){
  if(a.path)return `<path d="${compileVectorPath(a.path).svg}"/>`;
  const w=a.width,h=a.height;
  if(a.kind==='ellipse')return `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}"/>`;
  if(a.kind==='door')return `<path d="M0 0H${w}A${w} ${h} 0 0 1 0 ${h}Z"/>`;
  return `<rect width="${w}" height="${h}"${a.kind==='power'?` rx="${Math.min(w,h)*.2}"`:''}/>`;
}
/** Stable, slightly uneven pencil strokes; no opaque background or remote texture. */
export function hatchPaint(a:RoomAnnotation){
  if(!hatchable(a)||!/^#[\da-f]{6}$/i.test(a.fill??''))return{defs:'',fill:'none'};
  const b=shapeBounds(a),pitch=Math.max(12,Math.min(100,Math.min(b.width,b.height)/4)),ink=color(a.fill);
  const id=`sketch-${a.id}-${hash(JSON.stringify([a.kind,a.path,a.width,a.height,ink]))}`;
  const defs=`<defs><pattern id="${id}" width="${pitch}" height="${pitch}" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)"><path d="M0 ${-pitch*.1}Q${pitch*.045} ${pitch*.5} 0 ${pitch*1.1}M${pitch*.5} ${-pitch*.1}Q${pitch*.46} ${pitch*.5} ${pitch*.5} ${pitch*1.1}" fill="none" stroke="${ink}" stroke-width="${pitch*.035}" stroke-opacity=".57" stroke-linecap="round"/><path d="M${pitch*.06} 0Q${pitch*.02} ${pitch*.5} ${pitch*.06} ${pitch}" fill="none" stroke="${ink}" stroke-width="${pitch*.018}" stroke-opacity=".2"/></pattern></defs>`;
  return{defs,fill:`url(#${id})`};
}
function pointInside(x:number,y:number,points:{x:number;y:number}[]){let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j],cross=(x-a.x)*(b.y-a.y)-(y-a.y)*(b.x-a.x);
  if(Math.abs(cross)<.001&&x>=Math.min(a.x,b.x)-.001&&x<=Math.max(a.x,b.x)+.001&&y>=Math.min(a.y,b.y)-.001&&y<=Math.max(a.y,b.y)+.001)return true;
  if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
}return inside;}
/** Use an interior rectangle for concave paths, rather than their empty bounding-box center. */
export function shapeNoteBox(a:RoomAnnotation):Box{
  const key=JSON.stringify([a.kind,a.width,a.height,a.path]),cached=boxes.get(key);if(cached)return cached;
  const b=shapeBounds(a);let box={...b};
  if(!a.path&&a.kind==='ellipse'){box={x:b.x+b.width*.1465,y:b.y+b.height*.1465,width:b.width*.707,height:b.height*.707};}
  else if(hatchable(a)&&(a.path||a.kind==='door')){
    const points=compileVectorPath(a.path??annotationPath(a)).points,n=24,dx=b.width/n,dy=b.height/n;
    const grid=Array.from({length:n+1},(_,y)=>Array.from({length:n+1},(_,x)=>pointInside(b.x+x*dx,b.y+y*dy,points)));
    const heights=Array(n).fill(0);let best=0;
    for(let y=0;y<n;y++){for(let x=0;x<n;x++)heights[x]=grid[y][x]&&grid[y+1][x]&&grid[y][x+1]&&grid[y+1][x+1]?heights[x]+1:0;
      const stack:number[]=[];for(let x=0;x<=n;x++){while(stack.length&&(x===n||heights[stack.at(-1)!]>heights[x])){const at=stack.pop()!,height=heights[at],left=stack.length?stack.at(-1)!+1:0,width=x-left;if(width*height>best){best=width*height;box={x:b.x+left*dx,y:b.y+(y+1-height)*dy,width:width*dx,height:height*dy};}}stack.push(x);}
    }
  }
  boxes.set(key,box);if(boxes.size>128)boxes.delete(boxes.keys().next().value!);return box;
}
function wrap(text:string,size:number,width:number){
  const lines:string[]=[];for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){let line='';for(const character of paragraph){if(line&&measureLayoutText(line+character,size,false)>width){lines.push(line);line=character;}else line+=character;}lines.push(line);}return lines;
}
export function shapeNoteLayout(a:RoomAnnotation):NoteLayout{
  const key=JSON.stringify([a.kind,a.width,a.height,a.path,a.text,a.fontSize,measureLayoutText('漢字MWil0123',100,false)]),cached=notes.get(key);if(cached)return cached;
  const box=shapeNoteBox(a),pad=Math.min(Math.min(box.width,box.height)*.08,Math.max(2,a.fontSize*.15)),width=Math.max(.001,box.width-2*pad),height=Math.max(.001,box.height-2*pad);
  const preferred=Math.min(a.fontSize,Math.max(.001,height));let low=.0001,high=preferred;
  for(let i=0;i<18;i++){const size=(low+high)/2,lines=wrap(a.text,size,width);if(lines.length*size*1.25<=height&&lines.every(line=>measureLayoutText(line,size,false)<=width))low=size;else high=size;}
  const preferredLines=wrap(a.text,preferred,width),size=preferredLines.length*preferred*1.25<=height&&preferredLines.every(line=>measureLayoutText(line,preferred,false)<=width)?preferred:low,lines=wrap(a.text,size,width),lineHeight=size*1.25;
  const result={box,size,lines,lineHeight,x:box.x+box.width/2,top:box.y+(box.height-lines.length*lineHeight)/2};notes.set(key,result);if(notes.size>128)notes.delete(notes.keys().next().value!);return result;
}
export function shapeNameSvg(a:RoomAnnotation,flipY=false,name=a.name??''){
  if(a.showName===false||!name||a.kind==='text')return '';
  const layout=shapeNoteLayout({...a,text:name,fontSize:a.nameFontSize??a.fontSize}),sign=flipY?-1:1,b=shapeBounds(a),clip=`name-${a.id}-${hash(JSON.stringify([a.kind,a.path,a.width,a.height,flipY]))}`;
  const contour=hatchable(a)?shapeContour(a):`<rect x="${b.x}" y="${b.y}" width="${Math.max(.01,b.width)}" height="${Math.max(.01,b.height)}"/>`;
  const top=flipY?-layout.box.y-layout.box.height+(layout.box.height-layout.lines.length*layout.lineHeight)/2:layout.top;
  return `<defs><clipPath id="${clip}" clipPathUnits="userSpaceOnUse" transform="scale(1 ${sign})">${contour}</clipPath></defs><g data-layout-shape-name="" pointer-events="none" clip-path="url(#${clip})" fill="${color(a.color)}" font-family="Zen Old Mincho" text-anchor="middle">${layout.lines.map((line,i)=>{const width=measureLayoutText(line,layout.size,false),pad=layout.size*.18,y=top+i*layout.lineHeight;return `<rect data-layout-name-knockout="" x="${layout.x-width/2-pad}" y="${y-pad}" width="${width+2*pad}" height="${layout.size*1.2+2*pad}" fill="white" stroke="none"/><text x="${layout.x}" y="${y+layout.size}" text-anchor="middle" font-size="${layout.size}" fill="${color(a.color)}">${escape(line)}</text>`;}).join('')}</g>`;
}
/** Annotation text is a visual label, never part of physical dimensions or alignment. */
export function shapeExternalNoteLayout(a:RoomAnnotation,flipY=false){
  if(!a.text||a.kind==='text')return;
  const b=shapeBounds(a),size=a.noteFontSize??a.fontSize,width=Math.max(b.width,size*4),lines=wrap(a.text,size,width),lineHeight=size*1.3,gap=Math.max(10,size*.3)+(a.strokeWidth??DEFAULT_SHAPE_STROKE_WIDTH)/2;
  return {x:b.x+(b.width-width)/2,y:(flipY?-b.y:b.y+b.height)+gap,width,height:lines.length*lineHeight,lines,size,lineHeight};
}
export function shapeNoteSvg(a:RoomAnnotation,flipY=false){
  const layout=shapeExternalNoteLayout(a,flipY);if(!layout)return '';
  return `<g data-layout-shape-note="" pointer-events="none" fill="${color(a.color)}" font-family="Zen Old Mincho">${layout.lines.map((line,i)=>{const width=measureLayoutText(line,layout.size,false),y=layout.y+i*layout.lineHeight;return `<rect x="${layout.x}" y="${y}" width="${width}" height="${layout.lineHeight}" fill="white" stroke="none"/><text x="${layout.x}" y="${y+layout.size}" font-size="${layout.size}" fill="${color(a.color)}">${escape(line)}</text>`;}).join('')}</g>`;
}
export function shapeNoteWorldBounds(a:RoomAnnotation):Box|undefined{
  const box=shapeExternalNoteLayout(a);if(!box)return;
  const points=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}].map(p=>annotationWorldPoint(a,p)),xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
}
