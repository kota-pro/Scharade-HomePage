import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'};
const login=async(page:Page,email:string)=>expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);
async function setup(page:Page,title:string){
 await login(page,'planner@example.invalid');const command=async(data:any)=>{const r=await page.request.post('/api/member/exhibitions',{headers,data});expect(r.status(),await r.text()).toBe(200);return (await r.json()).exhibition;};
 let e=await command({action:'create',title,openingSchedule:{startDate:'2026-11-05',endDate:'2026-11-05',regular:{open:'10:00',close:'12:30'}}});const iso=(d:number)=>new Date(Date.now()+d).toISOString();
 e=await command({action:'settings',exhibitionId:e.id,revision:e.revision,title,status:'open',gallery:'staff',voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['member']});await command({action:'participation.publish',exhibitionId:e.id,revision:e.revision});await expect.poll(async()=>(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.participation.state).toBe('published');
 const get=async()=>await(await page.request.get(`/api/member/exhibitions/${e.id}/shifts`)).json();let d=await get();const response=await page.request.post(`/api/member/exhibitions/${e.id}/shifts`,{headers,data:{action:'settings',revision:d.record.revision,config:{state:'open',opensAt:iso(-60000),closesAt:iso(3600000),rules:{together:[],apart:[]}}}});expect(response.status(),await response.text()).toBe(200);return {id:e.id,get};
}
for(const width of [1440,390])test(`manual addition searches unsubmitted members and typed names at ${width}px`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:950});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=await setup(page,`シフト追加 ${info.project.name} ${width}`);
 await page.goto(`/Member/manage/exhibitions/${f.id}/shifts`);await page.getByRole('tab',{name:'シフト表',exact:true}).click();await expect(page.locator('[data-seat]')).toHaveCount(6);
 await page.locator('[data-seat]').first().click();let popup=page.locator('dialog.shift-dialog');await popup.locator('[data-person-search]').fill('別の会員');await popup.locator('[data-person="other"]').click();
 const warning=page.locator('dialog.shift-dialog').last();await expect(warning).toContainText('希望外');await warning.getByRole('button',{name:'警告を確認して保存'}).click();await expect(popup).toHaveCount(0);await expect(page.locator('[data-seat=""]').first()).toBeVisible();await expect.poll(async()=>(await f.get()).record.plan.assignments.length).toBe(1);
 await page.locator('[data-seat=""]').first().click();popup=page.locator('dialog.shift-dialog');await popup.locator('[data-guest-name]').fill('当日案内スタッフ');await popup.locator('[data-add-guest]').click();await page.locator('dialog.shift-dialog').last().getByRole('button',{name:'警告を確認して保存'}).click();await expect(popup).toHaveCount(0);
 let d=await f.get();expect(d.record.plan.assignments).toHaveLength(2);expect(d.record.responses).toHaveLength(0);expect(d.record.guests[0].name).toBe('当日案内スタッフ');await expect(page.getByRole('button',{name:'別の会員',exact:true})).toBeVisible();
 await page.locator('[data-action="generate"]').click();await expect.poll(async()=>(await f.get()).record.job?.state).toBe('ready');await expect.poll(async()=>(await f.get()).record.plan.assignments.length).toBe(2);
 await page.screenshot({path:info.outputPath(`shift-manual-${width}.png`),fullPage:true});
 await page.locator('[data-action="publish"]').click();await page.locator('dialog.shift-dialog').getByRole('button',{name:'公開する',exact:true}).click();await expect(page.locator('dialog.shift-dialog')).toHaveCount(0);await expect.poll(async()=>(await f.get()).record.published?.version).toBe(1);
 await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-response-search]').fill('別の会員');await expect(page.locator('[data-response-rows] > li')).toHaveCount(1);await expect(page.locator('[data-response-rows]')).toContainText('未提出');await page.locator('[data-response]').click();await expect(page.locator('dialog.shift-dialog')).toContainText('提出はまだありません');await page.locator('.shift-close').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(errors).toEqual([]);
});
test('optional uninvited member saves and submits, exclusive none, published table stays visible',async({page},info)=>{
 const f=await setup(page,`シフト会員 ${info.project.name}`);await login(page,'other@example.invalid');await page.setViewportSize({width:390,height:900});await page.goto(`/Member/exhibitions/${f.id}/shifts`);await expect(page.locator('[data-slot]')).toHaveCount(3);await page.locator('[data-slot]').first().check();await expect(page.locator('[data-draft-state]')).toHaveText('下書き保存済み');
 const get=async()=>await(await page.request.get(`/api/exhibitions/${f.id}/shifts`)).json();await expect.poll(async()=>(await get()).response?.draft.slotIds.length).toBe(1);await page.getByLabel('入れる時間はない',{exact:true}).check();await expect(page.locator('[data-slot]:checked')).toHaveCount(0);await page.getByRole('button',{name:'シフト希望を提出',exact:true}).click();await expect.poll(async()=>(await get()).response?.submitted?.none).toBe(true);await page.reload();await expect(page.getByRole('button',{name:'回答を更新して提出'})).toBeVisible();
 await page.screenshot({path:info.outputPath('shift-member-mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
