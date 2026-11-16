import { fitBoardCaption, captionTypography, layoutBoardMetadata, wrapBoardText,wrapBoardMetadata, type TextMeasure } from './exhibitionText.ts';
import { photographyMarkFrame, titleBoardSettings, titleRightMm, titleRubyRows, titleOriginMm } from './exhibitionTitleText.ts';
import type { SubmissionContent, Work } from './exhibitionTypes.ts';

export const boardElements = ['title','author','grade','caption','location','equipment','settings','qr'] as const;
export type BoardElement = typeof boardElements[number];
export const boardElementLabels: Record<BoardElement,string> = {title:'タイトル・ふりがな',author:'作者名',grade:'学年',caption:'キャプション',location:'撮影場所',equipment:'使用機材',settings:'撮影設定',qr:'QRコード'};
export type BoardFrame = { x:number; y:number; width:number; height:number; fontSize:number; lineHeight:number };
export type BoardDesign = Partial<Record<BoardElement,BoardFrame>>;
export type BoardDesignIssue = { element:BoardElement; message:string };
export type BoardRun = { element:BoardElement; text:string; x:number; y:number; size:number; bold:boolean };
const mm = 25.4/72;

const photographyViewBox = 38.43;
const photographyArtwork = `
  <g fill="none" stroke="#040000" stroke-width=".5">
    <circle cx="19.23" cy="21.31" r="3.77"/>
    <path d="M19.23,26.36c2.36,0,6.43,0,8.79,0,.64,0,.78-.15.77-.81,0-2.38,0-7.82,0-10.23-.01-.27-.02-.53-.25-.67-.2-.14-.81-.14-1.16-.15-.56,0-1.3,0-1.93,0-.55,0-1.01-.01-1.32-.15-1.03-.42-.19-2.21-1.51-2.27-1.94-.05-4.84-.03-6.69,0-.67.02-.89.38-.96.96-.09.77-.25,1.36-1.13,1.43-.83.07-1.8.02-2.63.04-.41.01-.87-.02-1.25.11-.32.13-.31.47-.32.78,0,2.83,0,8.25,0,10.96"/>
    <path d="M19.24,26.35c-2.61.03-4.87-2.1-5-4.69-.29-3.76,3.77-6.5,7.15-4.85,1.74.83,2.87,2.57,2.87,4.53"/>
    <rect x="11.17" y="13.22" width="2.04" height=".83" rx=".35" ry=".35"/>
    <line x1="10.66" y1="16.26" x2="10.66" y2="25.11"/>
  </g>
  <g fill="none" stroke="#c30d23" stroke-miterlimit="10" stroke-width="4">
    <circle cx="19.22" cy="19.22" r="17.22"/>
    <line x1="8.09" y1="30.35" x2="30.35" y2="8.09"/>
  </g>`;
export function photographyMarkSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${photographyViewBox} ${photographyViewBox}">${photographyArtwork}</svg>`;
}

