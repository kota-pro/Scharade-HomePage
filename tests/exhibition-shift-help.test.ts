import {test,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {helpCatalog,helpGuide,pageHelp} from '../src/lib/helpCatalog.ts';
import {searchHelp} from '../src/lib/helpTypes.ts';
import {localHelpTasks} from '../src/lib/helpTasks.ts';
import {emptyActivities} from '../src/lib/activityTypes.ts';
import {writeData} from '../src/lib/store.ts';
import {shiftRecord} from '../src/lib/exhibitionShiftStore.ts';
import {scheduleKey} from '../src/lib/exhibitionShiftSchedule.ts';
import type {User} from '../src/lib/auth.ts';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scharade-shift-help-')),previous=process.env.DATA_DIR;
const at='2026-11-04T00:00:00.000Z',now=Date.parse(at);
const member:User={id:'member',name:'会員',email:'member@example.invalid',role:'member',approved:true,createdAt:at,providers:{}};
const pending:User={...member,id:'pending',approved:false};
beforeEach(()=>{process.env.DATA_DIR=directory;fs.rmSync(directory,{recursive:true,force:true});fs.mkdirSync(directory);writeData('users.json',[member,pending]);writeData('member-activities.json',emptyActivities());});
after(()=>{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;fs.rmSync(directory,{recursive:true,force:true});});

function shiftFixture(attending = false) {
  const id = crypto.randomUUID();
  const exhibition: any = { id, title:'展示シフト確認', status:'open', opensAt:'2026-11-01T00:00:00Z', closesAt:'2026-12-31T00:00:00Z', openingSchedule:{startDate:'2026-11-10',endDate:'2026-11-12',regular:{open:'10:00',close:'18:00'}}, participation:{state:'published',recipientIds:attending?[member.id]:[],votes:attending?{[member.id]:{value:'attending',at,actorId:member.id}}:{}}, schemas:[{version:1,sections:[],fields:[]}], rooms:[] };
  const exhibitions:any={version:1,exhibitions:[exhibition],submissions:[],assets:[],outputs:[]};
  const shifts={version:1 as const,records:[] as any[]},record=shiftRecord(shifts,id);
  record.config={state:'open',opensAt:'2026-11-01T00:00:00Z',closesAt:'2026-12-31T00:00:00Z',rules:{together:[],apart:[]}};
  const save=()=>{writeData('exhibitions.json',exhibitions);writeData('exhibition-shifts.json',shifts);};save();return {id,exhibition,exhibitions,record,save};
}

test('shift tasks include uninvited members, distinguish drafts and current submissions, and reopen after schedule changes',()=>{
  const f=shiftFixture(),key=`exhibition-shift:${f.id}`;
  let result=localHelpTasks(member,now),task=result.tasks.find(t=>t.id===key)!;
  assert.equal(task.optional,true);assert.equal(task.href,`/Member/exhibitions/${f.id}/shifts`);assert.equal(task.guideId,'exhibition-shift');assert.equal(task.dueAt,f.record.config.closesAt);
  f.record.responses.push({userId:member.id,revision:1,draft:{none:true,slotIds:[]},updatedAt:at});f.save();assert.ok(localHelpTasks(member,now).tasks.some(t=>t.id===key));
  f.record.responses[0].submitted={none:true,slotIds:[],at,scheduleKey:scheduleKey(f.exhibition.openingSchedule)};f.save();result=localHelpTasks(member,now);assert.ok(result.completed.includes(key));assert.ok(!result.tasks.some(t=>t.id===key));
  f.exhibition.openingSchedule.regular.close='17:00';f.save();assert.match(localHelpTasks(member,now).tasks.find(t=>t.id===key)!.title,/再確認/);
  assert.ok(!localHelpTasks(member,Date.parse(f.record.config.closesAt)).tasks.some(t=>t.id===key));
  assert.ok(!localHelpTasks(member,Date.parse(f.record.config.opensAt)-1).tasks.some(t=>t.id===key));
  f.record.config.state='closed';f.save();assert.ok(!localHelpTasks(member,now).tasks.some(t=>t.id===key));
  f.record.config.state='open';f.record.config.closesAt='2027-01-01T00:00:00Z';f.save();assert.ok(localHelpTasks(member,now).tasks.some(t=>t.id===key));
});
test('shift guide respects publication and roles, and tells exhibitors to submit their works first',()=>{
  const f=shiftFixture(true),task=localHelpTasks(member,now).tasks.find(t=>t.guideId==='exhibition-shift')!;
  assert.equal(task.optional,false);assert.match(task.description,/作品を提出した後/);
  let guide=helpGuide('exhibition-shift','/',member,f.id);assert.ok(guide.steps.some(s=>s.id==='layout'));assert.ok(guide.steps.every(s=>s.path===`/Member/exhibitions/${f.id}/shifts`));
  assert.equal(pageHelp(`/Member/exhibitions/${f.id}/shifts`,member).id,'exhibition-shift');assert.ok(searchHelp(helpCatalog(member),'シフト表').some(g=>g.id==='exhibition-shift'));
  f.exhibitions.submissions.push({id:crypto.randomUUID(),exhibitionId:f.id,userId:member.id,versions:[{version:1}]});f.save();guide=helpGuide('exhibition-shift','/',member,f.id);assert.ok(!guide.steps.some(s=>s.id==='layout'));
  assert.throws(()=>helpGuide('exhibition-shift','/',pending,f.id));assert.throws(()=>helpGuide('exhibition-shift','/',null,f.id));
  f.record.config.state='draft';f.save();assert.ok(!localHelpTasks(member,now).tasks.some(t=>t.guideId==='exhibition-shift'));assert.throws(()=>helpGuide('exhibition-shift','/',member,f.id));
  f.record.config.state='open';f.exhibition.participation.state='draft';f.save();assert.ok(!localHelpTasks(member,now).tasks.some(t=>t.guideId==='exhibition-shift'));assert.throws(()=>helpGuide('exhibition-shift','/',member,f.id));
});
