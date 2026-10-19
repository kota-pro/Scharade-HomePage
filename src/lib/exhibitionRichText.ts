import type { RichTextRun, RoomAnnotation } from './exhibitionTypes.ts';
export type TextMeasure=(text:string,size:number,bold:boolean)=>number;
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
let context:CanvasRenderingContext2D|null|undefined;
export const measureLayoutText:TextMeasure=(text,size,bold)=>{
  if(typeof document!=='undefined'){context??=document.createElement('canvas').getContext('2d');if(context){context.font=`${bold?'700':'400'} ${size}px "Zen Old Mincho"`;return context.measureText(text).width;}}
  return Array.from(text).reduce((n,c)=>n+(/[\u0020-\u007e]/.test(c)?.6:1)*size,0);
};
export const annotationRuns=(a:RoomAnnotation):RichTextRun[]=>a.runs??[{text:a.text,color:a.color}];
export function richTextLayout(runs:RichTextRun[],size:number,measure:TextMeasure=measureLayoutText) {
  let x=0,y=size,width=0;const chunks:(RichTextRun&{x:number;y:number;width:number})[]=[];
  for(const run of runs){const parts=run.text.split('\n');parts.forEach((text,i)=>{if(i){width=Math.max(width,x);x=0;y+=size*1.3;}if(text){const advance=measure(text,size,!!run.bold);chunks.push({...run,text,x,y,width:advance});x+=advance;}});}width=Math.max(width,x);
  return{chunks,width:Math.max(.01,width),height:y+size*.3};
}
export function normalizeRichText(runs:RichTextRun[]):RichTextRun[] {
  const result:RichTextRun[]=[];for(const run of runs){if(!run.text)continue;const style={...(run.bold?{bold:true}:{}),...(run.italic?{italic:true}:{}),...(run.underline?{underline:true}:{}),...(run.color?{color:run.color}:{})},previous=result.at(-1);if(previous&&JSON.stringify({...previous,text:undefined})===JSON.stringify(style))previous.text+=run.text;else result.push({...style,text:run.text});}return result;
}
export function styleTextRange(a:RoomAnnotation,start:number,end:number,style:Partial<Omit<RichTextRun,'text'>>) {
  const all=annotationRuns(a),total=all.map(r=>r.text).join('').length;start=Math.max(0,Math.min(total,start));end=Math.max(start,Math.min(total,end));if(start===end)return;
  let offset=0;const next:RichTextRun[]=[];for(const run of all){const left=Math.max(0,start-offset),right=Math.min(run.text.length,end-offset);if(left<right){if(left)next.push({...run,text:run.text.slice(0,left)});next.push({...run,...style,text:run.text.slice(left,right)});if(right<run.text.length)next.push({...run,text:run.text.slice(right)});}else next.push({...run});offset+=run.text.length;}a.runs=normalizeRichText(next);a.text=a.runs.map(r=>r.text).join('');
}
export function replaceRichText(a:RoomAnnotation,text:string,typingStyle:Partial<Omit<RichTextRun,'text'>>={}) {
  const old=a.text;let start=0,end=0;while(start<Math.min(old.length,text.length)&&old[start]===text[start])start++;
  while(end<old.length-start&&end<text.length-start&&old[old.length-1-end]===text[text.length-1-end])end++;
  const runs=annotationRuns(a),slice=(from:number,to:number)=>{let offset=0;return runs.flatMap(run=>{const begin=Math.max(0,from-offset),finish=Math.min(run.text.length,to-offset);offset+=run.text.length;return finish>begin?[{...run,text:run.text.slice(begin,finish)}]:[];});};
  const prefix=slice(0,start),suffix=slice(old.length-end,old.length),inherited=prefix.at(-1)??suffix[0]??{text:'',color:a.color},insert=text.slice(start,text.length-end);
  a.runs=normalizeRichText([...prefix,...insert?[{...inherited,...typingStyle,text:insert}]:[],...suffix]);a.text=text;
}
export function richTextSvg(a:RoomAnnotation,measure:TextMeasure=measureLayoutText,outline?:(text:string,size:number,bold:boolean)=>string) {
  const layout=richTextLayout(annotationRuns(a),a.fontSize,measure);
  return `<g data-layout-rich-text="" transform="scale(${a.textScaleX??1} ${a.textScaleY??1})">${layout.chunks.map(run=>{const color=run.color??a.color??'#343434',glyphs=outline?outline(run.text,a.fontSize,!!run.bold):`<text x="0" y="0" font-family="Zen Old Mincho" font-size="${a.fontSize}" font-weight="${run.bold?700:400}">${escape(run.text)}</text>`;return `<g transform="translate(${run.x} ${run.y})" fill="${color}"><g${run.italic?' transform="skewX(-12)"':''}>${glyphs}</g>${run.underline?`<path d="M0 ${a.fontSize*.1}H${run.width}" fill="none" stroke="${color}" stroke-width="${a.fontSize/18}"/>`:''}</g>`;}).join('')}</g>`;
}
