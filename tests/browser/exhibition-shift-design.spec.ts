import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'};
const login=async(page:Page,email:string)=>expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);
async function setup(page:Page,title:string,openingSchedule={startDate:'2026-11-05',endDate:'2026-11-05',regular:{open:'10:00',close:'12:30'}} as any){
 await login(page,'planner@example.invalid');const command=async(data:any)=>{const r=await page.request.post('/api/member/exhibitions',{headers,data});expect(r.status(),await r.text()).toBe(200);return (await r.json()).exhibition;};
 let e=await command({action:'create',title,openingSchedule});const iso=(d:number)=>new Date(Date.now()+d).toISOString();
 e=await command({action:'settings',exhibitionId:e.id,revision:e.revision,title,status:'open',gallery:'staff',voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['member']});await command({action:'participation.publish',exhibitionId:e.id,revision:e.revision});await expect.poll(async()=>(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.participation.state).toBe('published');
 const get=async()=>await(await page.request.get(`/api/member/exhibitions/${e.id}/shifts`)).json();let d=await get();const response=await page.request.post(`/api/member/exhibitions/${e.id}/shifts`,{headers,data:{action:'settings',revision:d.record.revision,config:{state:'open',opensAt:iso(-60000),closesAt:iso(3600000),rules:{together:[],apart:[]}}}});expect(response.status(),await response.text()).toBe(200);return {id:e.id,get};
}
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {withStoreLock,readData,writeData} from '../../src/lib/store.ts';
async function seedSearchPerson(){
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));if(!directory.startsWith(path.join(os.tmpdir(),'scharade-browser-')))throw new Error('Synthetic fixture required');
 const old=process.env.DATA_DIR;process.env.DATA_DIR=directory;
 try{await withStoreLock('users',()=>{const users=readData<any[]>('users.json',[]);Object.assign(users.find(u=>u.id==='activity-7'),{name:'カメラ会員',portfolioName:'ＹＡＭＡＤＡ'});writeData('users.json',users);});await withStoreLock('member-activities',()=>{const a=readData<any>('member-activities.json',{});a.roster??={bindings:{},records:[]};a.roster.bindings??={};a.roster.records??=[];a.roster.bindings['activity-7']='shift-search';a.roster.records=a.roster.records.filter((r:any)=>r.key!=='shift-search');a.roster.records.push({key:'shift-search',name:'山田 太郎',lineName:'撮影　TARO',active:true});writeData('member-activities.json',a);});}finally{if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;}
}
for(const width of [1440,390])test(`date/time matrix, complete navigation and Japanese name search at ${width}px`,async({page},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:980});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const schedule={startDate:'2026-11-05',endDate:'2026-11-13',regular:{open:'10:00',close:'12:30'},first:{open:'11:00',close:'12:00'},last:{open:'09:30',close:'11:00'}};
 const f=await setup(page,`日付列シフト ${info.project.name} ${width}`,schedule);await seedSearchPerson();await page.goto(`/Member/manage/exhibitions/${f.id}/shifts`);
 await expect(page.locator('.exhibition-admin-nav a')).toHaveCount(7);for(const name of ['参加者一覧','フォーム作成','展示室・壁面レイアウト','提出内容・QR確認'])await expect(page.locator('.exhibition-admin-nav').getByRole('link',{name,exact:true})).toBeVisible();
 const summary=page.locator('[data-shift-matrix="summary"]');await expect(summary).toBeVisible();await expect(summary.locator('thead th').filter({hasText:'時間'})).toHaveCount(1);await expect(summary.locator('thead [data-matrix-day]:visible')).toHaveCount(7);await expect(summary.locator('tbody .shift-time-heading').first()).toContainText('09:30');await expect(summary.locator('[data-matrix-slot][rowspan="2"]:visible').first()).toBeVisible();
 await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-response-search]').fill('山田太郎');await expect(page.locator('[data-response-rows] > li')).toHaveCount(1);await expect(page.locator('[data-response-rows]')).toContainText('カメラ会員');await page.locator('[data-response-search]').fill('yamada');await expect(page.locator('[data-response-rows] > li')).toHaveCount(1);
 await page.getByRole('tab',{name:'シフト表',exact:true}).click();const matrix=page.locator('[data-shift-matrix="draft"]');await expect(matrix.locator('thead [data-matrix-day]:visible')).toHaveCount(7);
 await matrix.locator('[data-seat=""]:visible').first().click();let popup=page.locator('dialog.shift-dialog');await popup.locator('[data-person-search]').fill('山田太郎');await expect(popup.locator('[data-person]')).toHaveCount(1);await expect(popup.locator('[data-person]')).toContainText('登録名');await popup.locator('[data-person-search]').fill('撮影taro');await expect(popup.locator('[data-person]')).toHaveCount(1);await popup.locator('[data-person="activity-7"]').click();await page.locator('dialog.shift-dialog').last().getByRole('button',{name:'警告を確認して保存'}).click();await expect(popup).toHaveCount(0);
 await page.locator('[data-board-search]').fill('山田 太郎');await expect(page.locator('[data-seat].shift-search-match')).toHaveCount(1);await expect(page.locator('[data-board-search-count]')).toContainText('1件');const matched=page.locator('[data-seat].shift-search-match');await matched.scrollIntoViewIfNeeded();const beforeScroll=await matrix.locator('.shift-matrix-scroll').evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));await matched.click();await expect(matched).toHaveAttribute('aria-pressed','true');const afterScroll=await matrix.locator('.shift-matrix-scroll').evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));expect(Math.abs(beforeScroll.top-afterScroll.top)).toBeLessThanOrEqual(1);expect(Math.abs(beforeScroll.left-afterScroll.left)).toBeLessThanOrEqual(1);await page.keyboard.press('Escape');await page.screenshot({path:info.outputPath(`matrix-board-${width}.png`),fullPage:true});await page.locator('[data-board-search-clear]').click();
 await matrix.getByRole('button',{name:'次の7日間'}).click();await expect(matrix.locator('thead [data-matrix-day]:visible')).toHaveCount(2);
 if(width===1440){
   const beforeGuide = (await f.get()).record.plan;
   await page.locator('[data-help-open]').click();
   await page.locator('#help-query').fill('シフトを画像で共有したい');
   await page.locator('#help-search-results').getByRole('button', { name: /シフト表の画像をコピーする/ }).click();
   await expect(page.locator('[data-action="review"]')).toHaveClass(/help-target/);
   await page.locator('[data-help-next]').click();
   await expect(matrix.locator('[data-matrix-page="-1"]')).toHaveClass(/help-target/);
   await page.locator('[data-help-next]').click();
   await expect(page.locator('[data-shift-copy]')).toHaveClass(/help-target/);
   await expect(page.locator('[data-shift-copy]')).toBeDisabled();
   expect((await f.get()).record.plan).toEqual(beforeGuide);
   await page.locator('[data-help-stop]').click();
   await page.locator('[data-action="review"]').click();
   await page.getByRole('button',{name:'警告を確認して保存'}).click();
   const copy=page.getByRole('button',{name:'シフト表の画像をコピー',exact:true});
   await expect(copy).toBeEnabled();
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{value:undefined}));
   await copy.click();
   const fallback=page.getByRole('button',{name:'PNGで保存',exact:true});
   await expect(fallback).toBeVisible();
   const [download]=await Promise.all([page.waitForEvent('download'),fallback.click()]);
   expect(download.suggestedFilename()).toBe('展示シフト.png');
   const png=fs.readFileSync((await download.path())!);
   expect(png.readUInt32BE(16)).toBe(1008); // The two date columns on the selected page.
 }
 await page.locator('[data-board-search]').fill('yamada');await page.locator('[data-board-jump]').click();await expect(matrix.locator('thead [data-matrix-day]:visible').first()).toHaveAttribute('data-matrix-day','2026-11-05');
 await page.locator('[data-action="publish"]').click();await page.locator('dialog.shift-dialog').getByRole('button',{name:'公開する',exact:true}).click();await expect.poll(async()=>(await f.get()).record.published?.version).toBe(1);
 await login(page,'activity-7@example.invalid');await page.goto(`/Member/exhibitions/${f.id}/shifts`);await expect(page.locator('[data-shift-matrix="answer"]')).toBeVisible();await expect(page.locator('[data-slot]')).toHaveCount(24);await page.locator('[data-select-slots="all"]').click();await expect(page.locator('[data-slot]:checked')).toHaveCount(24);await page.locator('[data-select-slots="none"]').click();await expect(page.locator('[data-slot]:checked')).toHaveCount(0);
 const answer=page.locator('[data-shift-matrix="answer"]');await answer.getByRole('button',{name:'次の7日間'}).click();await answer.locator('[data-select-day="2026-11-13"][data-day-choice="all"]').click();await expect(page.locator('[data-slot]:checked')).toHaveCount(2);await answer.getByRole('button',{name:'前の7日間'}).click();await expect(page.locator('[data-slot]:checked')).toHaveCount(2);await page.locator('[data-save-shift]').click();await expect(page.locator('[data-draft-state]')).toHaveText('下書き保存済み');
 await page.screenshot({path:info.outputPath(`matrix-answer-${width}.png`),fullPage:true});await page.getByRole('button',{name:'シフト希望を提出',exact:true}).click();await expect(page.locator('[data-shift-own-status]')).toContainText('提出済み');
 await page.getByRole('tab',{name:'確定シフト',exact:true}).click();const result=page.locator('[data-shift-matrix="published"]');await expect(result).toBeVisible();await page.locator('[data-published-search]').fill('カメラ 会員');await expect(result.locator('.shift-search-match')).toHaveCount(1);await expect(result.locator('.shift-own')).toHaveCount(1);await page.screenshot({path:info.outputPath(`matrix-result-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await login(page,'planner@example.invalid');await page.goto(`/Member/manage/exhibitions/${f.id}/shifts`);await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-response-search]').fill('山田太郎');await page.locator('[data-response]').click();let detail=page.locator('dialog.shift-dialog');await expect(detail.locator('[data-shift-matrix="response"] .is-selected')).toHaveCount(2);await detail.locator('.shift-close').click();await expect(detail).toHaveCount(0);
 const current=await f.get();const change=await page.request.post(`/api/member/exhibitions/${f.id}/shifts`,{headers,data:{action:'schedule',exhibitionRevision:current.exhibition.revision,openingSchedule:{startDate:'2027-01-01',endDate:'2027-01-01',regular:{open:'10:00',close:'11:00'}}}});expect(change.status(),await change.text()).toBe(200);await page.reload();await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-response-search]').fill('山田太郎');await page.locator('[data-response]').click();detail=page.locator('dialog.shift-dialog');const historical=detail.locator('[data-shift-matrix="response"]');await expect(historical.locator('thead time')).toHaveAttribute('datetime','2026-11-13');await expect(historical.locator('.is-selected')).toHaveCount(2);await expect(detail).toContainText('以前の日程');await detail.locator('.shift-close').click();await expect(detail).toHaveCount(0);
expect(errors).toEqual([]);
});

for(const width of [1440,390])test(`compact full-day table, automatic icons, submission cards and aligned actions at ${width}px`,async({page,browserName},info)=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:980});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await setup(page,`シフト表示整理 ${info.project.name} ${width}`,{startDate:'2026-11-10',endDate:'2026-11-12',regular:{open:'10:00',close:'18:00'},first:{open:'10:30',close:'18:00'},last:{open:'10:00',close:'17:30'}}),initial=await f.get(),people=['activity-0','activity-1','activity-2','activity-3'];
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));if(!directory.startsWith(path.join(os.tmpdir(),'scharade-browser-')))throw new Error('Synthetic fixture required');const old=process.env.DATA_DIR;process.env.DATA_DIR=directory;
 try{
  await withStoreLock('member-activities',()=>{const data=readData<any>('member-activities.json',{});data.profiles??={};people.forEach((id,i)=>data.profiles[id]={gender:'undisclosed',grade:i<2?'1':'2',revision:1,rosterKey:`shift-grade-${id}`});writeData('member-activities.json',data);});
  await withStoreLock('exhibition-shifts',()=>{const data=readData<any>('exhibition-shifts.json',{}),r=data.records.find((r:any)=>r.exhibitionId===f.id),at=new Date().toISOString();r.responses=people.map(userId=>({userId,revision:1,updatedAt:at,draft:{none:false,slotIds:initial.slots.map((s:any)=>s.id)},submitted:{none:false,slotIds:initial.slots.map((s:any)=>s.id),at,scheduleKey:initial.scheduleKey}}));r.responses.push({userId:'activity-4',revision:1,updatedAt:at,draft:{none:true,slotIds:[]}});writeData('exhibition-shifts.json',data);});
 }finally{if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;}
 await page.goto(`/Member/manage/exhibitions/${f.id}/shifts`);await page.getByRole('tab',{name:'提出状況',exact:true}).click();await expect(page.locator('[data-response-rows]')).toHaveClass(/submission-status-list/);await expect(page.locator('[data-response-rows] table')).toHaveCount(0);
 await page.locator('[data-response-filter]').selectOption('draft');await expect(page.locator('[data-response-rows] > li')).toHaveCount(1);await expect(page.locator('[data-response-rows]')).toContainText('下書き');await page.locator('[data-response]').click();await expect(page.locator('dialog.shift-dialog')).toContainText('保存中の下書き');await page.locator('.shift-close').click();
 await page.locator('[data-response-filter]').selectOption('submitted');await expect(page.locator('[data-response-rows] > li')).toHaveCount(4);await page.locator('[data-response-search]').fill('存在しない会員');await expect(page.locator('[data-response-empty]')).toBeVisible();await page.locator('[data-response-search]').fill('');await page.screenshot({path:info.outputPath(`response-cards-${width}.png`),fullPage:true});
 await page.getByRole('tab',{name:'シフト表',exact:true}).click();await page.locator('[data-action="generate"]').click();await expect.poll(async()=>(await f.get()).record.job?.state,{timeout:45000}).toBe('ready');await expect(page.locator('[data-shift-matrix="draft"] [data-auto-assignment]')).toHaveCount(48);
 const state=await f.get(),grade=new Map(state.people.map((p:any)=>[p.id,p.grade]));for(const slot of state.slots){const own=state.record.plan.assignments.filter((a:any)=>a.slotId===slot.id);expect(own).toHaveLength(2);expect(grade.get(own[0].personId)).toBe(grade.get(own[1].personId));}
 const matrix=page.locator('[data-shift-matrix="draft"]'),scroll=matrix.locator('.shift-matrix-scroll');await expect(scroll).toBeVisible();expect(await scroll.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);expect((await scroll.boundingBox())!.height).toBeLessThan(650);
 const seat=matrix.locator('[data-seat]').first(),name=seat.locator('.shift-seat-name'),icon=seat.locator('[data-auto-assignment]');await seat.scrollIntoViewIfNeeded();expect((await icon.boundingBox())!.x).toBeGreaterThan((await name.boundingBox())!.x);expect(await seat.innerText()).not.toContain('自動配置');await expect(icon.locator('svg')).toHaveAttribute('viewBox','0 0 14 14');
 const nav=await page.locator('.exhibition-admin-nav a').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON())),actions=await page.locator('.shift-board-toolbar > button').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
 for(let i=1;i<6;i++)expect(Math.abs(nav[i].width-nav[0].width)).toBeLessThan(1);
 if(width<720){expect(Math.abs(nav[0].y-nav[1].y)).toBeLessThan(1);expect(nav[6].width).toBeGreaterThan(nav[0].width*1.9);expect(Math.abs(actions[0].width-actions[1].width)).toBeLessThan(1);expect(Math.abs(actions[0].y-actions[1].y)).toBeLessThan(1);expect(actions[2].width).toBeGreaterThan(actions[0].width*1.9);}
 else for(const action of actions)expect(Math.abs(action.width-actions[0].width)).toBeLessThan(1);
 await page.screenshot({path:info.outputPath(`compact-shifts-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const copy=page.getByRole('button',{name:'シフト表の画像をコピー'});
 await expect(copy).toBeDisabled();
 await page.locator('[data-action="review"]').click();
 await expect(copy).toBeEnabled();
 await page.reload();
 await page.getByRole('tab',{name:'シフト表',exact:true}).click();
 await expect(copy).toBeEnabled();
 if(browserName==='chromium'){
   await page.context().grantPermissions(['clipboard-read','clipboard-write']);
   await copy.click();
   await expect(page.getByText('シフト表の画像をコピーしました。',{exact:true})).toBeVisible();
   const bytes=await page.evaluate(async()=>{
     const item=(await navigator.clipboard.read()).find(item=>item.types.includes('image/png'));
     if(!item)return [];
     const blob=await item.getType('image/png');
     return Array.from(new Uint8Array(await blob.arrayBuffer()));
   });
   expect(bytes.slice(0,8)).toEqual([137,80,78,71,13,10,26,10]);
   expect(bytes.length).toBeGreaterThan(1000);
   const imagePath=info.outputPath('copied-shift.png');
   fs.writeFileSync(imagePath,Buffer.from(bytes));
   await info.attach('copied-shift.png',{path:imagePath,contentType:'image/png'});
 }
 await page.locator('[data-action="publish"]').click();await page.locator('dialog.shift-dialog').getByRole('button',{name:'公開する',exact:true}).click();await expect.poll(async()=>(await f.get()).record.published?.version).toBe(1);
 await expect(page.locator('[data-shift-matrix="published"] .shift-person-name')).toHaveCount(48);
 await expect(page.locator('[data-shift-matrix="published"] [data-auto-assignment]')).toHaveCount(0);
 await login(page,'activity-0@example.invalid');await page.goto(`/Member/exhibitions/${f.id}/shifts`);await page.getByRole('tab',{name:'確定シフト',exact:true}).click();await expect(page.locator('[data-shift-matrix="published"] .shift-person-name')).toHaveCount(48);await expect(page.locator('[data-shift-matrix="published"] [data-auto-assignment]')).toHaveCount(0);await expect(copy).toHaveCount(0);expect(await page.locator('[data-shift-matrix="published"] .shift-matrix-scroll').evaluate(el=>el.scrollHeight-el.clientHeight)).toBeLessThanOrEqual(1);expect(errors).toEqual([]);
});
