import {hatchPaint,shapeContour,shapeNameSvg,shapeNoteSvg,DEFAULT_SHAPE_STROKE_WIDTH} from './exhibitionShapeAppearance.ts';
import { openingPath } from './exhibitionOpeningPath.ts';
import { richTextSvg } from './exhibitionRichText.ts';
import type { LayoutWork, Opening, RoomAnnotation, RoomLayout } from "./exhibitionTypes.ts";
import { compileVectorPath, segmentSvg, subsegment, segmentTAtLength } from './exhibitionVector.ts';
import { roomWalls, roomWallPoint } from './exhibitionRoomPath.ts';
export const roomSymbolLabels = { power: "電源", door: "ドア記号", window:"窓記号", image:"画像", text: "文字・数字", rect: "四角形", ellipse: "楕円", path: "パス", freehand: "自由描画" };
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function layoutWorkLabel(work: LayoutWork | undefined, showNames = true, showTitles = true) {
  return [showNames?work?.exhibitorName:"",showTitles?(work?.title||"作品"):""].filter(Boolean).join(" / ");
}
export function annotationSvg(a: RoomAnnotation, scale = 1, flipY = false, textOutline?:(a:RoomAnnotation)=>string,imageHref?:string) {
  const sign=flipY?-1:1,ink=/^#[a-fA-F0-9]{6}$/.test(a.color??'')?a.color:'#343434',paint=hatchPaint(a),attrs=`fill="none" stroke="currentColor" stroke-width="${a.strokeWidth??DEFAULT_SHAPE_STROKE_WIDTH}"`;
  let shape='';
  if(a.kind==='image')shape=imageHref?`<image href="${escape(imageHref)}" width="${a.width}" height="${a.height}" preserveAspectRatio="xMidYMid meet"/>`:`<g ${attrs}>${shapeContour(a)}</g>`;
  else if(a.kind!=='text'){
    const contour=shapeContour(a);shape=paint.defs+(paint.fill!=='none'?`<g data-layout-hatch="" fill="${paint.fill}" stroke="none">${contour}</g>`:'');
    shape+=a.path?`<path d="${compileVectorPath(a.path).svg}" ${attrs}/>`:`<g ${attrs}>${contour}</g>`;
    const b=a.path?compileVectorPath(a.path).bounds:{x:0,y:0,width:a.width,height:a.height};
    if(a.kind==='power')shape+=`<path d="M${b.x+b.width*.35} ${b.y+b.height*.3}v${b.height*.25}M${b.x+b.width*.65} ${b.y+b.height*.3}v${b.height*.25}M${b.x+b.width*.5} ${b.y+b.height*.7}v${b.height*.05}" ${attrs}/>`;
    if(a.kind==='window'&&!a.path)shape+=`<path d="M${a.width/2} 0V${a.height}M0 ${a.height/2}H${a.width}" ${attrs}/>`;
  }
  const body=a.kind==='text'?(textOutline?textOutline(a):richTextSvg(a)):`<g transform="scale(${scale} ${sign*scale})">${shape}</g><g transform="scale(${scale})">${shapeNameSvg(a,flipY,a.name||roomSymbolLabels[a.kind])}${shapeNoteSvg(a,flipY)}</g>`;
  return `<g transform="translate(${a.x*scale} ${sign*a.y*scale}) rotate(${sign*a.rotation})" class="room-symbol" opacity="${a.opacity??1}" style="color:${ink}">${a.flipX||a.flipY?`<g data-layout-reflection="" transform="scale(${a.flipX?-1:1} ${a.flipY?-1:1})">`:''}${body}${a.flipX||a.flipY?'</g>':''}</g>`;
}

export function openingFloorSvg(room: RoomLayout, o: Opening, scale = 1, flipY = false) {
  const p=roomWallPoint(room,o.wall,o.offset),wall=roomWalls(room)[o.wall],sign=flipY?-1:1;
  const area=room.vertices.reduce((sum,p,i)=>{const q=room.vertices[(i+1)%room.vertices.length];return sum+p.x*q.y-q.x*p.y;},0), inward=area>0?1:-1;
  const w=o.width*scale;
  const direction=inward*(o.swingSide==='outward'?-1:1),angle=(o.swingAngle??90)*Math.PI/180,right=o.hingeSide==='end',hinge=right?w:0,leaf={x:hinge+(right?-1:1)*w*Math.cos(angle),y:sign*direction*w*Math.sin(angle)},closed=right?0:w,opening=subsegment(wall.segment,segmentTAtLength(wall.segment,o.offset),segmentTAtLength(wall.segment,o.offset+o.width)),color=/^#[a-fA-F0-9]{6}$/.test(o.color??'')?o.color:'#a32b2b';
  return `<g fill="none" stroke="${color}"><g transform="scale(${scale} ${sign*scale})"><path d="${segmentSvg(opening)}" stroke-width="5" vector-effect="non-scaling-stroke"/></g><g transform="translate(${p.x*scale} ${sign*p.y*scale}) rotate(${sign*p.angle})">${o.visualPath?`<g transform="scale(${scale} ${sign*scale})"><path d="${compileVectorPath(openingPath(room,o)).svg}" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"/></g>`:o.kind==='door'?`<path d="M${hinge} 0L${leaf.x} ${leaf.y}M${closed} 0A${w} ${w} 0 0 ${(sign*direction>0)!==right?1:0} ${leaf.x} ${leaf.y}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`:`<path d="M0 -4H${w}M0 4H${w}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`}</g></g>`;
}
