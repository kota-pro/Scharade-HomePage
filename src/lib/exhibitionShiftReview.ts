import type {ShiftGenerationInput,ShiftPerson,ShiftRecord} from './exhibitionShiftTypes.ts';

const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const ordered=<T extends {id:string}>(values:T[])=>[...values].sort((a,b)=>a.id.localeCompare(b.id));
const availability=(values:Record<string,string[]>)=>Object.entries(values).sort(([a],[b])=>a.localeCompare(b)).map(([id,slots])=>[id,[...slots].sort()]);

/** Explain only changes for which the saved generation/publication is the exact baseline. */
export function shiftReviewReasons(record:ShiftRecord,input:ShiftGenerationInput,key:string) {
  const reasons:string[]=[];
  const people=(old:ShiftPerson[])=>{
    if(!same(old.map(p=>p.id).sort(),input.people.map(p=>p.id).sort()))reasons.push('対象会員');
    const before=new Map(old.map(p=>[p.id,p]));
    if(input.people.some(p=>{const previous=before.get(p.id);return previous&&(previous.name!==p.name||previous.lineName!==p.lineName||previous.grade!==p.grade);}))reasons.push('会員の表示情報');
  };
  const job=record.job;
  if(job&&job.sourceKey===key) {
    if(!same(job.input.slots,input.slots))reasons.push('開催期間・展示時間');
    if(!same(availability(job.input.availability),availability(input.availability)))reasons.push('希望回答');
    if(!same(job.input.rules,input.rules))reasons.push('割り当て条件');
    if(!same(ordered(job.input.fixed),ordered(input.fixed)))reasons.push('固定した配置');
    people(job.input.people);
  } else if(record.published?.sourceKey===key) {
    const published=record.published;
    if(!same(published.slots,input.slots))reasons.push('開催期間・展示時間');
    if(!same(published.rules,input.rules))reasons.push('割り当て条件');
    people(published.people);
  }
  return [...new Set(reasons)];
}
