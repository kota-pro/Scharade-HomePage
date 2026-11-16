import {annotationLocalBounds} from './exhibitionAnnotationPath.ts';
import {layoutBounds,placedPhotos} from './exhibitionGeometry.ts';
import type {LayoutObject} from './exhibitionLayoutModel.ts';
import type {LayoutWork} from './exhibitionTypes.ts';

const mm=(value:number)=>Number(value.toFixed(2));
export const layoutSizeLabel=(name:string,width:number,height:number)=>`${name}\n縦 ${mm(height)} × 横 ${mm(width)} mm`;
export const layoutWallSizeLabel=(name:string,length:number,height:number)=>`${name}\n長さ ${mm(length)} mm / 高さ ${mm(height)} mm`;

/** Physical dimensions, independent of the floor plan's markers and rotation boxes. */
export function layoutObjectSizeLabel(object:LayoutObject,works:LayoutWork[]){
 const p=object.source;
 const owner=(work:LayoutWork|undefined)=>work?[work.exhibitorName?`作者：${work.exhibitorName}`:'',work.submissionName&&work.submissionName!==work.exhibitorName?`提出者：${work.submissionName}`:''].filter(Boolean).join('\n'):'';
 const workSize=(width:number,height:number)=>[object.label,owner(works.find(w=>w.id===p.workId)),layoutSizeLabel('',width,height).slice(1)].filter(Boolean).join('\n');
 if(object.kind==='dimension')return undefined;
 if(object.kind==='work'){
  const work=works.find(w=>w.id===p.workId);if(!work)return undefined;
  const b=layoutBounds(placedPhotos(work,p,0));return workSize(b.width,b.height);
 }
 if(object.kind==='board')return layoutSizeLabel(object.label,p.panels.reduce((sum:number,panel:{width:number})=>sum+panel.width,0),Math.max(...p.panels.map((panel:{height:number})=>panel.height)));
 if(object.kind==='opening')return layoutSizeLabel(object.label,p.width,p.height);
 if(object.kind==='table')return layoutSizeLabel(object.label,p.width,p.depth)+(p.height?` / 高さ ${mm(p.height)} mm`:'');
 if(object.kind==='book')return workSize(p.width,p.depth);
 if(object.kind==='titleboard')return workSize(105,74.25);
 if(object.kind==='annotation'){const b=annotationLocalBounds(p);return layoutSizeLabel(object.label,b.width,b.height);}
 return layoutSizeLabel(object.label,object.box.width,object.box.height);
}
