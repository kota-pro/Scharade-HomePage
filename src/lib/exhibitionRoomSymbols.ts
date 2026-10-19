import { richTextSvg } from './exhibitionRichText.ts';
import type { LayoutWork, Opening, RoomAnnotation, RoomLayout } from "./exhibitionTypes.ts";
import { compileVectorPath, segmentSvg, subsegment, segmentTAtLength } from './exhibitionVector.ts';
import { roomWalls, roomWallPoint } from './exhibitionRoomPath.ts';
export const roomSymbolLabels = { power: "電源", door: "ドア記号", window:"窓記号", image:"画像", text: "文字・数字", rect: "四角形", ellipse: "楕円", path: "パス", freehand: "自由描画" };
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function layoutWorkLabel(work: LayoutWork | undefined, showNames = true) {
  return `${showNames && work?.exhibitorName ? work.exhibitorName + " / " : ""}${work?.title || "作品"}`;
}
export function annotationSvg(a: RoomAnnotation, scale = 1, flipY = false, textOutline?:(a:RoomAnnotation)=>string,imageHref?:string) {
  const w = a.width * scale, h = a.height * scale, f = a.fontSize * scale, sign = flipY ? -1 : 1;
  const attrs = 'fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"';
  let shape = a.kind === "rect" ? `<rect width="${w}" height="${h}" ${attrs}/>` : a.kind === "ellipse" ? `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" ${attrs}/>` : a.kind === "power" ? `<rect width="${w}" height="${h}" rx="${Math.min(w,h)*.2}" ${attrs}/><path d="M${w*.35} ${h*.3}V${h*.55}M${w*.65} ${h*.3}V${h*.55}M${w*.5} ${h*.7}v${h*.05}" ${attrs}/>` : a.kind === "door" ? `<path d="M0 0H${w}M0 0V${h}M${w} 0A${w} ${h} 0 0 1 0 ${h}" ${attrs}/>` : "";
  if(a.kind==='window')shape=`<rect width="${w}" height="${h}" ${attrs}/><path d="M${w/2} 0V${h}M0 ${h/2}H${w}" ${attrs}/>`;
  if(a.kind==='image')shape=imageHref?`<image href="${escape(imageHref)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`:`<rect width="${w}" height="${h}" ${attrs}/>`;
  if(a.path)shape=`<path d="${compileVectorPath(a.path).svg}" fill="${a.fill??'none'}" stroke="currentColor" stroke-width="${a.strokeWidth??1.5}" ${a.strokeWidth===undefined?'vector-effect="non-scaling-stroke"':''}/>`;
  if(a.path&&a.kind==='power'){const b=compileVectorPath(a.path).bounds;shape+=`<path d="M${b.x+b.width*.35} ${b.y+b.height*.3}v${b.height*.25}M${b.x+b.width*.65} ${b.y+b.height*.3}v${b.height*.25}M${b.x+b.width*.5} ${b.y+b.height*.7}v${b.height*.05}" ${attrs}/>`;}
  if (flipY && shape) shape = `<g transform="scale(1 -1)">${shape}</g>`;
  return `<g transform="translate(${a.x*scale} ${sign*a.y*scale}) rotate(${sign*a.rotation})" class="room-symbol" opacity="${a.opacity??1}" style="color:${/^#[a-fA-F0-9]{6}$/.test(a.color??"")?a.color:"#343434"}">${shape}${a.kind==='text'?(textOutline?textOutline(a):richTextSvg(a)):a.text ? `<g transform="translate(0 ${flipY ? -h : h}) scale(${a.textScaleX??1} ${a.textScaleY??1})"><text x="0" y="${flipY ? -f*.25 : f}" style="font-size:${f}px" fill="currentColor">${escape(a.text)}</text></g>` : ""}</g>`;
}
export function openingFloorSvg(room: RoomLayout, o: Opening, scale = 1, flipY = false) {
  const p=roomWallPoint(room,o.wall,o.offset),wall=roomWalls(room)[o.wall],sign=flipY?-1:1;
  const area=room.vertices.reduce((sum,p,i)=>{const q=room.vertices[(i+1)%room.vertices.length];return sum+p.x*q.y-q.x*p.y;},0), inward=area>0?1:-1;
  const w=o.width*scale, y=sign*inward*w;
  const angle=(o.swingAngle??90)*Math.PI/180,leaf={x:w*Math.cos(angle),y:sign*inward*w*Math.sin(angle)},opening=subsegment(wall.segment,segmentTAtLength(wall.segment,o.offset),segmentTAtLength(wall.segment,o.offset+o.width)),color=/^#[a-fA-F0-9]{6}$/.test(o.color??'')?o.color:'#a32b2b';
  return `<g fill="none" stroke="${color}"><g transform="scale(${scale} ${sign*scale})"><path d="${segmentSvg(opening)}" stroke-width="5" vector-effect="non-scaling-stroke"/></g><g transform="translate(${p.x*scale} ${sign*p.y*scale}) rotate(${sign*p.angle})">${o.visualPath?`<g transform="scale(${scale} ${sign*scale})"><path d="${compileVectorPath(o.visualPath).svg}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`:o.kind==='door'?`<path d="M0 0L${leaf.x} ${leaf.y}M${w} 0A${w} ${w} 0 0 ${y>0?1:0} ${leaf.x} ${leaf.y}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`:`<path d="M0 -4H${w}M0 4H${w}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`}</g></g>`;
}
