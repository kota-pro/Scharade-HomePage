import {wallSurface} from "./exhibitionWallSurfaces.ts";
import {boardChain,boardSurface} from './exhibitionBoards.ts';
import {placedPhotos,rotatedCorners} from './exhibitionGeometry.ts';
import {annotationLocalBounds} from './exhibitionAnnotationPath.ts';
import {titleBoardPhoto} from './exhibitionTitleBoardLayout.ts';
import type {RoomLayout,LayoutWork,VectorPoint} from './exhibitionTypes.ts';
export type MeasurementPolygon={key:string;points:VectorPoint[]};
type ObjectShape={id:string;kind:string;source:any;box:{x:number;y:number;width:number;height:number}};
const rectangle=(x:number,y:number,w:number,h:number,rotation=0)=>rotatedCorners(w,h,rotation).map(p=>({x:x+p.x,y:y+p.y}));
export function objectMeasurementPolygons(room:RoomLayout,works:LayoutWork[],view:string,o:ObjectShape):MeasurementPolygon[]{
  const p=o.source,height=view==='floor'?0:view.startsWith('wall:')?wallSurface(room,view)?.height??0:boardSurface(room.boardGroups?.find(g=>g.id===view.split(':')[1])??{panels:[{height:1,width:1}]} as any,'A').height;
  if(o.kind==='work'&&view!=='floor'){const work=works.find(w=>w.id===p.workId);return work?placedPhotos(work,p,height).map((photo,i)=>({key:`photo:${i}`,points:rectangle(photo.x,photo.y,photo.width,photo.height,photo.rotation)})):[];}
  if(o.kind==='board'&&view==='floor')return boardChain(p).map(v=>({key:`panel:${v.panel.id}`,points:v.polygon}));
  if(o.kind==='titleboard'){const q=titleBoardPhoto(p,height);return[{key:'frame',points:rectangle(q.x,q.y,q.width,q.height,q.rotation)}];}
  if(o.kind==='table'&&view==='floor')return[{key:'frame',points:rectangle(p.x,p.y,p.width,p.depth,p.rotation)}];
  if(o.kind==='annotation'){const b=annotationLocalBounds(p),a=p.rotation*Math.PI/180,x=p.x+b.x*Math.cos(a)-b.y*Math.sin(a),y=p.y+b.x*Math.sin(a)+b.y*Math.cos(a);return[{key:'frame',points:rectangle(x,y,b.width,b.height,p.rotation)}];}
  if(o.kind==='book'){const t=room.tables.find(t=>t.id===p.tableId)!;const a=t.rotation*Math.PI/180;return[{key:'frame',points:rectangle(p.x,p.y,p.width,p.depth,p.rotation).map(v=>({x:t.x+v.x*Math.cos(a)-v.y*Math.sin(a),y:t.y+v.x*Math.sin(a)+v.y*Math.cos(a)}))}];}
  return[{key:'frame',points:rectangle(o.box.x,o.box.y,o.box.width,o.box.height)}];
}
export function polygonMeasurementPoint(polygons:MeasurementPolygon[]|undefined,feature:{key:string;edge:number;ratio:number}){
  const points=polygons?.find(p=>p.key===feature.key)?.points,a=points?.[feature.edge],b=points?.[(feature.edge+1)%points.length];return a&&b?{x:a.x+(b.x-a.x)*feature.ratio,y:a.y+(b.y-a.y)*feature.ratio}:undefined;
}