/** Only physical layout is stored here. Submitted text, photos and QR targets stay authoritative. */
export function parseBoardDesign(value:unknown):BoardDesign {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('配置の入力形式を確認してください。');
  const result:BoardDesign={};
  for(const [key,raw]of Object.entries(value)) {
    if(!boardElements.includes(key as BoardElement)||!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('配置する項目を確認してください。');
    const frame={} as BoardFrame;
    for(const field of ['x','y','width','height','fontSize','lineHeight'] as const) {
      const v=(raw as Record<string,unknown>)[field],max=field==='fontSize'?48:field==='lineHeight'?30:150;
      const min=field==='x'||field==='y'?-105:field==='fontSize'?4:.1;
      if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error(`${boardElementLabels[key as BoardElement]}の数値を確認してください。`);
      frame[field]=Math.round(v*1000)/1000;
    }
    if(key==='qr'&&Math.abs(frame.width-frame.height)>.01)throw new Error('QRコードの幅と高さは同じ値にしてください。');
    result[key as BoardElement]=frame;
  }
  return result;
}

export function boardDesignScene(content:SubmissionContent,work:Work,measure:TextMeasure,design:BoardDesign={}) {
  const caption=fitBoardCaption(work.caption,measure),metadata=layoutBoardMetadata(work,measure);
  const titleSettings=titleBoardSettings(work);
  const titleX=titleSettings.quoted?titleOriginMm:8;
  const photographyMark=titleSettings.noPhotography?photographyMarkFrame:undefined;
  const frame=(x:number,y:number,width:number,height:number,fontSize:number,lineHeight:number):BoardFrame=>({x,y,width,height,fontSize,lineHeight});
  const authorWidth=Math.max(1,measure(content.authorName,14)),gradeWidth=Math.max(1,measure(content.grade,10));
  const frames:Record<BoardElement,BoardFrame>={
    title:frame(titleX,8.5,titleRightMm(work)-titleX,8.2,21,8.2),
    author:frame(8,23,authorWidth,5.5,14,5.5), grade:frame(8+authorWidth+6.5,24.1,gradeWidth,4,10,4),
    caption:frame(8,captionTypography.topMm,89,captionTypography.heightMm,caption.fontSize,caption.lineHeightMm),
    location:frame(8,50,68.4,6.17,8,6.17),equipment:frame(8,56.17,68.4,6.17,8,6.17),settings:frame(8,62.34,68.4,6.17,8,6.17),
    qr:frame(79,49.25,18,18,8,6.17),
  };
  metadata.items.forEach(item=>{frames[item.key].y=50+item.startRow*6.17;frames[item.key].height=Math.max(6.17,item.lines.length*6.17);});
  for(const key of boardElements)if(design[key])frames[key]={...design[key]!};
  const runs:BoardRun[]=[],issues:BoardDesignIssue[]=[],active:BoardElement[]=[];
  const issue=(element:BoardElement,message:string)=>{if(!issues.some(i=>i.element===element&&i.message===message))issues.push({element,message});};
  const add=(element:BoardElement,text:string,x:number,y:number,size:number,bold=false)=>{if(text)runs.push({element,text,x,y,size,bold});};
  for(const element of boardElements) {
    const f=frames[element];
    const value=element==='title'?(titleSettings.quoted?`「${work.title}」`:work.title):element==='author'?content.authorName:element==='grade'?content.grade:element==='qr'?'QR':work[element];
    if(!value)continue;
    active.push(element);
    if(f.x<0||f.y<0||f.x+f.width>105+.01||f.y+f.height>74.25+.01)issue(element,'タイトルボードの外にはみ出しています。');
    if(element==='qr'){if(f.width<12)issue(element,'QRコードは読み取りのため12mm以上にしてください。');continue;}
    const metadataLabel=element==='location'?'撮影場所':element==='equipment'?'使用機材':element==='settings'?'撮影設定':'';
    const indent=metadataLabel?Math.min(17.4,f.width*.4):0;
    const lines=metadataLabel?wrapBoardMetadata(value,measure,Math.max(.1,f.width-indent),f.fontSize):wrapBoardText(value,f.fontSize,Math.max(.1,f.width-indent),measure,element==='title');
    if(lines.some(line=>measure(line,f.fontSize,element==='title')>f.width-indent+.01)||metadataLabel&&measure(metadataLabel,f.fontSize,true)>indent+.01)issue(element,'文字が指定した枠の幅に収まりません。');
    if((lines.length-1)*f.lineHeight+f.fontSize*mm>f.height+.01)issue(element,'文字が指定した枠の高さに収まりません。');
    if(lines.length>1&&f.lineHeight<f.fontSize*mm)issue(element,'行間が狭く文字が重なっています。');
    if(metadataLabel)add(element,metadataLabel,f.x,f.y,f.fontSize,true);
    lines.forEach((line,i)=>add(element,line,f.x+indent,f.y+i*f.lineHeight,f.fontSize,element==='title'));
    if(element==='title'&&titleSettings.rubyEnabled) {
      const quote=titleSettings.quoted?1:0,chars=Array.from(value),positions:{x:number;y:number;line:number}[]=[];
      let offset=0;
      lines.forEach((line,index)=>{for(let i=0;i<Array.from(line).length;i++)positions[offset+i]={x:f.x+measure(Array.from(line).slice(0,i).join(''),f.fontSize,true),y:f.y+index*f.lineHeight,line:index};offset+=Array.from(line).length;});
      let last:{right:number;line:number}|undefined;
      for(const ruby of titleRubyRows(work).filter(r=>r.reading)) {
        const start=positions[ruby.start+quote],end=positions[ruby.end-1+quote];if(!start||!end)continue;
        if(start.line!==end.line){issue('title','ふりがなの対象語句が改行をまたいでいます。');continue;}
        const size=7*f.fontSize/21,width=measure(ruby.reading,size),baseWidth=measure(chars.slice(ruby.start+quote,ruby.end+quote).join(''),f.fontSize,true),x=start.x+(baseWidth-width)/2,y=start.y-.5;
        if(x<0||x+width>105)issue('title','ふりがながタイトルボードの外にはみ出しています。');
        if(last&&last.line===start.line&&x<last.right-.01)issue('title','ふりがなが重なっています。');
        last={right:x+width,line:start.line};add('title',ruby.reading,x,y,size);
      }
    }
  }
  const boxes=active.map(element=>{
    const f=frames[element],own=runs.filter(r=>r.element===element);
    return {element,x:element==='qr'?f.x:Math.min(...own.map(r=>r.x),f.x),y:element==='qr'?f.y:Math.min(...own.map(r=>r.y),f.y),right:element==='qr'?f.x+f.width:Math.max(f.x,...own.map(r=>r.x+measure(r.text,r.size,r.bold))),bottom:element==='qr'?f.y+f.height:Math.max(f.y,...own.map(r=>r.y+r.size*mm))};
  });
  const printed=(element:BoardElement)=>element==='qr'?[boxes.find(b=>b.element==='qr')!]:runs.filter(r=>r.element===element).map(r=>({x:r.x,y:r.y,right:r.x+measure(r.text,r.size,r.bold),bottom:r.y+r.size*mm}));
  const overlaps=(a:ReturnType<typeof printed>[number],b:ReturnType<typeof printed>[number])=>
    Math.min(a.right,b.right)-Math.max(a.x,b.x)>.15&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>.15;
  for(const box of boxes){if(box.right>105+.01||box.bottom>74.25+.01||box.x<-.01||box.y<-.01)issue(box.element,'文字または画像が印刷範囲の外にはみ出しています。');}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++) {
    const a=boxes[i],b=boxes[j];
    if(printed(a.element).some(aa=>printed(b.element).some(bb=>overlaps(aa,bb)))){issue(a.element,`${boardElementLabels[b.element]}と重なっています。`);issue(b.element,`${boardElementLabels[a.element]}と重なっています。`);}
  }
  if(photographyMark) {
    const {x,y,size}=photographyMark;
    const bounds={x,y,right:x+size,bottom:y+size};
    for(const element of active)if(printed(element).some(box=>overlaps(box,bounds)))issue(element,'撮影NGアイコンと重なっています。');
  }
  return {frames,runs,issues,active,photographyMark};
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function boardDesignSvg(scene:ReturnType<typeof boardDesignScene>,qrImage:string) {
  const f=scene.frames.qr;
  const mark=scene.photographyMark;
  const markSvg=mark?`<g data-photography-mark="" role="img" aria-label="撮影NG" transform="translate(${mark.x} ${mark.y}) scale(${mark.size/photographyViewBox})">${photographyArtwork}</g>`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="105mm" height="74.25mm" viewBox="0 0 105 74.25"><rect width="105" height="74.25" fill="white"/><g font-family="Zen Old Mincho" fill="#211c1a">${scene.runs.map(r=>`<text data-board-element="${r.element}" x="${r.x}" y="${r.y+r.size*mm}" font-size="${r.size*mm}" font-weight="${r.bold?700:400}">${escape(r.text)}</text>`).join('')}</g>${qrImage?`<image data-board-element="qr" x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" href="${escape(qrImage)}"/>`:''}${markSvg}</svg>`;
}
