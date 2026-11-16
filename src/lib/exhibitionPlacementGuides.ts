import {sameWallSurface} from './exhibitionWallSurfaces.ts';
import {layoutObjects,editorMetadata,objectLocked,objectHidden,translateLayoutObjects,titleBoardPlacementProblems} from './exhibitionLayoutModel.ts';
import {layoutBounds,placedPhotos,roomProblems} from './exhibitionGeometry.ts';
import {boardPlacementProblems} from './exhibitionBoards.ts';
import {roomSurfaces} from './exhibitionSurface.ts';
import {roomOutline} from './exhibitionRoomPath.ts';
import type {RoomLayout,LayoutWork} from './exhibitionTypes.ts';
export const EYE_HEIGHT_MM=1450,eyeGuideColor='#e6f0cb';
export type GuideMeasurement={id:string;kind:'gap'|'edge'|'panel-edge'|'size';axis:'x'|'y';x1:number;y1:number;x2:number;y2:number;value:number;label?:string;a?:string;b?:string;edge?:number;editable:boolean};
const boxItems=(room:RoomLayout,works:LayoutWork[],view:string)=>layoutObjects(room,works,view).filter(o=>o.kind==='work'&&!objectHidden(room,o.id));
export function surfaceMeasurements(room:RoomLayout,works:LayoutWork[],view:string,showSizes=true,panelEdges=false,panelSizes=true):GuideMeasurement[]{
 const result:GuideMeasurement[]=[],add=(v:GuideMeasurement)=>{if(!result.some(p=>p.id===v.id))result.push(v);};
 if(view==='floor'){if(showSizes){const b=roomOutline(room).bounds;result.push({id:'size:floor:x',kind:'size',axis:'x',x1:b.x,y1:b.y-100,x2:b.x+b.width,y2:b.y-100,value:b.width,editable:false},{id:'size:floor:y',kind:'size',axis:'y',x1:b.x-100,y1:b.y,x2:b.x-100,y2:b.y+b.height,value:b.height,editable:false});}return result;}
 const surface=roomSurfaces(room).find(s=>s.key===view);if(!surface)return result;const items=boxItems(room,works,view);
 for(const a of items){const right=items.filter(b=>b!==a&&b.box.x>=a.box.x+a.box.width-.01&&Math.min(a.box.y+a.box.height,b.box.y+b.box.height)>Math.max(a.box.y,b.box.y)).sort((a,b)=>a.box.x-b.box.x)[0];if(right){const y=(Math.max(a.box.y,right.box.y)+Math.min(a.box.y+a.box.height,right.box.y+right.box.height))/2;add({id:`gap:x:${a.source.workId}:${right.source.workId}`,kind:'gap',axis:'x',a:a.source.workId,b:right.source.workId,x1:a.box.x+a.box.width,y1:y,x2:right.box.x,y2:y,value:right.box.x-a.box.x-a.box.width,editable:true});}
  const below=items.filter(b=>b!==a&&b.box.y>=a.box.y+a.box.height-.01&&Math.min(a.box.x+a.box.width,b.box.x+b.box.width)>Math.max(a.box.x,b.box.x)).sort((a,b)=>a.box.y-b.box.y)[0];if(below){const x=(Math.max(a.box.x,below.box.x)+Math.min(a.box.x+a.box.width,below.box.x+below.box.width))/2;add({id:`gap:y:${a.source.workId}:${below.source.workId}`,kind:'gap',axis:'y',a:a.source.workId,b:below.source.workId,x1:x,y1:a.box.y+a.box.height,x2:x,y2:below.box.y,value:below.box.y-a.box.y-a.box.height,editable:true});}}
 const ends=(row:ReturnType<typeof boxItems>,left:number,right:number,prefix:string,kind:'edge'|'panel-edge')=>{
  const overlapsY=(a:typeof row[number],b:typeof row[number])=>Math.min(a.box.y+a.box.height,b.box.y+b.box.height)>Math.max(a.box.y,b.box.y)+.01;
  for(const a of row){
   if(!row.some(b=>b!==a&&overlapsY(a,b)&&b.box.x+b.box.width<=a.box.x+.01))add({id:`edge:${prefix}:left:${a.source.workId}`,kind,axis:'x',b:a.source.workId,edge:left,x1:left,y1:a.box.y+a.box.height/2,x2:a.box.x,y2:a.box.y+a.box.height/2,value:a.box.x-left,label:'左端まで ',editable:true});
   if(!row.some(b=>b!==a&&overlapsY(a,b)&&b.box.x>=a.box.x+a.box.width-.01))add({id:`edge:${prefix}:right:${a.source.workId}`,kind,axis:'x',a:a.source.workId,edge:right,x1:a.box.x+a.box.width,y1:a.box.y+a.box.height/2,x2:right,y2:a.box.y+a.box.height/2,value:right-a.box.x-a.box.width,label:'右端まで ',editable:true});
  }
 };
 ends(items,0,surface.width,'surface','edge');
 if(panelEdges&&surface.panels)for(const p of surface.panels)ends(items.filter(o=>o.box.x+o.box.width/2>=p.left-.01&&o.box.x+o.box.width/2<=p.right+.01),p.left,p.right,p.panel.id,'panel-edge');
 if(showSizes){
  result.push({id:'size:surface:x',kind:'size',axis:'x',x1:0,y1:-100,x2:surface.width,y2:-100,value:surface.width,editable:false});
  const panels=panelSizes?surface.panels:undefined,first=panels?.[0];
  result.push({id:'size:surface:y',kind:'size',axis:'y',x1:-100,y1:first?.top??0,x2:-100,y2:surface.height,value:first?.panel.height??surface.height,editable:false});
  for(const [i,p] of (panels??[]).entries()){
   result.push({id:`size:${p.panel.id}:x`,kind:'size',axis:'x',x1:p.left,y1:p.top-200,x2:p.right,y2:p.top-200,value:p.panel.width,editable:false});
   const previous=panels![i-1];
   if(previous&&Math.abs(previous.top-p.top)>.01)result.push({id:`size:${p.panel.id}:height-difference`,kind:'size',axis:'y',x1:p.left-100,y1:Math.min(previous.top,p.top),x2:p.left-100,y2:Math.max(previous.top,p.top),value:Math.abs(previous.panel.height-p.panel.height),label:'高さ差 ',editable:false});
  }
 }
 return result;
}
export function linkedWorkObjects(room:RoomLayout,workId:string){const ref=`work:${workId}`,group=editorMetadata(room).groups.find(g=>g.objectIds.includes(ref));if(group&&group.objectIds.filter(id=>id.startsWith('work:')).length>1)throw new Error('複数作品のグループを解除してから、作品ごとの配置を調整してください。');return group?.objectIds??[ref];}
function safeCandidate(before:RoomLayout,next:RoomLayout,works:LayoutWork[]){const issues=(r:RoomLayout)=>[...roomProblems(r,works),...boardPlacementProblems(r,works),...titleBoardPlacementProblems(r,works)],old=new Set(issues(before)),added=issues(next).filter(p=>!old.has(p));if(added.length)throw new Error(added.join('\n'));return next;}
function moveWork(room:RoomLayout,works:LayoutWork[],view:string,id:string,dx:number,dy:number){const ids=linkedWorkObjects(room,id);if(ids.some(id=>objectLocked(room,id)))throw new Error('配置を調整する作品やタイトルボードのロックを解除してください。');translateLayoutObjects(room,works,view,ids,dx,dy);}
type Interval={left:number;right:number};
function usableIntervals(left:number,right:number,blocked:Interval[]):Interval[]{
 const ranges=blocked.map(b=>({left:Math.max(left,b.left),right:Math.min(right,b.right)})).filter(b=>b.right>b.left+.01).sort((a,b)=>a.left-b.left),free:Interval[]=[];
 let cursor=left;
 for(const b of ranges){if(b.left>cursor+.01)free.push({left:cursor,right:b.left});cursor=Math.max(cursor,b.right);}
 if(cursor<right-.01)free.push({left:cursor,right});return free;
}
/** Partition the existing work order between usable stretches, equalizing each stretch including its ends. */
function equalIntervalPositions(widths:number[],free:Interval[]){
 const n=widths.length,prefix=[0];for(const width of widths)prefix.push(prefix.at(-1)!+width);
 const target=(free.reduce((sum,r)=>sum+r.right-r.left,0)-prefix[n])/(n+free.length);
 if(target<-.01||!free.length)throw new Error('扉・窓・柱などを避けると作品が収まりません。作品数・サイズや配置面を調整してください。');
 let costs=new Array<number>(n+1).fill(Infinity);costs[0]=0;
 const parents:number[][]=[];
 for(const range of free){const next=new Array<number>(n+1).fill(Infinity),parent=new Array<number>(n+1).fill(-1),length=range.right-range.left;
  for(let start=0;start<=n;start++)if(Number.isFinite(costs[start]))for(let end=start;end<=n;end++){
   const count=end-start,used=prefix[end]-prefix[start];if(used>length+.01)break;
   const gap=Math.max(0,(length-used)/(count+1)),cost=costs[start]+(count?(count+1)*(gap-target)**2:length**2);
   if(cost<next[end]){next[end]=cost;parent[end]=start;}
  }
  costs=next;parents.push(parent);
 }
 if(!Number.isFinite(costs[n]))throw new Error('扉・窓・柱などの間に作品が収まりません。作品サイズや配置面を調整してください。');
 const positions=new Array<number>(n);let end=n;
 for(let i=free.length-1;i>=0;i--){const start=parents[i][end],range=free[i],gap=Math.max(0,(range.right-range.left-prefix[end]+prefix[start])/(end-start+1));let x=range.left+gap;
  for(let j=start;j<end;j++){positions[j]=x;x+=widths[j]+gap;}end=start;
 }
 return positions;
}
export function equalizeSurfaceWorks(room:RoomLayout,works:LayoutWork[],view:string){
 const next=structuredClone(room),surface=roomSurfaces(next).find(s=>sameWallSurface(next,s.key,view));if(!surface)throw new Error('壁またはパネル面を選択してください。');
 const items=boxItems(next,works,view),all=layoutObjects(next,works,view),regions=surface.panels??[{left:0,right:surface.width,panel:{name:surface.label}}];if(!items.length)throw new Error('この面に作品を配置してください。');
 const movingIds=new Set(items.flatMap(o=>linkedWorkObjects(next,o.source.workId)));
 const structures=all.filter(o=>!movingIds.has(o.id)&&(['opening','table','board','titleboard'].includes(o.kind)||o.kind==='annotation'&&!['text','power','freehand'].includes(o.source.kind)));
 const floorColumns=surface.walls?layoutObjects(next,works,'floor').filter(o=>o.kind==='annotation'&&/柱|pillar|column/i.test(o.source.name??'')).flatMap(o=>surface.walls!.flatMap(part=>{
  const a=part.wall.segment.a,b=part.wall.segment.b,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!length)return[];
  const corners=[{x:o.box.x,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y+o.box.height},{x:o.box.x,y:o.box.y+o.box.height}];
  const normal=corners.map(p=>((p.x-a.x)*-dy+(p.y-a.y)*dx)/length);if(Math.min(...normal)>8||Math.max(...normal)<-8)return[];
  const along=corners.map(p=>((p.x-a.x)*dx+(p.y-a.y)*dy)/length);return[{left:part.left+Math.max(0,Math.min(...along)),right:part.left+Math.min(part.wall.length,Math.max(...along))}];
 })):[];
 for(const region of regions){
  const row=items.filter(o=>o.box.x+o.box.width/2>=region.left-.01&&o.box.x+o.box.width/2<=region.right+.01).sort((a,b)=>a.box.x-b.box.x||a.id.localeCompare(b.id));if(!row.length)continue;
  const footprints=row.map(o=>{const ids=linkedWorkObjects(next,o.source.workId),boxes=all.filter(a=>ids.includes(a.id)).map(a=>a.box);const left=Math.min(...boxes.map(b=>b.x)),top=Math.min(...boxes.map(b=>b.y));return{left,top,right:Math.max(...boxes.map(b=>b.x+b.width)),bottom:Math.max(...boxes.map(b=>b.y+b.height))};});
  const top=Math.min(...footprints.map(b=>b.top)),bottom=Math.max(...footprints.map(b=>b.bottom));
  const blocked=[...structures.filter(o=>Math.min(o.box.y+o.box.height,bottom)>Math.max(o.box.y,top)+.01).map(o=>({left:o.box.x,right:o.box.x+o.box.width})),...floorColumns,...(surface.walls??[]).filter(p=>p.top>top+.01).map(p=>({left:p.left,right:p.right}))];
  const widths=footprints.map(b=>b.right-b.left);if(widths.reduce((sum,w)=>sum+w,0)>region.right-region.left+.01)throw new Error(`${region.panel.name}の横幅に作品とタイトルボードが収まりません。`);
  const positions=equalIntervalPositions(widths,usableIntervals(region.left,region.right,blocked));
  row.forEach((o,i)=>moveWork(next,works,view,o.source.workId,positions[i]-footprints[i].left,0));
 }
 return safeCandidate(room,next,works);
}
export function setSurfaceGap(room:RoomLayout,works:LayoutWork[],view:string,measurementId:string,value:number,fixedWorkId?:string){if(!Number.isFinite(value)||value<0||value>100000)throw new Error('間隔は0〜100000mmで入力してください。');const m=surfaceMeasurements(room,works,view,true,true).find(m=>m.id===measurementId);if(!m?.editable)throw new Error('測定対象が変更されています。間隔を選び直してください。');const next=structuredClone(room);let moving=m.b,delta=value-m.value;if(m.kind==='gap'){if(fixedWorkId===m.b){moving=m.a;delta=-delta;}else if(fixedWorkId!==m.a)throw new Error('固定する作品を選んでください。');}else if(m.a){moving=m.a;delta=-delta;}
 moveWork(next,works,view,moving!,m.axis==='x'?delta:0,m.axis==='y'?delta:0);return safeCandidate(room,next,works);
}
export function alignSurfaceEyeHeight(room:RoomLayout,works:LayoutWork[],view:string,ids?:string[]){const surface=roomSurfaces(room).find(s=>s.key===view);if(!surface)throw new Error('壁またはパネル面を選択してください。');const next=structuredClone(room),items=boxItems(next,works,view).filter(o=>!ids?.length||ids.includes(o.id));if(!items.length)throw new Error('目線の高さに揃える作品がありません。');for(const o of items)moveWork(next,works,view,o.source.workId,0,surface.height-EYE_HEIGHT_MM-o.box.y-o.box.height/2);return safeCandidate(room,next,works);}
export function eyeHeightSnap(room:RoomLayout,works:LayoutWork[],view:string,ids:string[],dy:number,tolerance:number){const surface=roomSurfaces(room).find(s=>s.key===view),items=boxItems(room,works,view).filter(o=>ids.includes(o.id));if(!surface||!items.length)return;const centers=items.map(o=>o.box.y+o.box.height/2);if(Math.max(...centers)-Math.min(...centers)>.01)return;const target=surface.height-EYE_HEIGHT_MM,delta=target-centers[0];return Math.abs(delta-dy)<=tolerance?{dy:delta,yGuide:target}:undefined;}
export function layoutWorkSummary(room:RoomLayout,works:LayoutWork[],view:string){
 const byId=new Map(works.map(w=>[w.id,w])),widths=new Map<string,number>();
 for(const p of room.placements){if(view!=='floor'&&!sameWallSurface(room,`wall:${p.wall}`,view))continue;const w=byId.get(p.workId);if(w)widths.set(w.id,layoutBounds(placedPhotos(w,p,0)).width);}
 for(const p of room.boardPlacements??[]){if(view!=='floor'&&view!==`board:${p.groupId}:${p.face}`)continue;const w=byId.get(p.workId);if(w)widths.set(w.id,layoutBounds(placedPhotos(w,p,0)).width);}
 if(view==='floor')for(const p of room.books)if(byId.has(p.workId)&&room.tables.some(t=>t.id===p.tableId))widths.set(p.workId,layoutBounds([{assetId:'',x:0,y:0,width:p.width,height:p.depth,rotation:p.rotation}]).width);
 return{count:widths.size,width:[...widths.values()].reduce((a,b)=>a+b,0)};
}
export function guideMeasurementsSvg(measurements:GuideMeasurement[],unit:number,interactive=false,obstacles:{x:number;y:number;width:number;height:number}[]=[],frame?:{x:number;y:number;width:number;height:number}){const boxes:{x:number;y:number;width:number;height:number}[]=[],parts:string[]=[];const overlap=(a:any,b:any)=>a.x<b.x+b.width+3*unit&&a.x+a.width+3*unit>b.x&&a.y<b.y+b.height+3*unit&&a.y+a.height+3*unit>b.y;
 const distinct=measurements.filter((m,i)=>!measurements.slice(0,i).some(p=>Math.abs(p.value-m.value)<.01&&p.axis===m.axis&&Math.abs(p.x1-m.x1)<.01&&Math.abs(p.x2-m.x2)<.01&&Math.abs(p.y1-m.y1)<.01&&Math.abs(p.y2-m.y2)<.01));
 for(const m of distinct){const label=`${m.label??''}${m.value.toFixed(1)} mm`,w=([...label].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?11:6.5),0)+10)*unit,h=18*unit,anchor={x:(m.x1+m.x2)/2,y:(m.y1+m.y2)/2},initial={x:anchor.x-w/2,y:anchor.y-h-6*unit,width:w,height:h};let b=initial;for(let n=0;n<4096;n++){const offset=n?Math.ceil(n/2)*22*unit*(n%2?1:-1):0;const candidate={...initial,x:frame?Math.max(frame.x,Math.min(initial.x,frame.x+frame.width-w)):initial.x,y:initial.y+offset};if((!frame||candidate.y>=frame.y&&candidate.y+h<=frame.y+frame.height)&&![...obstacles,...boxes].some(o=>overlap(candidate,o))){b=candidate;break;}}
  boxes.push(b);const color=m.value<-.01?'#a32b2b':'#887e70',hit=interactive&&m.editable;parts.push(`<g data-layout-measurement="${m.id}" fill="none" stroke="${color}"><path d="M${m.x1} ${m.y1}L${m.x2} ${m.y2}" stroke-width=".8" vector-effect="non-scaling-stroke"/>${b.y!==initial.y?`<path d="M${anchor.x} ${anchor.y}L${b.x+w/2} ${b.y+h}" stroke-width=".5" vector-effect="non-scaling-stroke"/>`:''}<g ${hit?`data-layout-auto-gap="${m.id}" role="button" tabindex="0" aria-label="間隔${label}を変更"`:''}><rect x="${b.x}" y="${b.y}" width="${w}" height="${h}" fill="white" fill-opacity=".95" stroke="none" ${hit?'pointer-events="all"':''}/><text x="${b.x+w/2}" y="${b.y+13*unit}" text-anchor="middle" font-size="${11*unit}" fill="${color}" stroke="none" ${hit?'pointer-events="all"':''}>${label}</text></g></g>`);
 }
 return{svg:parts.join(''),boxes};
}
