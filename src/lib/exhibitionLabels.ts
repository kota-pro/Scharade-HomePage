export type LabelRect={x:number;y:number;width:number;height:number};
export type LabelItem={id:string;text:string;anchor:{x:number;y:number};box?:LabelRect;position?:{dx:number;dy:number}};
export type PlacedLabel=LabelRect&{id:string;text:string;lines:string[];anchor:{x:number;y:number};number?:number};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const intersects=(a:LabelRect,b:LabelRect,pad:number)=>a.x<b.x+b.width+pad&&a.x+a.width+pad>b.x&&a.y<b.y+b.height+pad&&a.y+a.height+pad>b.y;
export function wrapLayoutLabel(text:string,fontSize:number,maxWidth:number) {
  const capacity=Math.max(1,Math.floor(maxWidth/fontSize)),characters=Array.from(text),lines:string[]=[];
  for(let i=0;i<characters.length;i+=capacity)lines.push(characters.slice(i,i+capacity).join(""));
  return lines.length?lines:[""];
}
export function placeLayoutLabels(items:LabelItem[],frame:LabelRect,fontSize:number,maxWidth:number,obstacles:LabelRect[]=[]) {
  const placed:PlacedLabel[]=[],legend:{id:string;number:number;text:string;anchor:{x:number;y:number};box:LabelRect}[]=[],pad=fontSize*.4;
  for(const item of [...items].sort((a,b)=>Number(!!b.position)-Number(!!a.position)||a.id.localeCompare(b.id))){
    const lines=wrapLayoutLabel(item.text,fontSize,maxWidth),width=Math.min(maxWidth,Math.max(...lines.map(l=>Array.from(l).length))*fontSize)+pad*2,height=lines.length*fontSize*1.35+pad*2,box=item.box??{x:item.anchor.x,y:item.anchor.y,width:0,height:0};
    const candidates=[{x:box.x,y:box.y+box.height+pad},{x:box.x,y:box.y-height-pad},{x:box.x+box.width+pad,y:box.y},{x:box.x-width-pad,y:box.y}];
    for(let ring=1;ring<=4;ring++)for(let angle=0;angle<8;angle++){const radians=angle*Math.PI/4;candidates.push({x:item.anchor.x-width/2+Math.cos(radians)*ring*(width+pad),y:item.anchor.y-height/2+Math.sin(radians)*ring*(height+pad)});}
    candidates.sort((a,b)=>Math.hypot(a.x+width/2-item.anchor.x,a.y+height/2-item.anchor.y)-Math.hypot(b.x+width/2-item.anchor.x,b.y+height/2-item.anchor.y));
    const target=item.position?{x:item.anchor.x+item.position.dx,y:item.anchor.y+item.position.dy,width,height}:candidates.map(p=>({...p,width,height})).find(p=>p.x>=frame.x&&p.y>=frame.y&&p.x+width<=frame.x+frame.width&&p.y+height<=frame.y+frame.height&&![...placed,...legend.map(e=>e.box)].some(q=>intersects(p,q,pad))&&!obstacles.some(q=>intersects(p,q,pad)));
    if(target)placed.push({...target,id:item.id,text:item.text,lines,anchor:item.anchor});
    else {const number=legend.length+1,w=fontSize*3,h=fontSize*1.5,candidates:{x:number;y:number}[]=[];for(let ring=1;ring<=16;ring++)for(let angle=0;angle<8;angle++)candidates.push({x:item.anchor.x+Math.cos(angle*Math.PI/4)*ring*fontSize*2-w/2,y:item.anchor.y+Math.sin(angle*Math.PI/4)*ring*fontSize*2-h/2});const marker=candidates.map(p=>({...p,width:w,height:h})).find(p=>p.x>=frame.x&&p.y>=frame.y&&p.x+w<=frame.x+frame.width&&p.y+h<=frame.y+frame.height&&![...placed,...legend.map(e=>e.box),...obstacles].some(q=>intersects(p,q,pad)))??{x:item.anchor.x+pad,y:item.anchor.y+pad,width:w,height:h};legend.push({id:item.id,number,text:item.text,anchor:item.anchor,box:marker});}
  }
  return{labels:placed,legend};
}
export function layoutLabelsSvg(items:LabelItem[],frame:LabelRect,fontSize:number,maxWidth:number,obstacles:LabelRect[]=[],interactive=false) {
  const result=placeLayoutLabels(items,frame,fontSize,maxWidth,obstacles),pad=fontSize*.4;
  return{...result,svg:result.labels.map(label=>`<g class="layout-work-label" data-label-id="${escape(label.id)}"${interactive?' pointer-events="all" role="button" tabindex="-1"':''}><path d="M${label.anchor.x} ${label.anchor.y}L${label.x+pad} ${label.y+pad}" fill="none" stroke="#777" stroke-width=".5" pointer-events="none"/><rect x="${label.x}" y="${label.y}" width="${label.width}" height="${label.height}" fill="#ffffff" fill-opacity=".95" stroke="none"/><text x="${label.x+pad}" y="${label.y+pad+fontSize}" font-size="${fontSize}" fill="#251f1c">${label.lines.map((line,i)=>`<tspan x="${label.x+pad}" dy="${i?fontSize*1.35:0}">${escape(line)}</tspan>`).join("")}</text></g>`).join("")+result.legend.map(entry=>`<g class="layout-work-label" data-label-id="${escape(entry.id)}"${interactive?' pointer-events="all" role="button" tabindex="-1"':''}><path d="M${entry.anchor.x} ${entry.anchor.y}L${entry.box.x+pad} ${entry.box.y+pad}" fill="none" stroke="#777" stroke-width=".5" pointer-events="none"/><rect x="${entry.box.x}" y="${entry.box.y}" width="${entry.box.width}" height="${entry.box.height}" fill="white" fill-opacity=".95"/><text x="${entry.box.x+pad}" y="${entry.box.y+fontSize}" font-size="${fontSize}" fill="#333">[${entry.number}]</text></g>`).join('')};
}
