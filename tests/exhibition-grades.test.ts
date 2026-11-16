import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeExhibitionGrade,exhibitionGrades,exhibitionGradeOptionsHtml} from '../src/lib/exhibitionGrades.ts';
import {exhibitionAccountGrade} from '../src/lib/exhibitionAccountGrade.ts';
import {exhibitionAction,publicAction,readExhibitions,updateExhibitionStore} from '../src/lib/exhibitions.ts';
import {emptyActivities} from '../src/lib/activityTypes.ts';
import {writeData} from '../src/lib/store.ts';

test('six grades recognize account and legacy spellings without inventing a masters year',()=>{
 assert.deepEqual([...exhibitionGrades],['1年','2年','3年','4年','修士1年','修士2年']);
 for(const input of ['2','２年生','大学二年生','2nd Grade',['','2nd Grade']])assert.equal(normalizeExhibitionGrade(input),'2年');
 for(const input of ['修士１年','大学院一年生','M1','博士前期1年'])assert.equal(normalizeExhibitionGrade(input),'修士1年');
 for(const input of ['修士２年生','大学院２年生','M2'])assert.equal(normalizeExhibitionGrade(input),'修士2年');
 for(const input of ['master',"Master's Program",'大学院生','5年','博士2年',null])assert.equal(normalizeExhibitionGrade(input),'');
 const legacy=exhibitionGradeOptionsHtml('5年');assert.match(legacy,/<option value="5年" disabled selected>/);assert.equal((legacy.match(/<option /g)??[]).length,8);
 assert.match(exhibitionGradeOptionsHtml('２年生'),/<option value="2年" selected>/);assert.doesNotMatch(exhibitionGradeOptionsHtml('<img src=x>'),/<img/);
});
async function fixture(run:(e:any,user:any,profile:(grade:string)=>void)=>Promise<void>){
 const previous={data:process.env.DATA_DIR,domain:process.env.MICROCMS_SERVICE_DOMAIN,key:process.env.MICROCMS_SERVER_API_KEY,fetch:globalThis.fetch},dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-grades-'));process.env.DATA_DIR=dir;process.env.MICROCMS_SERVICE_DOMAIN='gradefixture';process.env.MICROCMS_SERVER_API_KEY='synthetic-grade-key';
 const user={id:'author',name:'作者',email:'author@example.invalid',role:'member',approved:true,createdAt:'2026-01-01',providers:{},portfolioId:'grade-'+crypto.randomUUID()};
 try{
  writeData('users.json',[user,{...user,id:'staff',email:'staff@example.invalid',role:'staff',portfolioId:undefined}]);
  const e=(await exhibitionAction('staff',{action:'create',title:'学年の確認'})).exhibition;
  await updateExhibitionStore(data=>{const x=data.exhibitions[0],iso=(n:number)=>new Date(Date.now()+n).toISOString();x.status='open';x.opensAt=iso(-60000);x.closesAt=iso(3600000);x.participation={state:'published',opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['author'],votes:{author:{value:'attending',at:iso(0),actorId:'author'}}};});
  const profile=(grade:string)=>{const data=emptyActivities();data.profiles.author={gender:'other',grade:grade as any,revision:1,rosterKey:'bound-author'};writeData('member-activities.json',data);};
  await run(e,user,profile);
 }finally{globalThis.fetch=previous.fetch;for(const[key,value]of Object.entries({DATA_DIR:previous.data,MICROCMS_SERVICE_DOMAIN:previous.domain,MICROCMS_SERVER_API_KEY:previous.key})){if(value===undefined)delete process.env[key];else process.env[key]=value;}fs.rmSync(dir,{recursive:true,force:true});}
}
test('linked account profile takes priority and an unspecified master cannot fall back to a stale bachelor grade',async()=>fixture(async(_e,user,profile)=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:user.portfolioId,grade:'1st Grade'});};profile('3');assert.equal(await exhibitionAccountGrade(user),'3年');assert.equal(calls,0);profile('master');assert.equal(await exhibitionAccountGrade(user),'');assert.equal(calls,1);
 globalThis.fetch=async()=>Response.json({grade:'修士2年'});assert.equal(await exhibitionAccountGrade({...user,portfolioId:'grade-'+crypto.randomUUID()}),'修士2年');
 profile('doctorate');assert.equal(await exhibitionAccountGrade(user),'');
}));
test('portfolio-only accounts get a default while unavailable or ambiguous grades stay selectable manually',async()=>fixture(async(_e,user)=>{
 globalThis.fetch=async()=>Response.json({grade:['2nd Grade']});assert.equal(await exhibitionAccountGrade(user),'2年');
 globalThis.fetch=async()=>{throw new Error('offline');};assert.equal(await exhibitionAccountGrade({...user,portfolioId:'grade-'+crypto.randomUUID()}),'');assert.equal(await exhibitionAccountGrade({...user,portfolioId:null}),'');
}));
test('new drafts inherit the account grade but resuming a saved choice never overwrites it',async()=>fixture(async(e,_user,profile)=>{
 profile('4');let s=(await publicAction(e.id,'',{action:'begin'},'author')).submission;assert.equal(s.draft.grade,'4年');
 s=(await publicAction(e.id,'',{action:'save',revision:s.revision,content:{...s.draft,grade:'修士1年'}},'author')).submission;profile('1');const before=structuredClone(readExhibitions());const resumed=(await publicAction(e.id,'',{action:'begin'},'author')).submission;assert.equal(resumed.draft.grade,'修士1年');assert.equal(resumed.revision,s.revision);assert.deepEqual(readExhibitions(),before);
}));
test('external account lookup does not hold the exhibition write lock and access is checked before lookup',async()=>fixture(async(e,_user)=>{
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);let calls=0;
 globalThis.fetch=async()=>{calls++;enter();await gate;return Response.json({grade:'3rd Grade'});};
 await assert.rejects(publicAction(e.id,'',{action:'begin',ownerId:'another'},'author'),(error:any)=>error.status===401);assert.equal(calls,0);
 const beginning=publicAction(e.id,'',{action:'begin'},'author');await entered;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([updateExhibitionStore(data=>{data.exhibitions[0].title='同時の更新';}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('write lock held during CMS lookup')),1500);})]);}finally{clearTimeout(timer);release();}
 const s=(await beginning).submission;assert.equal(s.draft.grade,'3年');
}));
