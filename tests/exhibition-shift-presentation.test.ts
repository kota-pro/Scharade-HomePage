import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchesShiftPerson, shiftMatrixModel, normalizeShiftSearch, shiftAnswerSlots } from '../src/lib/exhibitionShiftPresentation.ts';
import { shiftSlots } from '../src/lib/exhibitionShiftSchedule.ts';
import { shiftPeople, shiftSourceKey } from '../src/lib/exhibitionShifts.ts';
import { writeData } from '../src/lib/store.ts';
import { shiftRecord } from '../src/lib/exhibitionShiftStore.ts';

test('name search accepts name spacing, width, case, kana and roster/portfolio aliases',()=>{
 const person={name:'山田　太郎',lineName:'ＴＡＲＯ Camera',searchNames:['やまだ たろう','写真係']};
 for(const query of ['山田太郎','山田 太郎','ｔａｒｏ','taro camera','ヤマダタロウ','写真係','　'])assert.equal(matchesShiftPerson(person,query),true,query);
 assert.equal(matchesShiftPerson(person,'佐藤'),false);assert.equal(matchesShiftPerson(undefined,'山田'),false);assert.equal(normalizeShiftSearch(' ﾔﾏﾀﾞ　ＴＡＲＯ '),'やまだtaro');
});
test('matrix has date columns, chronological time rows, offset opening times and partial-slot rowspans',()=>{
 const slots=shiftSlots({startDate:'2026-11-05',endDate:'2026-11-07',regular:{open:'10:00',close:'12:30'},first:{open:'10:30',close:'12:00'},last:{open:'09:30',close:'11:00'}});
 const m=shiftMatrixModel(slots);assert.deepEqual(m.dates,['2026-11-05','2026-11-06','2026-11-07']);assert.equal(m.rows[0].start,'09:30');assert.equal(m.rows.at(-1)!.end,'12:30');
 const starts=m.rows.flatMap(r=>r.cells.filter(c=>c.slot&&!c.continued));assert.equal(starts.length,slots.length);assert.equal(new Set(starts.map(c=>c.slot!.id)).size,slots.length);
 for(const date of m.dates){const cells=m.rows.flatMap(r=>r.cells.filter(c=>c.date===date&&!c.continued));assert.equal(cells.reduce((sum,c)=>sum+c.span,0),m.rows.length);}
 assert.equal(starts.some(c=>c.span>1),true);assert.equal(m.rows.some(r=>r.cells.some(c=>!c.slot)),true);
});
test('search-only aliases do not enter solver/publication people or change existing identity fields',()=>{
 const before=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'shift-search-'));process.env.DATA_DIR=dir;
 try{writeData('users.json',[{id:'member',email:'member@example.invalid',createdAt:'2026-01-01',providers:{},name:'カメラ会員',approved:true,role:'member',portfolioName:'山田写真'}]);writeData('member-activities.json',{version:1,events:[],notifications:[],profiles:{},roster:{bindings:{member:'roster'},records:[{key:'roster',name:'山田 太郎',lineName:'たろう',active:true}]}});
 const r=shiftRecord({version:1,records:[]},'exhibition'),ordinary=shiftPeople(r),searchable=shiftPeople(r,true);
 const exhibition={id:'exhibition',openingSchedule:{startDate:'2026-11-05',endDate:'2026-11-05',regular:{open:'10:00',close:'11:00'}}} as any;
 const sourceKey=shiftSourceKey(exhibition,r);
 assert.equal(ordinary[0].searchNames,undefined);assert.deepEqual(searchable[0].searchNames,['山田写真','山田 太郎']);assert.equal(matchesShiftPerson(searchable[0],'山田太郎'),true);
 const {searchNames,...same}=searchable[0];assert.deepEqual(same,ordinary[0]);
 writeData('exhibitions.json',{version:1,exhibitions:[],assets:[],submissions:[{id:'submission-one',exhibitionId:'exhibition',userId:'member',draft:{name:'提出者の本名',authorName:'写真の作者名'},versions:[{content:{name:'提出済みの氏名',authorName:'登録された作者名'}}]},{id:'submission-two',exhibitionId:'other-exhibition',userId:'member',draft:{name:'別の写真展の名前'},versions:[]}]});
 const fromForm=shiftPeople(r,true)[0];for(const query of ['提出者の本名','写真の作者名','提出済みの氏名','登録された作者名'])assert.equal(matchesShiftPerson(fromForm,query),true);assert.equal(matchesShiftPerson(fromForm,'別の写真展の名前'),false);assert.deepEqual(shiftPeople(r),ordinary);assert.equal(shiftSourceKey(exhibition,r),sourceKey);
 }finally{if(before===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=before;fs.rmSync(dir,{recursive:true,force:true});}
});

test('previous-schedule answers retain their original date and time in the matrix',()=>{
 const current=shiftSlots({startDate:'2026-12-01',endDate:'2026-12-01',regular:{open:'10:00',close:'11:00'}});
 const old=shiftAnswerSlots(['2026-11-05/09:30-10:30','2026-11-06/12:00-12:30'],current,true);
 assert.equal(old.recordedOnly,true);assert.deepEqual(shiftMatrixModel(old.slots).dates,['2026-11-05','2026-11-06']);assert.equal(old.slots[1].minutes,30);
 assert.equal(shiftAnswerSlots([current[0].id],current).recordedOnly,false);
});
