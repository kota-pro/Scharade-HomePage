import type {ShiftGenerationInput,ShiftGenerationResult} from '../src/lib/exhibitionShiftTypes.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeData } from '../src/lib/store.ts';
import { exhibitionAction, readExhibitions, updateExhibitionStore } from '../src/lib/exhibitions.ts';
import { memberShiftData, memberShiftAction, staffShiftAction, staffShiftData } from '../src/lib/exhibitionShifts.ts';
import { readShiftStore, updateShiftStore } from '../src/lib/exhibitionShiftStore.ts';
import { shiftSlots, parseOpeningSchedule } from '../src/lib/exhibitionShiftSchedule.ts';
import { exhibitionCalendarEntries } from '../src/lib/exhibitionCalendar.ts';
import { drainShiftGeneration, runShiftSolver } from '../src/lib/exhibitionShiftJobs.ts';
import { solveShifts } from '../scripts/exhibition-shift-solver.mjs';
import { deleteExhibition } from '../src/lib/exhibitionDeletion.ts';
import { drainShiftDeliveries } from '../src/lib/exhibitionShiftDelivery.ts';
import { readActivities } from '../src/lib/activities.ts';
const schedule={startDate:'2026-12-31',endDate:'2027-01-01',regular:{open:'10:30',close:'13:00'},first:{open:'11:00',close:'12:30'},last:{open:'09:00',close:'10:00'}};
async function fixture(run:(id:string,staff:(v:any)=>Promise<any>)=>Promise<void>) {
  const old=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-shifts-'));process.env.DATA_DIR=dir;
  try {writeData('users.json',['staff','author','optional','uninvited'].map(id=>({id,name:id,email:`${id}@example.invalid`,role:id==='staff'?'staff':'member',approved:true,createdAt:'2026-01-01',providers:{}})).concat([{id:'blocked',name:'blocked',email:'blocked@example.invalid',role:'member',approved:false,createdAt:'2026-01-01',providers:{}}]));
    const e=(await exhibitionAction('staff',{action:'create',title:'シフト試験',openingSchedule:schedule})).exhibition;
    await updateExhibitionStore(store=>{const e=store.exhibitions[0];e.participation={state:'published',recipientIds:['author'],opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+60000).toISOString(),votes:{author:{value:'attending',at:new Date().toISOString(),actorId:'author'}}};});
    const staff=async(v:any)=>staffShiftAction(e.id,'staff',{revision:staffShiftData(e.id,'staff').record.revision,...v});
    await staff({action:'settings',config:{state:'open',opensAt:new Date(Date.now()-60000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString(),rules:{together:[],apart:[]}}});
    await run(e.id,staff);
  } finally {if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
}
test('Tokyo dates, first/last overrides, one-day and final partial slot are exact',()=>{
  assert.deepEqual(shiftSlots(parseOpeningSchedule(schedule)).map(s=>[s.date,s.start,s.end,s.minutes]),[['2026-12-31','11:00','12:00',60],['2026-12-31','12:00','12:30',30],['2027-01-01','09:00','10:00',60]]);
  const one=parseOpeningSchedule({...schedule,endDate:schedule.startDate});assert.equal(one.last,undefined);assert.equal(shiftSlots(one).length,2);
  assert.throws(()=>parseOpeningSchedule({...schedule,startDate:'2026-02-30'}));assert.throws(()=>parseOpeningSchedule({...schedule,regular:{open:'18:00',close:'10:00'}}));
});
test('all members can answer without invitation; exhibitors must submit layout first; own data only',()=>fixture(async(id)=>{
  assert.equal(memberShiftData(id,'uninvited').canSubmit,true);assert.equal(memberShiftData(id,'author').canSubmit,false);assert.throws(()=>memberShiftData(id,'blocked'));
  const send=(user:string,content:any,action='submit',revision=0)=>memberShiftAction(id,user,{action,ownerId:user,scheduleKey:memberShiftData(id,user).scheduleKey,revision,content});
  await assert.rejects(send('author',{none:true,slotIds:[]}),/レイアウト/);
  await send('uninvited',{none:true,slotIds:[]});assert.equal(memberShiftData(id,'uninvited').response?.submitted?.none,true);
  await assert.rejects(send('optional',{none:true,slotIds:[memberShiftData(id,'optional').slots[0].id]}));
  await assert.rejects(send('optional',{none:false,slotIds:[]}));await send('optional',{none:false,slotIds:[]},'save');
  await assert.rejects(send('optional',{none:true,slotIds:[]}),error=>(error as any).status===409);
  await updateExhibitionStore(store=>{store.submissions.push({id:crypto.randomUUID(),exhibitionId:id,userId:'author',inactive:false,versions:[{version:1}],revision:0} as any);});
  assert.equal(memberShiftData(id,'author').canSubmit,true);await send('author',{none:true,slotIds:[]});
  const member:any=memberShiftData(id,'uninvited');assert.equal(member.record,undefined);assert.equal(member.people,undefined);assert.equal(member.availability,undefined);
  await assert.rejects(staffShiftAction(id,'optional',{action:'guest',name:'illegal'}));
  const calendar=exhibitionCalendarEntries(readExhibitions().exhibitions,'uninvited');assert.deepEqual(calendar.map(e=>e.kind),['exhibition-shift']);
}));
test('manual additions accept unanswered members and reusable typed names without forging form submissions',()=>fixture(async(id,staff)=>{
  const before=JSON.stringify(readExhibitions().submissions);const slotId=staffShiftData(id,'staff').slots[0].id;
  await staff({action:'guest',name:'案内係'});let d=staffShiftData(id,'staff');const guest=d.record.guests[0];await staff({action:'guest',name:'案内係'});assert.equal(staffShiftData(id,'staff').record.guests.length,1);
  const assignments=[{id:'manual1',personId:'uninvited',slotId,fixed:true,manual:true},{id:'manual2',personId:guest.id,slotId,fixed:true,manual:true}];
  await assert.rejects(staff({action:'plan.save',planRevision:d.record.plan.revision,assignments}),error=>(error as any).status===422);
  await staff({action:'plan.save',planRevision:d.record.plan.revision,assignments,confirmWarnings:true,review:true});d=staffShiftData(id,'staff');
  assert.equal(d.record.plan.reviewed,true);
  assert.equal(d.record.plan.assignments.length,2);assert.equal(d.record.plan.assignments.every(a=>a.fixed&&a.manual),true);assert.equal(d.record.responses.length,0);assert.equal(JSON.stringify(readExhibitions().submissions),before);
  await assert.rejects(staff({action:'plan.save',planRevision:d.record.plan.revision,assignments:[...assignments,{id:'manual3',personId:'optional',slotId}],confirmWarnings:true}),/2人/);
  await assert.rejects(staff({action:'plan.save',planRevision:d.record.plan.revision,assignments:[assignments[0],{...assignments[0],id:'copy'}],confirmWarnings:true}),/重複/);
  await staff({action:'plan.save',planRevision:d.record.plan.revision,assignments,confirmWarnings:true});d=staffShiftData(id,'staff');
  assert.equal(d.record.plan.reviewed,undefined);
  await staff({action:'plan.save',planRevision:d.record.plan.revision,assignments,confirmWarnings:true,review:true});
  await staff({action:'generate'});await drainShiftGeneration();d=staffShiftData(id,'staff');assert.equal(d.record.job?.state,'ready');assert.deepEqual(d.record.plan.assignments.map(a=>a.personId).sort(),['uninvited',guest.id].sort());
  assert.equal(d.record.plan.reviewed,undefined);
  await staff({action:'publish',planRevision:d.record.plan.revision,confirmMissing:true});
  const published:any=memberShiftData(id,'optional').published;assert.equal(published.assignments.length,2);assert.equal(published.people.find((p:any)=>p.id==='uninvited').lineName,undefined);
  assert.ok(published.assignments.every((assignment:object)=>!('manual' in assignment)));
  await drainShiftDeliveries();assert.equal(readActivities().notifications.filter(n=>n.kind==='exhibition-shift').length,1);
  await drainShiftDeliveries();assert.equal(readActivities().notifications.filter(n=>n.kind==='exhibition-shift').length,1);
}));
test('closed intake reopens, schedule changes need reconfirmation, published plan survives answer changes',()=>fixture(async(id,staff)=>{
  let d=memberShiftData(id,'optional');await memberShiftAction(id,'optional',{action:'submit',ownerId:'optional',scheduleKey:d.scheduleKey,revision:0,content:{none:false,slotIds:[d.slots[0].id]}});
  await staff({action:'generate'});await drainShiftGeneration();let s=staffShiftData(id,'staff');await staff({action:'publish',planRevision:s.record.plan.revision,confirmMissing:true});const old=JSON.stringify(staffShiftData(id,'staff').record.published);
  d=memberShiftData(id,'optional');await memberShiftAction(id,'optional',{action:'submit',ownerId:'optional',scheduleKey:d.scheduleKey,revision:d.response!.revision,content:{none:true,slotIds:[]}});
  assert.equal(JSON.stringify(staffShiftData(id,'staff').record.published),old);assert.equal(staffShiftData(id,'staff').publishedNeedsReview,true);
  s=staffShiftData(id,'staff');await staff({action:'settings',config:{...s.record.config,state:'closed'}});assert.equal(memberShiftData(id,'optional').canSubmit,false);
  await staff({action:'settings',config:{...s.record.config,state:'open'}});assert.equal(memberShiftData(id,'optional').canSubmit,true);
  s=staffShiftData(id,'staff');await staff({action:'schedule',exhibitionRevision:s.exhibition.revision,openingSchedule:{...schedule,regular:{open:'10:00',close:'11:00'}}});assert.equal(memberShiftData(id,'optional').needsReview,true);assert.equal(staffShiftData(id,'staff').availability.optional,undefined);
}));
test('regeneration after changed opening times removes obsolete slots while preserving published assignments',()=>fixture(async(id,staff)=>{
  let d=staffShiftData(id,'staff');await staff({action:'plan.save',planRevision:d.record.plan.revision,assignments:[{id:'old-fixed',personId:'optional',slotId:d.slots[0].id}],confirmWarnings:true});
  d=staffShiftData(id,'staff');await staff({action:'publish',planRevision:d.record.plan.revision,confirmMissing:true});const published=JSON.stringify(staffShiftData(id,'staff').record.published);
  d=staffShiftData(id,'staff');await staff({action:'schedule',exhibitionRevision:d.exhibition.revision,openingSchedule:{startDate:'2027-02-01',endDate:'2027-02-01',regular:{open:'13:00',close:'14:00'}}});
  await staff({action:'generate'});await drainShiftGeneration();d=staffShiftData(id,'staff');assert.equal(d.record.job?.state,'ready');assert.deepEqual(d.record.plan.assignments,[]);assert.equal(JSON.stringify(d.record.published),published);
}));
test('zero responses yields an empty, publishable board; apart pairs remain hard in manual edit',()=>fixture(async(id,staff)=>{
  await staff({action:'generate'});await drainShiftGeneration();let d=staffShiftData(id,'staff');assert.deepEqual(d.record.plan.assignments,[]);assert.equal(d.record.job?.state,'ready');
  await assert.rejects(staff({action:'publish',planRevision:d.record.plan.revision}),error=>(error as any).status===422);
  await staff({action:'publish',planRevision:d.record.plan.revision,confirmMissing:true});
  await staff({action:'settings',config:{...d.record.config,rules:{together:[],apart:[['uninvited','optional']]}}});d=staffShiftData(id,'staff');
  await assert.rejects(staff({action:'plan.save',planRevision:d.record.plan.revision,confirmWarnings:true,assignments:['uninvited','optional'].map((personId,i)=>({id:'a'+i,slotId:d.slots[0].id,personId}))}),/禁止ペア/);
}));
test('concurrent edits cannot overwrite newer plans; a generation snapshot becomes stale',()=>fixture(async(id,staff)=>{
  const old=staffShiftData(id,'staff');await staff({action:'guest',name:'先の編集'});await assert.rejects(staffShiftAction(id,'staff',{action:'guest',name:'後の編集',revision:old.record.revision}),error=>(error as any).status===409);
  await staff({action:'generate'});const d=staffShiftData(id,'staff');await staff({action:'plan.save',planRevision:d.record.plan.revision,assignments:[]});await drainShiftGeneration();assert.equal(staffShiftData(id,'staff').record.job?.state,'stale');
}));
test('deletion backs up and removes shift data while adding its sheet to the owned cleanup',()=>fixture(async(id,staff)=>{
  await staff({action:'guest',name:'バックアップ対象'});await updateShiftStore(store=>{store.records[0].sync.spreadsheetId='shift_sheet_owned_123456789';});
  const e=readExhibitions().exhibitions[0];await deleteExhibition('staff',id,e.revision,e.title);assert.equal(readShiftStore().records.length,0);const deletion=readExhibitions().deletions![0];assert.equal(deletion.fileIds.includes('shift_sheet_owned_123456789'),true);assert.equal(JSON.parse(fs.readFileSync(path.join(deletion.backupDir,'exhibition.json'),'utf8')).shifts.guests.length,1);
}));
const slots=[0,1,2].map(i=>({id:String(i),date:'2026-11-05',start:`${10+i}:00`,end:`${11+i}:00`,minutes:60,index:i}));
const input=(availability:Record<string,string[]>,rules:any={}):ShiftGenerationInput=>({slots,people:Object.keys(availability).map(id=>({id,name:id})),availability,rules:{together:[],apart:[],...rules},fixed:[]});
test('MIP reserves scarce candidates, covers available seats, then balances loads',async()=>{
  const r=await solveShifts({...input({a:['0','1'],b:['0'],c:['0','1'],d:['1']},{maxTotal:1}),slots:slots.slice(0,2)});assert.equal(r.assignments.length,4);assert.equal(r.optimal,true);
  const b=await solveShifts(input({a:['0','1','2'],b:['0','1','2'],c:['0','1','2']}));const count=['a','b','c'].map(id=>b.assignments.filter((a:any)=>a.personId===id).length);assert.deepEqual(count,[2,2,2]);
});
test('MIP respects hard pairs, total and consecutive limits, and at-least-once soft pairs',async()=>{
  const r=await solveShifts(input({a:['0','1','2'],b:['0','1','2'],c:['0','1','2'],d:['0','1','2']},{maxConsecutive:1,maxTotal:2,apart:[['a','b']],together:[['a','c']]}));
  for(const p of ['a','b','c','d']){const own=r.assignments.filter((a:any)=>a.personId===p).map((a:any)=>Number(a.slotId));assert.equal(own.length<=2,true);assert.equal(own.some((a:number)=>own.includes(a+1)),false);}assert.equal(r.assignments.some((a:any)=>a.personId==='a'&&r.assignments.some((b:any)=>b.slotId===a.slotId&&b.personId==='c')),true);
});
test('manual fixed exceptions survive caps and no response; worker has a bounded fallback',async()=>{
  const i:any=input({a:[],b:['0','1','2']},{maxTotal:1});i.fixed=[{id:'manual',personId:'a',slotId:'0',fixed:true,manual:true,override:true}];const r=await runShiftSolver(i,2000);assert.equal(r.assignments.some(a=>a.id==='manual'),true);assert.equal(r.assignments.filter(a=>a.personId==='b').length,1);
  const bounded=await runShiftSolver(i,1);assert.equal(bounded.optimal,false);assert.equal(bounded.assignments[0].id,'manual');
});

const solve=(input:ShiftGenerationInput):Promise<ShiftGenerationResult>=>solveShifts(input);
test('oversubscribed shifts pair the same grade after coverage and balanced workloads, including equivalent grade labels',async()=>{
 const i=input({a:['0','1'],b:['0','1'],c:['0','1'],d:['0','1']},{maxTotal:1});i.slots=slots.slice(0,2);i.people=i.people.map((p,n)=>({...p,grade:['１年生','1年','2年生','2年'][n]}));
 const result=await solve(i);assert.equal(result.optimal,true);assert.equal(result.assignments.length,4);
 for(const slot of i.slots){const ids=result.assignments.filter(a=>a.slotId===slot.id).map(a=>a.personId).sort();assert.ok(JSON.stringify(ids)==='["a","b"]'||JSON.stringify(ids)==='["c","d"]');}
 const balanced=input({a:['0','1','2'],b:['0','1','2'],c:['0','1','2']});balanced.people=balanced.people.map((p,n)=>({...p,grade:n<2?'1年生':'2年生'}));
 const fair=await solve(balanced);assert.deepEqual(['a','b','c'].map(id=>fair.assignments.filter(a=>a.personId===id).length),[2,2,2]);
});
test('same-grade preference never overrides explicit pair requests, prohibitions, fixed assignments or coverage',async()=>{
 const i=input({a:['0'],b:['0'],c:['0'],d:['0']},{together:[['a','c']]});i.slots=slots.slice(0,1);i.people=i.people.map((p,n)=>({...p,grade:n<2?'1年':'2年'}));
 assert.deepEqual((await solve(i)).assignments.map(a=>a.personId).sort(),['a','c']);
 i.rules.together=[];i.rules.apart=[['a','b'],['c','d']];const apart=await solve(i);assert.equal(apart.assignments.length,2);assert.notEqual(apart.assignments.every(a=>['a','b'].includes(a.personId)),true);assert.notEqual(apart.assignments.every(a=>['c','d'].includes(a.personId)),true);
 i.fixed=[{id:'fixed',personId:'a',slotId:'0',fixed:true,manual:true}];i.availability={a:[],b:[],c:['0'],d:[]};const fixed=await solve(i);assert.equal(fixed.assignments.length,2);assert.ok(fixed.assignments.some(a=>a.id==='fixed'));assert.ok(fixed.assignments.some(a=>a.personId==='c'));
});
test('unknown grades do not count as a same-grade pair; known masters aliases match',async()=>{
 const i=input({a:['0'],b:['0'],c:['0'],d:['0']});i.slots=slots.slice(0,1);i.people=i.people.map((p,n)=>({...p,grade:['学年未設定','学年未設定','修士1年','M1'][n]}));
 assert.deepEqual((await solve(i)).assignments.map(a=>a.personId).sort(),['c','d']);
 i.people=i.people.map(p=>({...p,grade:'学年未設定'}));assert.equal((await solve(i)).assignments.length,2);
});

test('scheduled shift deadlines warn without blocking submission; explicit closure still stops saving',()=>fixture(async(id,staff)=>{
 let current=staffShiftData(id,'staff');await staff({action:'settings',config:{...current.record.config,opensAt:'2020-01-01T00:00:00Z',closesAt:'2020-01-02T00:00:00Z'}});const dto=memberShiftData(id,'optional');assert.equal(dto.canSubmit,true);assert.equal(dto.overdue,true);const answer=await memberShiftAction(id,'optional',{action:'submit',ownerId:'optional',scheduleKey:dto.scheduleKey,revision:0,content:{none:true,slotIds:[]}});assert.ok(answer.response?.submitted);current=staffShiftData(id,'staff');await staff({action:'settings',config:{...current.record.config,state:'closed'}});assert.equal(memberShiftData(id,'optional').overdue,false);await assert.rejects(memberShiftAction(id,'optional',{action:'save',ownerId:'optional',scheduleKey:dto.scheduleKey,revision:answer.response!.revision,content:{none:true,slotIds:[]}}),/受付期間外/);
}));
