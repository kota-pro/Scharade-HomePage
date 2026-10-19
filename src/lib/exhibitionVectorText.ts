import fs from 'node:fs';import path from 'node:path';import fontkit from '@pdf-lib/fontkit';
import type {RoomAnnotation} from './exhibitionTypes.ts';
import {richTextSvg,annotationRuns,type TextMeasure} from './exhibitionRichText.ts';
let fonts:any[]|undefined;
const font=(bold:boolean)=>{fonts??=['Regular','Bold'].map(weight=>fontkit.create(fs.readFileSync(path.join(process.cwd(),`public/fonts/zen-old-mincho/ZenOldMincho-${weight}.ttf`))));return fonts[bold?1:0];};
export const measureVectorText:TextMeasure=(text,size,bold)=>{const f=font(bold),run=f.layout(text);return run.positions.reduce((sum:number,p:any)=>sum+p.xAdvance,0)*size/f.unitsPerEm;};
export function glyphOutlines(text:string,size:number,bold:boolean) {
  const f=font(bold),run=f.layout(text),factor=size/f.unitsPerEm;let x=0,y=0;
  return run.glyphs.map((glyph:any,i:number)=>{const position=run.positions[i],d=glyph.path.toSVG(),result=d?`<path transform="translate(${(x+position.xOffset)*factor} ${-(y+position.yOffset)*factor}) scale(${factor} ${-factor})" d="${d}"/>`:'';x+=position.xAdvance;y+=position.yAdvance;return result;}).join('');
}
export const outlinedAnnotationText=(a:RoomAnnotation)=>richTextSvg(a,measureVectorText,glyphOutlines);
export function vectorTextIssues(a:RoomAnnotation) {
  const missing=new Set<string>();for(const run of annotationRuns(a)){const f=font(!!run.bold);for(const c of Array.from(run.text))if(c!=='\n'&&!f.hasGlyphForCodePoint(c.codePointAt(0)))missing.add(c);}return missing.size?[`フォントにない文字があります：${[...missing].join(' ')}`]:[];
}
