import type {RoomAnnotation} from './exhibitionTypes.ts';
import {annotationRuns,richTextLayout} from './exhibitionRichText.ts';

/** Geometry remains in mm; typographic controls use physical points (1 pt = 1/72 inch). */
export const mmToPoints=(mm:number)=>mm*72/25.4;
export const pointsToMm=(points:number)=>points*25.4/72;
export const displayPoints=(mm:number)=>Math.round(mmToPoints(mm)*100)/100;
export function readPointSize(value:number,minMm:number,maxMm:number,label='文字サイズ') {
  if(!Number.isFinite(value)||value<displayPoints(minMm)||value>displayPoints(maxMm))throw new Error(`${label}は${displayPoints(minMm)}〜${displayPoints(maxMm)}ptで入力してください。`);
  // Rounding an existing limit for display must not make that same limit invalid.
  return Math.min(maxMm,Math.max(minMm,pointsToMm(value)));
}
export function setLayoutTextSize(a:RoomAnnotation,size:number) {
  if(!Number.isFinite(size)||size<.1||size>3000)throw new Error(`文字サイズは${displayPoints(.1)}〜${displayPoints(3000)}ptで入力してください。`);
  a.fontSize=size;
  const bounds=richTextLayout(annotationRuns(a),size);
  a.width=bounds.width*(a.textScaleX??1);a.height=bounds.height*(a.textScaleY??1);
}
/** New resizing changes type size, never adds horizontal/vertical distortion. */
export function scaleLayoutText(a:RoomAnnotation,factor:number) {
  if(!Number.isFinite(factor)||factor<=0)throw new Error('文字の拡大率を確認してください。');
  const sx=a.textScaleX??1,sy=a.textScaleY??1;
  // Absorb old uniform scaling while retaining any pre-existing distortion.
  let uniform=sy;
  if(sx/uniform<.01||sx/uniform>100||a.fontSize*factor*uniform<.1||a.fontSize*factor*uniform>3000)uniform=1;
  const size=a.fontSize*factor*uniform;
  if(size<.1||size>3000)throw new Error(`文字サイズは${displayPoints(.1)}〜${displayPoints(3000)}ptの範囲で拡大縮小してください。`);
  const x=sx/uniform,y=sy/uniform;
  if(Math.abs(x-1)<1e-10)delete a.textScaleX;else a.textScaleX=x;
  if(Math.abs(y-1)<1e-10)delete a.textScaleY;else a.textScaleY=y;
  setLayoutTextSize(a,size);
}
