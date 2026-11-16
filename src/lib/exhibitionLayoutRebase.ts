import {applyLayoutChanges,layoutChangeValue,sameLayoutValue} from './exhibitionLayoutChanges.ts';
import type {LayoutChange,RoomLayout} from './exhibitionTypes.ts';
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function merge(before:unknown,after:unknown,current:unknown,preferLocal:boolean):unknown{
 if(sameLayoutValue(before,after))return structuredClone(current);
 if(sameLayoutValue(current,before)||sameLayoutValue(current,after))return structuredClone(after);
 if(plain(before)&&plain(after)&&plain(current)){
  const result=structuredClone(current);
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   if(['__proto__','prototype','constructor'].includes(key)||sameLayoutValue(before[key],after[key]))continue;
   const value=merge(before[key],after[key],current[key],preferLocal);if(value===undefined)delete result[key];else result[key]=value;
  }
  return result;
 }
 if(preferLocal)return structuredClone(after);
 throw new Error('同じ項目に別の編集があります。変更はこの端末に保存しています。');
}
/** Preserve remote-only fields; replacing the same field requires the recovery button. */
export function rebaseLayoutChanges(rooms:RoomLayout[],changes:LayoutChange[],preferLocal=false){
 const result:LayoutChange[]=[];
 for(const c of changes){const before=layoutChangeValue(rooms,c),after=merge(c.before,c.after,before,preferLocal);if(!sameLayoutValue(before,after))result.push({...structuredClone(c),before:structuredClone(before),after});}
 return{changes:result,rooms:result.length?applyLayoutChanges(rooms,result):rooms};
}
