import type { VectorPoint as Point, VectorNode, VectorPath } from './exhibitionTypes.ts';
export type VectorSegment = { a: Point; b: Point; c1?: Point; c2?: Point; arc?: { center: Point; radius: number; start: number; sweep: number } };
export const add = (a:Point,b:Point):Point=>({x:a.x+b.x,y:a.y+b.y});
export const subtract = (a:Point,b:Point):Point=>({x:a.x-b.x,y:a.y-b.y});
export const scale = (p:Point,k:number):Point=>({x:p.x*k,y:p.y*k});
export const length = (p:Point)=>Math.hypot(p.x,p.y);
export const distance = (a:Point,b:Point)=>length(subtract(a,b));
export const unitVector = (p:Point):Point=>scale(p,1/Math.max(1e-12,length(p)));
export const interpolate = (a:Point,b:Point,t:number):Point=>add(scale(a,1-t),scale(b,t));
const cross = (a:Point,b:Point)=>a.x*b.y-a.y*b.x;
const dot = (a:Point,b:Point)=>a.x*b.x+a.y*b.y;
const numeric = (n:number)=>Math.abs(n)<1e-9?'0':String(Math.round(n*1e6)/1e6);
const pair = (p:Point)=>`${numeric(p.x)} ${numeric(p.y)}`;
export function nodeSegment(a:VectorNode,b:VectorNode):VectorSegment {
  if(a.arc){const chord=subtract(b,a),d=Math.hypot(chord.x,chord.y);if(d>1e-8){const radius=Math.max(a.arc.radius,d/2),h=Math.sqrt(Math.max(0,radius*radius-d*d/4)),sign=a.arc.large===a.arc.sweep?-1:1,center=add(scale(add(a,b),.5),{x:-chord.y/d*h*sign,y:chord.x/d*h*sign}),start=Math.atan2(a.y-center.y,a.x-center.x);let sweep=Math.atan2(b.y-center.y,b.x-center.x)-start;if(a.arc.sweep&&sweep<0)sweep+=Math.PI*2;if(!a.arc.sweep&&sweep>0)sweep-=Math.PI*2;return{a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},arc:{center,radius,start,sweep}};}}
  return a.out||b.in?{a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},c1:add(a,a.out??{x:0,y:0}),c2:add(b,b.in??{x:0,y:0})}:{a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}};
}
export function segmentPoint(s:VectorSegment,t:number):Point {
  if(s.arc){const a=s.arc.start+s.arc.sweep*t;return add(s.arc.center,{x:s.arc.radius*Math.cos(a),y:s.arc.radius*Math.sin(a)});}
  if(!s.c1)return interpolate(s.a,s.b,t);
  const u=1-t;return {x:u*u*u*s.a.x+3*u*u*t*s.c1.x+3*u*t*t*s.c2!.x+t*t*t*s.b.x,y:u*u*u*s.a.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2!.y+t*t*t*s.b.y};
}
export function segmentDerivative(s:VectorSegment,t:number):Point {
  if(s.arc){const a=s.arc.start+s.arc.sweep*t,k=s.arc.radius*s.arc.sweep;return{x:-Math.sin(a)*k,y:Math.cos(a)*k};}
  if(!s.c1)return subtract(s.b,s.a);
  return add(add(scale(subtract(s.c1,s.a),3*(1-t)**2),scale(subtract(s.c2!,s.c1),6*(1-t)*t)),scale(subtract(s.b,s.c2!),3*t*t));
}
/** A cubic may have a coincident control and endpoint while its visible tangent is valid. */
export function segmentTangent(s:VectorSegment,t:number):Point {
  let v=segmentDerivative(s,t);if(Math.hypot(v.x,v.y)<1e-8)v=segmentDerivative(s,t<=.5?Math.min(1,t+1e-6):Math.max(0,t-1e-6));
  return unitVector(Math.hypot(v.x,v.y)<1e-8?subtract(s.b,s.a):v);
}
const gx=[0,-.5384693101056831,.5384693101056831,-.906179845938664,.906179845938664],gw=[.5688888888888889,.4786286704993665,.4786286704993665,.2369268850561891,.2369268850561891];
function integral(s:VectorSegment,a:number,b:number){const mid=(a+b)/2,half=(b-a)/2;return half*gx.reduce((sum,x,i)=>sum+gw[i]*length(segmentDerivative(s,mid+half*x)),0);}
const lengths=new WeakMap<VectorSegment,number>();
export function segmentLength(s:VectorSegment,start=0,end=1):number {
  if(start===0&&end===1&&lengths.has(s))return lengths.get(s)!;
  let result:number;
  if(s.arc)result=s.arc.radius*Math.abs(s.arc.sweep)*(end-start);
  else if(!s.c1)result=distance(s.a,s.b)*(end-start);
  else {const recurse=(a:number,b:number,whole:number,tolerance:number,depth:number):number=>{const m=(a+b)/2,left=integral(s,a,m),right=integral(s,m,b);return depth===0||Math.abs(left+right-whole)<tolerance?left+right:recurse(a,m,left,tolerance/2,depth-1)+recurse(m,b,right,tolerance/2,depth-1);};result=recurse(start,end,integral(s,start,end),.002,16);}
  if(start===0&&end===1)lengths.set(s,result);return result;
}
export function segmentTAtLength(s:VectorSegment,d:number):number {
  const total=segmentLength(s);if(total<1e-9)return 0;d=Math.max(0,Math.min(total,d));
  if(!s.c1)return d/total;
  let a=0,b=1;for(let i=0;i<28;i++){const mid=(a+b)/2;if(segmentLength(s,0,mid)<d)a=mid;else b=mid;}return (a+b)/2;
}
export const pointAtLength=(s:VectorSegment,d:number)=>segmentPoint(s,segmentTAtLength(s,d));
export function splitSegment(s:VectorSegment,t:number):[VectorSegment,VectorSegment] {
  const p=segmentPoint(s,t);
  if(s.arc)return [{a:s.a,b:p,arc:{...s.arc,sweep:s.arc.sweep*t}},{a:p,b:s.b,arc:{...s.arc,start:s.arc.start+s.arc.sweep*t,sweep:s.arc.sweep*(1-t)}}];
  if(!s.c1)return [{a:s.a,b:p},{a:p,b:s.b}];
  const a=interpolate(s.a,s.c1,t),b=interpolate(s.c1,s.c2!,t),c=interpolate(s.c2!,s.b,t),d=interpolate(a,b,t),e=interpolate(b,c,t);
  return [{a:s.a,c1:a,c2:d,b:p},{a:p,c1:e,c2:c,b:s.b}];
}
export function subsegment(s:VectorSegment,start:number,end:number):VectorSegment {
  if(start===0&&end===1)return s;
  const first=splitSegment(s,end)[0];return start===0?first:splitSegment(first,start/end)[1];
}
export function segmentCommand(s:VectorSegment):string {
  if(s.arc)return `A${numeric(s.arc.radius)} ${numeric(s.arc.radius)} 0 ${Math.abs(s.arc.sweep)>Math.PI?1:0} ${s.arc.sweep>=0?1:0} ${pair(s.b)}`;
  return s.c1?`C${pair(s.c1)} ${pair(s.c2!)} ${pair(s.b)}`:`L${pair(s.b)}`;
}
export const segmentSvg=(s:VectorSegment)=>`M${pair(s.a)}${segmentCommand(s)}`;
export function flattenSegment(s:VectorSegment,tolerance=.05):Point[] {
  if(s.arc){const n=Math.max(1,Math.ceil(Math.abs(s.arc.sweep)/Math.max(.001,2*Math.acos(Math.max(-1,1-tolerance/s.arc.radius)))));return Array.from({length:n+1},(_,i)=>segmentPoint(s,i/n));}
  if(!s.c1)return[s.a,s.b];
  const result=[s.a];
  const visit=(part:VectorSegment,depth:number)=>{const chord=subtract(part.b,part.a),den=length(chord),deviation=Math.max(...[part.c1!,part.c2!].map(p=>den>1e-12?Math.abs(cross(subtract(p,part.a),chord))/den:distance(p,part.a))),controlLength=distance(part.a,part.c1!)+distance(part.c1!,part.c2!)+distance(part.c2!,part.b);if(depth===0||deviation<=tolerance&&controlLength-distance(part.a,part.b)<=tolerance){result.push(part.b);return;}const [a,b]=splitSegment(part,.5);visit(a,depth-1);visit(b,depth-1);};visit(s,16);return result;
}
export function nearestSegmentT(s:VectorSegment,p:Point):number {
  const n=64;let best=0,min=Infinity;for(let i=0;i<=n;i++){const t=i/n,d=distance(segmentPoint(s,t),p);if(d<min){min=d;best=t;}}
  let a=Math.max(0,best-1/n),b=Math.min(1,best+1/n);for(let i=0;i<28;i++){const l=a+(b-a)/3,r=b-(b-a)/3;if(distance(segmentPoint(s,l),p)<distance(segmentPoint(s,r),p))b=r;else a=l;}return(a+b)/2;
}
export function segmentBounds(s:VectorSegment) {
  const ts=[0,1];
  if(s.arc){for(let i=-8;i<=8;i++){const angle=i*Math.PI/2,t=(angle-s.arc.start)/s.arc.sweep;if(t>0&&t<1)ts.push(t);}}
  else if(s.c1)for(const k of ['x','y'] as const){const a=-s.a[k]+3*s.c1[k]-3*s.c2![k]+s.b[k],b=2*(s.a[k]-2*s.c1[k]+s.c2![k]),c=s.c1[k]-s.a[k];if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-12)ts.push(-c/b);}else{const discriminant=b*b-4*a*c;if(discriminant>=0){ts.push((-b+Math.sqrt(discriminant))/(2*a),(-b-Math.sqrt(discriminant))/(2*a));}}}
  return pointBounds(ts.filter(t=>t>=0&&t<=1).map(t=>segmentPoint(s,t)));
}
export function pointBounds(points:Point[]) {if(!points.length)return{x:0,y:0,width:0,height:0};const xs=points.map(p=>p.x),ys=points.map(p=>p.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};}
export function cornerLimit(path:VectorPath,index:number) {
  const n=path.nodes.length;if(n<3||!path.closed&&(index===0||index===n-1))return 0;
  const before=nodeSegment(path.nodes[(index-1+n)%n],path.nodes[index]),after=nodeSegment(path.nodes[index],path.nodes[(index+1)%n]);
  const inT=segmentTangent(before,1),outT=segmentTangent(after,0),turn=Math.abs(Math.atan2(cross(inT,outT),dot(inT,outT))),tan=Math.tan(turn/2);
  return turn<1e-6||Math.PI-turn<1e-6?0:Math.min(segmentLength(before),segmentLength(after))*.45/tan;
}
export function compileVectorPath(path:VectorPath) {
  const nodes=path.nodes,n=nodes.length,count=path.closed?n:Math.max(0,n-1),raw=Array.from({length:count},(_,i)=>nodeSegment(nodes[i],nodes[(i+1)%n]));
  const cuts=nodes.map((node,i)=>{const radius=Math.min(node.radius??0,cornerLimit(path,i));if(radius<=1e-8)return{before:0,after:0,radius:0};const before=raw[(i-1+count)%count],after=raw[i],a=segmentTangent(before,1),b=segmentTangent(after,0),turn=Math.atan2(cross(a,b),dot(a,b));return{before:radius*Math.tan(Math.abs(turn)/2),after:radius*Math.tan(Math.abs(turn)/2),radius,turn};});
  const edges=raw.map((s,i)=>({index:i,segment:subsegment(s,segmentTAtLength(s,cuts[i].after),segmentTAtLength(s,segmentLength(s)-cuts[(i+1)%n].before))}));
  const corners=cuts.flatMap((cut,i)=>{if(!cut.radius)return[];const previous=edges[(i-1+count)%count].segment,next=edges[i].segment,a=previous.b,b=next.a,inT=segmentTangent(previous,1),outT=segmentTangent(next,0);let segment:VectorSegment;
    if(!raw[(i-1+count)%count].c1&&!raw[i].c1&&!raw[(i-1+count)%count].arc&&!raw[i].arc){const sign=cut.turn!>=0?1:-1,center=add(a,scale({x:-inT.y,y:inT.x},sign*cut.radius));segment={a,b,arc:{center,radius:cut.radius,start:Math.atan2(a.y-center.y,a.x-center.x),sweep:cut.turn!}};}
    else {const handle=distance(a,b)/3;segment={a,b,c1:add(a,scale(inT,handle)),c2:subtract(b,scale(outT,handle))};}
    return[{index:i,segment,radius:cut.radius}];});
  const ordered=edges.flatMap(edge=>{const corner=corners.find(c=>c.index===(edge.index+1)%n);return corner?[edge,corner]:[edge];}),segments=ordered.map(e=>e.segment);
  const svg=segments.length?`M${pair(segments[0].a)}${segments.map(segmentCommand).join('')}${path.closed?'Z':''}`:nodes.length?`M${pair(nodes[0])}`:'';
  const points=segments.flatMap((s,i)=>flattenSegment(s).slice(i?1:0));if(path.closed&&points.length&&distance(points[0],points.at(-1)!)<1e-6)points.pop();
  const bounds=pointBounds(segments.flatMap(s=>{const b=segmentBounds(s);return[{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height}];}));return{edges,corners,ordered,segments,svg,points,bounds};
}
export function simpleClosedPath(path:VectorPath) {
  if(!path.closed||path.nodes.length<3)return false;
  const points=compileVectorPath(path).points,n=points.length;if(n<3||n>12000)return false;
  const area=points.reduce((sum,p,i)=>sum+cross(p,points[(i+1)%n]),0);if(Math.abs(area)<2)return false;
  const orient=(a:Point,b:Point,c:Point)=>cross(subtract(b,a),subtract(c,a));
  for(let i=0;i<n;i++){const a=points[i],b=points[(i+1)%n];if(distance(a,b)<1e-8)return false;for(let j=i+2;j<n;j++){if(i===0&&j===n-1)continue;const c=points[j],d=points[(j+1)%n];if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.max(c.x,d.x)<Math.min(a.x,b.x)||Math.max(a.y,b.y)<Math.min(c.y,d.y)||Math.max(c.y,d.y)<Math.min(a.y,b.y))continue;if(orient(a,b,c)*orient(a,b,d)<=0&&orient(c,d,a)*orient(c,d,b)<=0)return false;}}return true;
}
export function splitPathEdge(path:VectorPath,index:number,t:number,id=crypto.randomUUID()) {
  const next=structuredClone(path),a=next.nodes[index],b=next.nodes[(index+1)%next.nodes.length];if(!a||!b||!next.closed&&index===next.nodes.length-1)throw new Error('線分を選択してください。');
  const [left,right]=splitSegment(nodeSegment(a,b),Math.max(.0001,Math.min(.9999,t))),node:VectorNode={...left.b,id};
  if(left.arc){a.arc={radius:left.arc.radius,sweep:left.arc.sweep>0,large:Math.abs(left.arc.sweep)>Math.PI};node.arc={radius:right.arc!.radius,sweep:right.arc!.sweep>0,large:Math.abs(right.arc!.sweep)>Math.PI};}
  else if(left.c1){a.out=subtract(left.c1,a);node.in=subtract(left.c2!,node);node.out=subtract(right.c1!,node);b.in=subtract(right.c2!,b);}next.nodes.splice(index+1,0,node);return next;
}
/** Make live corners explicit without approximating their circular geometry. */
export function materializeVectorPath(path:VectorPath) {
  const compiled=compileVectorPath(path),nodes:VectorNode[]=compiled.segments.map(s=>{const original=path.nodes.find(n=>!(n.radius??0)&&distance(n,s.a)<1e-6);return{...s.a,id:original?.id??crypto.randomUUID(),...(s.arc?{arc:{radius:s.arc.radius,sweep:s.arc.sweep>0,large:Math.abs(s.arc.sweep)>Math.PI}}:{}),...(s.c1?{out:subtract(s.c1,s.a)}:{})};});
  compiled.segments.forEach((s,i)=>{const next=nodes[(i+1)%nodes.length];if(s.c2&&next&&(path.closed||i+1<nodes.length))next.in=subtract(s.c2,next);});if(!path.closed&&compiled.segments.length){const last=compiled.segments.at(-1)!;nodes.push({...last.b,id:path.nodes.at(-1)?.id??crypto.randomUUID(),...(last.c2?{in:subtract(last.c2,last.b)}:{})});}
  return{nodes,closed:path.closed};
}
/** Editing a tangent deliberately changes a circular segment into a cubic. */
export function editableArcTangent(path:VectorPath,index:number){const a=path.nodes[index],b=path.nodes[(index+1)%path.nodes.length];if(!a?.arc||!b)return;const s=nodeSegment(a,b),arc=s.arc!,k=4/3*Math.tan(arc.sweep/4),end=arc.start+arc.sweep;a.out={x:-Math.sin(arc.start)*arc.radius*k,y:Math.cos(arc.start)*arc.radius*k};b.in={x:Math.sin(end)*arc.radius*k,y:-Math.cos(end)*arc.radius*k};delete a.arc;}
export function simplifyStroke(points:Point[],tolerance:number):Point[] {
  if(points.length<=2)return points.slice();const a=points[0],b=points.at(-1)!,ab=subtract(b,a),den=dot(ab,ab);let best=0,index=0;
  for(let i=1;i<points.length-1;i++){const t=den?Math.max(0,Math.min(1,dot(subtract(points[i],a),ab)/den)):0,d=distance(points[i],interpolate(a,b,t));if(d>best){best=d;index=i;}}
  return best>tolerance?[...simplifyStroke(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyStroke(points.slice(index),tolerance)]:[a,b];
}
export function strokePath(points:Point[],tolerance:number):VectorPath {
  const simplified=simplifyStroke(points,tolerance),nodes:VectorNode[]=simplified.map((p,i)=>{const previous=simplified[Math.max(0,i-1)],next=simplified[Math.min(simplified.length-1,i+1)],tangent=scale(subtract(next,previous),1/6);return{...p,id:crypto.randomUUID(),mode:'smooth',...i?{in:scale(tangent,-1)}:{},...i<simplified.length-1?{out:tangent}:{}};});return{nodes,closed:false};
}
