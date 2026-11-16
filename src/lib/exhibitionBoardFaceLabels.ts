import {touchingBoardRuns} from './exhibitionBoards.ts';
import type {BoardGroup} from './exhibitionTypes.ts';
/** Display labels only: stored face IDs and back-side geometry remain A/B. */
export function boardFaceLabels(groups:BoardGroup[]) {
  const letters=(index:number)=>{let result='';for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
  const result=new Map<string,{A:string;B:string}>();
  touchingBoardRuns(groups).forEach((run,index)=>{const pair={A:letters(index*2),B:letters(index*2+1)};for(const group of run)result.set(group.id,pair);});
  return result;
}
