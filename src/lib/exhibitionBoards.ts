import {annotationWorldBounds} from './exhibitionAnnotationPath.ts';
import { placedPhotos, rotatedCorners, layoutBounds } from "./exhibitionGeometry.ts";
import type { BoardGroup, RoomLayout, Work } from "./exhibitionTypes.ts";
import { titleBoardPhoto } from "./exhibitionTitleBoardLayout.ts";
const round=(n:number)=>Math.round(n*1000)/1000;
export function boardChain(group:BoardGroup) {
  let x=group.x,y=group.y,angle=group.rotation;
  return group.panels.map((panel,i)=>{
    if(i) angle+=panel.hingeAngle;
    const a=angle*Math.PI/180,c=Math.cos(a),s=Math.sin(a),start={x,y},end={x:x+panel.width*c,y:y+panel.width*s},half=panel.thickness/2;
    const polygon=[{x:x-s*half,y:y+c*half},{x:end.x-s*half,y:end.y+c*half},{x:end.x+s*half,y:end.y-c*half},{x:x+s*half,y:y-c*half}];
    x=end.x;y=end.y;return{panel,start,end,angle,polygon};
  });
}
export function boardSurface(group:BoardGroup,face:"A"|"B") {
  let x=0;const ordered=face==="A"?group.panels:[...group.panels].reverse(),height=Math.max(...group.panels.map(p=>p.height));
  const panels=ordered.map(panel=>{const left=x;x+=panel.width;return{panel,left,right:x,top:height-panel.height};});
  return{width:x,height,panels};
}
/** Recognize legacy chains stored as separate groups, without changing their geometry. */
export function touchingBoardRuns(groups:BoardGroup[],tolerance=1):BoardGroup[][] {
  const ends=groups.map(group=>{const chain=boardChain(group);return{group,start:chain[0].start,end:chain.at(-1)!.end};});
  const matches=ends.flatMap(a=>ends.filter(b=>a!==b&&Math.hypot(a.end.x-b.start.x,a.end.y-b.start.y)<=tolerance).map(b=>({a:a.group.id,b:b.group.id})));
  const outgoing=new Map<string,number>(),incomingCount=new Map<string,number>();for(const m of matches){outgoing.set(m.a,(outgoing.get(m.a)??0)+1);incomingCount.set(m.b,(incomingCount.get(m.b)??0)+1);}
  const links=matches.filter(link=>outgoing.get(link.a)===1&&incomingCount.get(link.b)===1);
  const next=new Map(links.map(l=>[l.a,l.b])),incoming=new Set(links.map(l=>l.b)),byId=new Map(groups.map(g=>[g.id,g])),visited=new Set<string>(),runs:BoardGroup[][]=[];
  const walk=(g:BoardGroup)=>{if(visited.has(g.id))return;const run:BoardGroup[]=[];let current:BoardGroup|undefined=g;while(current&&!visited.has(current.id)){visited.add(current.id);run.push(current);current=byId.get(next.get(current.id)??'');}runs.push(run);};
  groups.filter(g=>!incoming.has(g.id)).forEach(walk);groups.forEach(walk);return runs;
}
/** Joining on entry to the editor is a normal revisioned edit, so undo/history retain the original. */
export function connectTouchingBoards(room:RoomLayout,tolerance=1) {
  let next=room;
  for(const run of touchingBoardRuns(room.boardGroups??[],tolerance)){
    let first=run[0].id;
    for(const group of run.slice(1))next=joinBoardGroups(next,first,group.id);
  }
  return next;
}
export function boardPlacementProblems(room:RoomLayout,works:Work[]) {
  const problems:string[]=[];
  for(const placement of room.boardPlacements??[]) {
    const group=room.boardGroups?.find(g=>g.id===placement.groupId),work=works.find(w=>w.id===placement.workId);
    if(!group||!work||work.kind==="book"){problems.push("展示ボードの配置先・作品を確認してください。");continue;}
    const surface=boardSurface(group,placement.face);
    placedPhotos(work,placement,surface.height).forEach((photo,i)=>{
      const points=rotatedCorners(photo.width,photo.height,photo.rotation).map(p=>({x:p.x+photo.x,y:p.y+photo.y}));
      if(!surface.panels.some(p=>points.every(q=>q.x>=p.left-.01&&q.x<=p.right+.01&&q.y>=p.top-.01&&q.y<=surface.height+.01)))problems.push(`${work.title}の写真${i+1}が展示ボードからはみ出すか、継ぎ目をまたいでいます。`);
    });
  }
  for(const card of room.titleBoards??[])if(card.surface.startsWith("board:")) {
    const [,groupId,face]=card.surface.split(":"),group=room.boardGroups?.find(g=>g.id===groupId);
    if(!group){problems.push("タイトルボードの配置先を確認してください。");continue;}
    const surface=boardSurface(group,face as "A"|"B"),photo=titleBoardPhoto(card,surface.height);
    const points=rotatedCorners(photo.width,photo.height,photo.rotation).map(p=>({x:p.x+photo.x,y:p.y+photo.y}));
    if(!surface.panels.some(p=>points.every(q=>q.x>=p.left-.01&&q.x<=p.right+.01&&q.y>=p.top-.01&&q.y<=surface.height+.01)))problems.push("タイトルボードが展示ボードからはみ出すか、継ぎ目をまたいでいます。");
  }
  return [...new Set(problems)];
}
/** A+B concatenate in physical order. B-side x is measured from the back's left. */
function rebindDecorations(room:RoomLayout,from:string,to:string,dx:number,dy=0){for(const a of room.annotations??[])if(a.surface===from){a.surface=to;a.x=round(a.x+dx);a.y=round(a.y+dy);}for(const p of room.labelPositions??[])if(p.surface===from)p.surface=to;for(const d of room.dimensions??[])if(d.surface===from){d.surface=to;for(const anchor of [d.a,d.b])if(anchor.kind==='free'){anchor.x=round(anchor.x+dx);anchor.y=round(anchor.y+dy);}}}
export function joinBoardGroups(room:RoomLayout,firstId:string,secondId:string) {
  const next=structuredClone(room),first=next.boardGroups?.find(g=>g.id===firstId),second=next.boardGroups?.find(g=>g.id===secondId);
  if(!first||!second||first===second)throw new Error("接続する展示ボードを二つ選んでください。");
  if((!!first.attachment!==!!second.attachment)||(first.attachment&&second.attachment&&(first.attachment.wallId!==second.attachment.wallId||first.attachment.distance!==second.attachment.distance||(first.attachment.bottom??0)!==(second.attachment.bottom??0))))throw new Error('連動する壁や高さが異なります。壁との連動を解除してから接続してください。');
  if(next.dimensions?.some(d=>[d.a,d.b].some(a=>a.kind==='object'&&a.objectId===`board:${secondId}`)))throw new Error('接続先のボード本体を測定する寸法線を削除してから接続してください。');
  if(first.panels.length+second.panels.length>100)throw new Error("接続する展示ボードは100枚までです。");
  for(const key of ["hidden","locked"] as const)if(!!room.editor?.[key].includes(`board:${firstId}`)!==!!room.editor?.[key].includes(`board:${secondId}`))throw new Error("接続するボードの表示・ロック設定を揃えてください。");
  const firstWidth=boardSurface(first,"A").width,secondWidth=boardSurface(second,"A").width,last=boardChain(first).at(-1)!;
  second.panels[0].hingeAngle=round(((second.rotation-last.angle+540)%360)-180);
  const firstHeight=boardSurface(first,'A').height,secondHeight=boardSurface(second,'A').height;first.panels.push(...second.panels);const newHeight=boardSurface(first,'A').height;
  rebindDecorations(next,`board:${first.id}:A`,`board:${first.id}:A`,0,newHeight-firstHeight);rebindDecorations(next,`board:${first.id}:B`,`board:${first.id}:B`,secondWidth,newHeight-firstHeight);rebindDecorations(next,`board:${second.id}:A`,`board:${first.id}:A`,firstWidth,newHeight-secondHeight);rebindDecorations(next,`board:${second.id}:B`,`board:${first.id}:B`,0,newHeight-secondHeight);
  for(const p of next.boardPlacements??[]) {
    if(p.groupId===first.id && p.face==="B")p.x=round(p.x+secondWidth);
    if(p.groupId===second.id){p.groupId=first.id;if(p.face==="A")p.x=round(p.x+firstWidth);}
  }
  for(const p of next.titleBoards??[]) {
    if(p.surface===`board:${first.id}:B`)p.x=round(p.x+secondWidth);
    if(p.surface.startsWith(`board:${second.id}:`)){if(p.surface.endsWith(":A"))p.x=round(p.x+firstWidth);p.surface=p.surface.replace(`board:${second.id}:`,`board:${first.id}:`);}
  }
  if(next.editor){for(const key of ["order","hidden","locked"] as const)next.editor[key]=next.editor[key].filter(id=>id!==`board:${secondId}`);next.editor.groups=next.editor.groups.map(g=>({...g,objectIds:g.objectIds.filter(id=>id!==`board:${secondId}`)})).filter(g=>g.objectIds.length>1);}
  next.labelPositions=next.labelPositions?.filter(p=>p.target!==`board:${secondId}`);next.boardGroups=next.boardGroups!.filter(g=>g.id!==second.id);return next;
}
export function detachBoardGroup(room:RoomLayout,groupId:string,index:number,works:Work[],newId=crypto.randomUUID()) {
  const next=structuredClone(room),group=next.boardGroups?.find(g=>g.id===groupId);
  if(!group||index<1||index>=group.panels.length)throw new Error("2枚目以降の展示ボードを選んで切り離してください。");
  const total=boardSurface(group,"A"),cut=group.panels.slice(0,index).reduce((sum,p)=>sum+p.width,0),remainder=total.width-cut,anchor=boardChain(group)[index];
  const assignments=(next.boardPlacements??[]).filter(p=>p.groupId===groupId).map(p=>{
    const work=works.find(w=>w.id===p.workId);if(!work)throw new Error("配置した作品を確認してください。");
    const box=layoutBounds(placedPhotos(work,p,total.height)),boundary=p.face==="A"?cut:remainder;
    if(box.x<boundary-.01&&box.x+box.width>boundary+.01)throw new Error("切り離す継ぎ目の両側に組写真があります。作品を移動してから切り離してください。");
    return{p,toSecond:p.face==="A"?box.x>=boundary-.01:box.x+box.width<=boundary+.01};
  });
  const cards=(next.titleBoards??[]).filter(p=>p.surface.startsWith(`board:${groupId}:`)).map(p=>{
    const boundary=p.surface.endsWith(":A")?cut:remainder,box=layoutBounds([titleBoardPhoto(p,total.height)]);
    if(box.x<boundary-.01&&box.x+box.width>boundary+.01)throw new Error("タイトルボードを継ぎ目から移動してから切り離してください。");
    const toSecond=p.surface.endsWith(":A")?box.x>=boundary-.01:box.x+box.width<=boundary+.01;
    if(assignments.find(a=>a.p.workId===p.workId)?.toSecond!==toSecond)throw new Error("作品とタイトルボードを同じ側へ移動してから切り離してください。");
    return {p,toSecond};
  });
  if(group.attachment&&group.panels.some(p=>Math.abs(p.hingeAngle)>.01))throw new Error('折れ曲がったボードは壁との連動を解除してから切り離してください。');
  const decorations=(next.annotations??[]).filter(a=>a.surface?.startsWith(`board:${groupId}:`)).map(a=>{const boundary=a.surface!.endsWith(':A')?cut:remainder,box=annotationWorldBounds(a);if(box.x<boundary-.01&&box.x+box.width>boundary+.01)throw new Error('図形・画像を切り離す継ぎ目から移動してください。');return{a,toSecond:a.surface!.endsWith(':A')?box.x>=boundary-.01:box.x+box.width<=boundary+.01};});
  const refSides=new Map<string,boolean>([...assignments.map(({p,toSecond})=>[`work:${p.workId}`,toSecond] as const),...cards.map(({p,toSecond})=>[`titleboard:${p.id}`,toSecond] as const),...decorations.map(({a,toSecond})=>[`annotation:${a.id}`,toSecond] as const)]);
  const measures=(next.dimensions??[]).filter(d=>d.surface.startsWith(`board:${groupId}:`)).map(d=>{const boundary=d.surface.endsWith(':A')?cut:remainder,side=(a:typeof d.a)=>a.kind==='free'?(d.surface.endsWith(':A')?a.x>=boundary:a.x<=boundary):a.kind==='object'?refSides.get(a.objectId):a.kind==='panel'?group.panels.findIndex(p=>p.id===a.panelId)>=index:undefined,a=side(d.a),b=side(d.b);if(a===undefined||a!==b)throw new Error('切り離す継ぎ目を跨ぐ寸法線を削除してください。');return{d,toSecond:a};});
  const second:BoardGroup={id:newId,name:group.name+"（分割）",x:anchor.start.x,y:anchor.start.y,rotation:anchor.angle,panels:group.panels.splice(index)};second.panels[0].hingeAngle=0;if(group.attachment)second.attachment={...group.attachment,offset:group.attachment.offset+cut};
  for(const {a,toSecond} of decorations){const face=a.surface!.endsWith(':A')?'A':'B',dx=toSecond?(face==='A'?-cut:0):(face==='B'?-remainder:0),target=toSecond?second:group;a.surface=`board:${target.id}:${face}`;a.x=round(a.x+dx);a.y=round(a.y+boardSurface(target,face).height-total.height);}
  for(const {d,toSecond} of measures){const face=d.surface.endsWith(':A')?'A':'B',dx=toSecond?(face==='A'?-cut:0):(face==='B'?-remainder:0),target=toSecond?second:group;d.surface=`board:${target.id}:${face}`;for(const a of [d.a,d.b])if(a.kind==='free'){a.x=round(a.x+dx);a.y=round(a.y+boardSurface(target,face).height-total.height);}}
  for(const {p,toSecond}of assignments){if(toSecond){p.groupId=second.id;if(p.face==="A")p.x=round(p.x-cut);}else if(p.face==="B")p.x=round(p.x-remainder);}
  for(const {p,toSecond}of cards){if(toSecond){if(p.surface.endsWith(":A"))p.x=round(p.x-cut);p.surface=p.surface.replace(`board:${groupId}:`,`board:${second.id}:`);}else if(p.surface.endsWith(":B"))p.x=round(p.x-remainder);}
  if(next.editor){for(const key of ["hidden","locked"] as const)if(next.editor[key].includes(`board:${groupId}`))next.editor[key].push(`board:${newId}`);}
  const movedPanels=new Set(second.panels.map(p=>`panel:${p.id}`));for(const d of next.dimensions??[])if(d.surface==='floor')for(const a of [d.a,d.b])if(a.kind==='object'&&a.objectId===`board:${groupId}`&&a.feature&&movedPanels.has(a.feature.key))a.objectId=`board:${newId}`;
  for(const p of next.labelPositions??[])if(p.surface.startsWith(`board:${groupId}:`)&&p.target.startsWith('work:')&&next.boardPlacements?.some(w=>w.workId===p.target.slice(5)&&w.groupId===newId))p.surface=`board:${newId}:${p.surface.split(':')[2]}`;next.boardGroups!.push(second);return next;
}
export function snapBoardConnection(room:RoomLayout,movingId:string,tolerance:number) {
  const moving=room.boardGroups?.find(g=>g.id===movingId);if(!moving)return room;
  const source=boardChain(moving),start=source[0].start,end=source.at(-1)!.end;
  let match:{first:string;second:string;distance:number}|undefined;
  for(const group of room.boardGroups??[])if(group.id!==moving.id){const chain=boardChain(group);for(const [a,b,first,second]of [[start,chain.at(-1)!.end,group.id,moving.id],[end,chain[0].start,moving.id,group.id]] as const){const distance=Math.hypot(a.x-b.x,a.y-b.y);if(distance<=tolerance&&(!match||distance<match.distance))match={first,second,distance};}}
  if(!match)return room;
  const joined=joinBoardGroups(room,match.first,match.second);
  // A middle panel can touch a chain at both ends; finish every connection in that run.
  return snapBoardConnection(joined,match.first,tolerance);
}
