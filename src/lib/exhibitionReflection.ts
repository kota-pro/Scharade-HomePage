import {layoutObjects,selectionBounds,objectLocked} from './exhibitionLayoutModel.ts';
import type {RoomLayout,LayoutWork} from './exhibitionTypes.ts';

/** Reflect the actual artwork about the selection centre in drawing coordinates. */
export function reflectLayoutAnnotations(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],axis:'x'|'y') {
  const objects=layoutObjects(room,works,view).filter(o=>ids.includes(o.id));
  if(!objects.length||objects.length!==new Set(ids).size||objects.some(o=>o.kind!=='annotation'||objectLocked(room,o.id)))throw new Error('反転する図形・文字・画像を選択してください。');
  const b=selectionBounds(objects),centre={x:b.x+b.width/2,y:b.y+b.height/2};
  const positions=objects.map(o=>({o,x:axis==='x'?2*centre.x-o.source.x:o.source.x,y:axis==='y'?2*centre.y-o.source.y:o.source.y}));
  if(positions.some(p=>![p.x,p.y].every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)))throw new Error('反転後の配置座標を±100000mm以内にしてください。');
  for(const {o,x,y} of positions){const a=o.source,key=axis==='x'?'flipX':'flipY';a.x=x;a.y=y;a.rotation=-(a.rotation??0);if(a[key])delete a[key];else a[key]=true;}
}
