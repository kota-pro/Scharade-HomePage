import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { fixtureLogin } from './fixture-auth';
const origin='http://127.0.0.1:4329',headers={Origin:origin};
const login=async(request:any,id:string)=>expect((await fixtureLogin(request,'/api/auth/login',{headers,data:{email:`${id}@example.invalid`,password:'fixture-password-123'}})).status()).toBe(200);
test.beforeEach(async({page})=>{await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());});
test('Staff uses the Admin design on desktop and mobile; roster routes and mutations require administrator',async({page,browser},info)=>{
 await login(page.request,'planner');
 const admin=await browser.newContext({baseURL:origin}),member=await browser.newContext({baseURL:origin}),guest=await browser.newContext({baseURL:origin});
 try{
  await login(admin.request,'admin');await login(member.request,'member');
  for(const path of ['/Admin/grouping-roster','/Admin/grouping-roster/preview?id=example','/Member/manage/profiles','/Member/manage/roster-preview?id=example']){
   expect((await page.request.get(path)).status()).toBe(403);expect((await member.request.get(path)).status()).toBe(403);
   expect((await guest.request.get(path,{maxRedirects:0})).status()).toBe(302);
  }
  for(const [old,next] of [['/Member/manage/profiles?tab=all','/Admin/grouping-roster?tab=all'],['/Member/manage/roster-preview?id=example','/Admin/grouping-roster/preview?id=example']]){
   const response=await admin.request.get(old,{maxRedirects:0});expect(response.status()).toBe(302);expect(response.headers().location).toBe(next);
  }
  for(const action of ['roster.sync','roster.link','roster.preview','roster.apply','roster.retry'])expect((await page.request.post('/api/member/activities',{headers,data:{action,revision:0}})).status()).toBe(403);
  const adminPage=await admin.newPage();await adminPage.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:900});await adminPage.setViewportSize({width,height:900});await page.goto('/Member/manage');await adminPage.goto('/Admin');
   const style=async(p:any)=>p.locator('.admin-title h1').evaluate((el:HTMLElement)=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.letterSpacing,s.paddingRight,s.fontWeight];});
   expect(await style(page)).toEqual(await style(adminPage));
   await expect(page.getByRole('heading',{name:'Staff',exact:true})).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   expect(await page.locator('a[href="/Member/manage/profiles"]').count()).toBe(0);
   await expect(page.getByRole('link',{name:'写真展管理',exact:true})).toBeVisible();
   if(width!==320)await page.screenshot({path:info.outputPath(`staff-${width}.png`),fullPage:true});
  }
  await expect(adminPage.getByRole('link',{name:'班分け用名簿',exact:true})).toHaveAttribute('href','/Admin/grouping-roster');
  await adminPage.getByRole('link',{name:'班分け用名簿',exact:true}).click();await expect(adminPage.locator('[data-activity-action="roster.sync"]')).toBeVisible();
  for(const path of ['/Member/manage/events/new','/Member/manage/notifications','/Member/manage/grouping','/Member/manage/exhibitions']){
   await page.goto(path);await expect(page.locator('.staff-page')).toBeVisible();await expect(page.getByRole('heading',{name:'Staff',exact:true})).toBeVisible();expect(await page.locator('.member-page').count()).toBe(0);
  }
  await page.goto('/Member');await expect(page.getByRole('heading',{name:'Member',exact:true})).toBeVisible();await expect(page.locator('.member-page')).toBeVisible();
 }finally{await admin.close();await member.close();await guest.close();}
});
test('operator configures limits, previews them, and respondent can save oversized drafts without losing work',async({page,browser},info)=>{
 test.setTimeout(120000);await login(page.request,'planner');
 const id=`f4000000-0000-4000-8000-00000000000${['chromium','firefox','webkit'].indexOf(info.project.name)+1}`;
 await page.goto(`/Member/manage/exhibitions/${id}/form`);
 await expect(page.locator('[data-total-work-limit]')).toBeVisible();await expect(page.locator('input[data-limit-frame]')).toHaveCount(0);await expect(page.locator('[data-limit-frame-select]')).toHaveCount(1);
 await page.locator('[data-total-work-limit]').fill('0');await page.locator('[data-save-schema]').click();await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('[data-total-work-limit]').fill('3');
 const normal=page.locator('[data-section-index="0"]');
 await normal.locator('[data-section-limit="maxWorks"]').fill('2');await normal.locator('[data-section-limit="maxLongEdgeMm"]').fill('300');await normal.locator('[data-section-limit="maxShortEdgeMm"]').fill('210');await normal.locator('[data-limit-frame-select]').selectOption('A4');
 await page.locator('[data-add-section]').click();const special=page.locator('[data-section-index="1"]');await special.locator('[data-section-key="title"]').fill('企画展');await special.locator('[data-section-limit="maxWorks"]').fill('1');await special.locator('[data-limit-frame-select]').selectOption('A5');await special.locator('[data-limit-frame-select]').selectOption('A1');await special.locator('[data-remove-limit-frame="A1"]').click();await expect(special.locator('[data-remove-limit-frame="A1"]')).toHaveCount(0);await special.locator('[data-limit-frame-select]').selectOption('none');await expect(special.locator('[data-remove-limit-frame]')).toHaveCount(0);await special.locator('[data-limit-frame-select]').selectOption('A5');for(const size of ['A1','A2','B1','B2','B3'])await special.locator('[data-limit-frame-select]').selectOption(size);
 await page.locator('[data-save-schema]').click();const preview=page.getByRole('dialog',{name:'保存前のフォームプレビュー'});await expect(preview.locator('[data-preview-total-limit]')).toContainText('最大3作品');await expect(preview.locator('[data-preview-total-limit]')).toContainText('ブックは対象外');await expect(preview.locator('[data-preview-section-limits]').last()).toContainText('JIS B1');await expect(preview.locator('[data-preview-section-limits]').first()).toContainText('300mm');
 await preview.locator('[data-confirm-schema]').click();await expect(preview).not.toBeVisible();await expect(page.locator('.exhibition-status')).toContainText('フォームを保存しました');await page.reload();await expect(normal.locator('[data-remove-limit-frame="A4"]')).toBeVisible();await expect(special.locator('[data-section-limit="maxWorks"]')).toHaveValue('1');for(const size of ['A1','A2','B1','B2','B3'])await expect(special.locator(`[data-remove-limit-frame="${size}"]`)).toBeVisible();
 let e=(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
  for(const width of [390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await normal.screenshot({path:info.outputPath(`limits-settings-${width}.png`)});}
 const normalId=e.schemas.at(-1).sections[0].id,specialId=e.schemas.at(-1).sections[1].id;
 const ctx=await browser.newContext({baseURL:origin});const input=await ctx.newPage();const errors:string[]=[];input.on('pageerror',e=>errors.push(e.message));await input.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 try{
  await login(ctx.request,'member');await input.goto(`/Exhibition/${id}`);await input.locator('[data-begin]').click();
  await input.locator('[data-common="name"]').fill('作者');await input.locator('[data-common="authorName"]').fill('作者');await input.locator('[data-common="grade"]').fill('1年');
  await input.locator(`[data-section-toggle="${normalId}"]`).check();await input.locator(`[data-section-toggle="${specialId}"]`).check();
  const n=input.locator(`[data-section="${normalId}"]`),s=input.locator(`[data-section="${specialId}"]`);
  const count=async(locator:any,value:string)=>{await locator.fill(value);await locator.press('Tab');};
  await count(n.locator('[data-count="series"]'),'1');await n.locator('[data-work-key="title"]').fill('組写真');
  await count(s.locator('[data-count="books"]'),'3');await expect(input.locator('[data-limit-total]')).toContainText('1 / 3作品');await expect(input.locator('[data-limit-errors="total"]')).toBeHidden();await expect(s.locator('[data-limit-errors="section"]')).toBeHidden();await expect(input.locator('[data-submit]')).toBeEnabled();
  await count(n.locator('[data-count="singles"]'),'2');await count(s.locator('[data-count="singles"]'),'1');await expect(input.locator('[data-limit-errors="total"]')).toContainText('現在4作品');await expect(n.locator('[data-limit-errors="section"]')).toContainText('最大2作品');await expect(input.locator('[data-submit]')).toBeDisabled();await expect(input.locator('[data-save]')).toBeEnabled();
  await count(n.locator('[data-count="singles"]'),'0');await count(s.locator('[data-count="singles"]'),'0');for(let i=0;i<3;i++)await s.locator('[data-work-key="title"]').nth(i).fill(`ブック${i+1}`);
  for(const size of ['A1','A2','B1','B2','B3'])await expect(n.locator(`[data-photo-paper="0"] option[value="${size}"]`)).toHaveCount(1);
  await n.locator('[data-photo-paper="0"]').selectOption('B1');await expect(n.locator('[data-photo-index="0"][data-photo-key="width"]')).toHaveValue('1030');await expect(n.locator('[data-photo-index="0"][data-photo-key="height"]')).toHaveValue('728');
  for(const index of [0,1])for(const key of ['width','height']){const el=n.locator(`[data-photo-index="${index}"][data-photo-key="${key}"]`);await el.fill('100');await el.press('Tab');}
  await n.locator('[data-photo-index="1"][data-photo-key="x"]').fill('200');await n.locator('[data-photo-index="1"][data-photo-key="x"]').press('Tab');await expect(n.locator('[data-limit-errors="work"]')).toContainText('上限を超え');
  await input.locator('[data-save]').click();await expect(input.locator('.exhibition-status')).toContainText('下書きを保存しました');await input.reload();await expect(n.locator('[data-photo-index="1"][data-photo-key="x"]')).toHaveValue('200');
  await n.locator('[data-photo-index="1"][data-photo-key="x"]').fill('197');await n.locator('[data-photo-index="1"][data-photo-key="x"]').press('Tab');await expect(input.locator('[data-submit]')).toBeEnabled();
  const bytes=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer();
  for(const index of [0,1]){await n.locator(`[data-upload-index="${index}"]`).setInputFiles({name:`photo${index}.png`,mimeType:'image/png',buffer:bytes});await expect(input.locator('.exhibition-status')).toContainText('写真を保存しました');await expect(input.locator('[data-save]')).toBeEnabled();}
  await input.locator('[data-save]').click();await expect(input.locator('.exhibition-status')).toContainText('下書きを保存しました');
  const saved=await(await ctx.request.get(`/api/exhibitions/${id}`)).json(),tooMany=structuredClone(saved.submission.draft);
  tooMany.sections.find((s:any)=>s.sectionId===normalId).singles=3;
  const series=tooMany.works.find((w:any)=>w.kind==='series');for(let i=0;i<3;i++)tooMany.works.push({...series,id:crypto.randomUUID(),kind:'single',photos:[series.photos[0]]});
  const countRejected=await ctx.request.post(`/api/exhibitions/${id}`,{headers,data:{action:'submit',revision:saved.submission.revision,content:tooMany}});expect(countRejected.status()).toBe(400);expect((await countRejected.json()).limitIssues.map((i:any)=>i.code)).toEqual(['total-count','section-count']);
  // Latest rule applies even while the question schema and entered form stay pinned to version 2.
  const latest=structuredClone(e.schemas.at(-1));latest.sections[0].limits.maxLongEdgeMm=250;latest.fields.push({id:crypto.randomUUID(),label:'新版のみの質問',description:'',type:'text',scope:'common',required:true,options:[]});
  const change=await page.request.post('/api/member/exhibitions',{headers,data:{action:'schema',exhibitionId:id,revision:e.revision,schema:latest}});expect(change.status()).toBe(200);
  await input.locator('[data-submit]').click();await expect(input.locator('.exhibition-status')).toContainText('上限を超え');await expect(input.locator('[data-submit]')).toBeDisabled();await expect(n.locator('[data-photo-index="1"][data-photo-key="x"]')).toHaveValue('197');await expect(n.locator('.exhibition-file-info').first()).toContainText('photo0.png');
  const current=await(await ctx.request.get(`/api/exhibitions/${id}`)).json();const rejected=await ctx.request.post(`/api/exhibitions/${id}`,{headers,data:{action:'submit',revision:current.submission.revision,content:current.submission.draft}});expect(rejected.status()).toBe(400);expect((await rejected.json()).limitIssues[0].code).toBe('size');
  await n.locator('[data-photo-index="1"][data-photo-key="x"]').fill('150');await n.locator('[data-photo-index="1"][data-photo-key="x"]').press('Tab');await expect(input.locator('[data-submit]')).toBeEnabled();await input.locator('[data-submit]').click();await expect(input.locator('.exhibition-status')).toContainText('提出しました');
  const result=await(await ctx.request.get(`/api/exhibitions/${id}`)).json();expect(result.submission.versions.length).toBe(1);expect(result.schema.version).toBe(2);expect(result.submission.draft.works.length).toBe(4);expect(errors).toEqual([]);
  for(const width of [390,1440]){await input.setViewportSize({width,height:900});await input.screenshot({path:info.outputPath(`submission-limits-${width}.png`),fullPage:true});await expect.poll(()=>input.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('#exhibition-submission *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right})).slice(0,8)})),{timeout:2000}).toMatchObject({width,scroll:width});}
 }finally{await ctx.close();}
});
