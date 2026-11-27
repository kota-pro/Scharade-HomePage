import { fixtureExhibition } from "./fixture-exhibition";
import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'};
const login=async(page:Page,email='member@example.invalid')=>expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);
async function fixture(page:Page,engine:string,source: 'form' | 'book' = 'book',books=1) {
  await login(page);const id=await fixtureExhibition(engine,"作品タイトルとふりがな",{source}),endpoint=`/api/exhibitions/${id}`;
  const initial=await(await page.request.get(endpoint)).json(),schema=initial.schema??initial.exhibition.schemas?.at(-1);
  const started=await page.request.post(endpoint,{headers,data:{action:'begin'}});expect(started.ok(),await started.text()).toBe(true);
  const value=await started.json(),sectionId=schema.sections[0].id,workId=crypto.randomUUID();
  const content={...value.submission.draft,name:'作者',authorName:'作者',grade:'2年',sections:[{sectionId,singles:0,series:0,books,seriesPhotoCounts:[],fields:{}}],works:Array.from({length:books},(_,i)=>({id:i?crypto.randomUUID():workId,sectionId,kind:'book',title:'永遠の記憶',caption:'',location:'',equipment:'',settings:'',photos:[],fields:{}}))};
  const saved=await page.request.post(endpoint,{headers,data:{action:'save',revision:value.submission.revision,content}});expect(saved.ok(),await saved.text()).toBe(true);
  await page.goto(`/Exhibition/${id}`);await expect(page.locator(`[data-titleboard-work="${workId}"]`)).toBeVisible();
  return{id,endpoint,workId,form:page.locator(`[data-titleboard-work="${workId}"]`),draft:async()=> (await(await page.request.get(endpoint)).json()).submission.draft};
}
test('readings and per-work photography permission survive autosave, preview, submission and staff correction',async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=await fixture(page,info.project.name,'book',2);
  await page.locator('[data-help-open]').click();
  await page.locator('#help-query').fill('撮影NG');
  await page.locator('#help-search-results').getByRole('button', { name: /展示作品の撮影可否を設定する/ }).click();
  await expect(f.form.getByRole('radio', { name: '撮影NG', exact: true })).toHaveClass(/help-target/);
  await expect(f.form.locator('.titleboard-photography legend')).toHaveClass(/help-marker/);
  await page.locator('[data-help-stop]').click();
  await expect(page.getByRole('radio',{name:'撮影OK',exact:true}).nth(1)).toBeChecked();
  await f.form.getByRole('radio',{name:'撮影NG',exact:true}).check();
  await expect(page.getByRole('radio',{name:'撮影OK',exact:true}).nth(1)).toBeChecked();
  const input=(start:number,end=start+1,group=false)=>f.form.locator(`[data-title-ruby-reading][data-ruby-start="${start}"][data-ruby-end="${end}"][data-ruby-group="${group}"]`);
  await expect(f.form.locator('[data-titleboard-quoted]')).toBeChecked();await expect(f.form.locator('[data-titleboard-ruby-pane]')).toBeHidden();
  await f.form.locator('[data-titleboard-enabled]').check();await expect(f.form.locator('[data-title-ruby-reading]')).toHaveCount(4);
  for(const [start,text]of [[0,'えい'],[1,'えん'],[3,'き'],[4,'おく']] as const)await input(start).fill(text);
  await f.form.locator('[data-title-ruby-target]').fill('永遠');await f.form.locator('[data-title-ruby-add]').click();await expect(f.form.locator('[data-title-ruby-reading]')).toHaveCount(3);await input(0,2,true).fill('ずっと');
  await f.form.locator('[data-titleboard-quoted]').uncheck();
  await expect.poll(async()=>(await f.draft()).works[0].titleBoard?.quoted).toBe(false);
  await expect.poll(async()=>(await f.draft()).works[0].titleBoard?.noPhotography).toBe(true);
  await expect.poll(async()=>(await f.draft()).works[0].titleBoard?.ruby.find((r:any)=>r.group)?.reading).toBe('ずっと');
  await page.reload();await expect(f.form.locator('[data-titleboard-quoted]')).not.toBeChecked();await expect(input(0,2,true)).toHaveValue('ずっと');await expect(f.form.getByRole('radio',{name:'撮影NG',exact:true})).toBeChecked();
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await f.form.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);await f.form.screenshot({path:info.outputPath(`ruby-fields-${width}.png`),style:"header{visibility:hidden!important}"});}
  await page.locator('[data-preview-boards]').click();const preview=page.locator('.board-preview-dialog img').first();await expect(preview).toBeVisible();
  const hasRedMark=()=>preview.evaluate(async(img:HTMLImageElement)=>{
    await img.decode();
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
    const {data}=ctx.getImageData(canvas.width*.8,canvas.height*.1,canvas.width*.15,canvas.height*.2);
    for(let i=0;i<data.length;i+=4)if(data[i]>140&&data[i+1]<70&&data[i+2]<85)return true;
    return false;
  });
  expect(await hasRedMark()).toBe(true);
  await page.locator('[data-board-preview-next]').click();
  await expect(preview).toBeVisible();expect(await hasRedMark()).toBe(false);
  await page.keyboard.press('Escape');
  const [submitted] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(f.endpoint) && response.request().method() === 'POST' && response.request().postDataJSON().action === 'submit'),
    page.locator('[data-submit]').click(),
  ]);
  expect(submitted.ok(), await submitted.text()).toBe(true);
  expect((await submitted.json()).submission.versions).toHaveLength(1);
  await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  await login(page,'planner@example.invalid');await page.goto(`/Member/manage/exhibitions/${f.id}/submissions`);await page.locator('[data-submission-tab="works"]').click();await page.locator('.submission-work-card [data-submission-detail]').first().click();
  const modal=page.locator('.submission-detail-dialog'),staff=modal.locator(`[data-titleboard-work="${f.workId}"]`);await expect(staff.locator('[data-titleboard-quoted]')).not.toBeChecked();await expect(staff.locator('[data-title-ruby-reading][data-ruby-group="true"]')).toHaveValue('ずっと');
  await expect(staff.getByRole('radio',{name:'撮影NG',exact:true})).toBeChecked();
  await staff.getByRole('radio',{name:'撮影OK',exact:true}).check();
  await staff.locator('[data-titleboard-quoted]').check();await modal.locator('[data-se-next]').click();
  await expect(modal).toContainText('タイトルの鉤括弧');await expect(modal).toContainText('撮影可否');await modal.locator('[data-se-save]').click();
  await expect.poll(async()=>(await(await page.request.get(`/api/member/exhibitions/${f.id}`)).json()).submissions[0].content.works[0].titleBoard).toMatchObject({quoted:true});
  expect((await(await page.request.get(`/api/member/exhibitions/${f.id}`)).json()).submissions[0].content.works[0].titleBoard.noPhotography).toBeUndefined();
  await page.keyboard.press('Escape');expect(errors).toEqual([]);
});
test('word removal restores character readings; repeated words select exact positions and invalid readings warn',async({page},info)=>{
  const f=await fixture(page,info.project.name,'form');await f.form.locator('[data-titleboard-enabled]').check();
  await f.form.locator('[data-title-ruby-reading][data-ruby-start="0"]').fill('えい');await f.form.locator('[data-title-ruby-reading][data-ruby-start="1"]').fill('えん');
  await f.form.locator('[data-title-ruby-target]').fill('永遠');await f.form.locator('[data-title-ruby-add]').click();await f.form.locator('[data-title-ruby-reading][data-ruby-group="true"]').fill('ずっと');await f.form.locator('[data-title-ruby-remove]').click();
  await expect(f.form.locator('[data-title-ruby-reading][data-ruby-start="0"]')).toHaveValue('えい');await expect(f.form.locator('[data-title-ruby-reading][data-ruby-start="1"]')).toHaveValue('えん');
  await page.locator(`[data-work-id="${f.workId}"][data-work-key="title"]`).fill('永遠と永遠');
  await f.form.locator('[data-title-ruby-target]').fill('永遠');await expect(f.form.locator('[data-title-ruby-occurrence] option')).toHaveCount(2);await f.form.locator('[data-title-ruby-occurrence]').selectOption('3');await f.form.locator('[data-title-ruby-add]').click();
  const grouped=f.form.locator('[data-title-ruby-reading][data-ruby-group="true"]');await expect(grouped).toHaveAttribute('data-ruby-start','3');await grouped.fill('ずっと');
  await f.form.locator('[data-title-ruby-target]').fill('永遠と');await expect(f.form.locator('[data-title-ruby-add]')).toBeEnabled();await f.form.locator('[data-title-ruby-add]').click();await f.form.locator('[data-title-ruby-reading][data-ruby-start="0"][data-ruby-group="true"]').fill('あ'.repeat(40));await expect(f.form.locator('[data-text-warning]').first()).toBeVisible();
  await page.locator('[data-submit]').click();await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  await f.form.locator('[data-titleboard-enabled]').uncheck();await expect(f.form.locator('[data-titleboard-ruby-pane]')).toBeHidden();
});
