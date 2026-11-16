import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
import {test,expect} from '@playwright/test';
const headers={Origin:'http://127.0.0.1:4329'};
async function create(page:any,title:string){
  await fixtureLogin(page.request, '/api/auth/login', {headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}});
  const r=await page.request.post('/api/member/exhibitions',{headers,data:{action:'create',title}});expect(r.status()).toBe(200);return(await r.json()).exhibition;
}
test('recipient picker supports all, none, grades and normalized name search, retaining hidden selections',async({page},info)=>{
  const e=await create(page,`通知選択 ${info.project.name}`);await page.goto(`/Member/manage/exhibitions/${e.id}`);
  const picker=page.locator('[data-recipient-picker]');await picker.getByRole('button',{name:'全解除',exact:true}).click();await expect(picker.locator('input[type=checkbox]:checked')).toHaveCount(0);
  await picker.getByRole('button',{name:'全選択',exact:true}).click();const total=await picker.locator('[data-recipient-id]').count();await expect(picker.locator('input[type=checkbox]:checked')).toHaveCount(total);
  await picker.locator('[data-recipient-search]').fill('別 の 会 員');await expect(picker.locator('[data-recipient-name]:visible')).toHaveCount(1);
  const unknown = picker.locator('label[data-recipient-grade="unknown"] input[type=checkbox]');
  const unknownCount = await unknown.count();
  await picker.locator('select[data-recipient-grade]').selectOption('unknown');await picker.getByRole('button',{name:'この学年を解除',exact:true}).click();await expect(picker.locator('label[data-recipient-grade="unknown"] input[type=checkbox]:checked')).toHaveCount(0);
  await expect(picker.locator('input[type=checkbox]:checked')).toHaveCount(total - unknownCount);
  await picker.getByRole('button',{name:'この学年を選択',exact:true}).click();await expect(picker.locator('input[type=checkbox]:checked')).toHaveCount(total);
  await picker.locator('[data-recipient-search]').fill('該当しない名前');await expect(picker.locator('[data-recipient-name]:visible')).toHaveCount(0);await picker.getByRole('button',{name:'全解除',exact:true}).click();
  await page.locator('[data-save-settings]').click();await expect(page.locator('.exhibition-status')).toContainText('受付設定を保存しました');
  expect((await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.participation.recipientIds).toEqual([]);
});
test('full width section description and popup preview preserve drafts until confirmed, including failed saves',async({page},info)=>{
  const e=await create(page,`保存プレビュー ${info.project.name}`);await page.goto(`/Member/manage/exhibitions/${e.id}/form`);
  const description=page.locator('textarea[data-section-key="description"]');await description.fill('ゆったりした説明欄で企画展の案内を入力');
  for(const width of [1440,1024,375]){await page.setViewportSize({width,height:900});const r=await description.boundingBox(),parent=await description.locator('..').boundingBox();expect(r!.width).toBeGreaterThan(parent!.width-4);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true);}
  await page.locator('[data-save-schema]').click();const popup=page.getByRole('dialog',{name:'保存前のフォームプレビュー'});await expect(popup).toBeVisible();await expect(popup).toHaveCSS('background-color','rgb(255, 255, 255)');await expect(popup).toHaveCSS('opacity','1');await expect(popup).toContainText('ゆったりした説明欄');await expect(popup.getByLabel('名前（必須）',{exact:true})).toBeDisabled();await page.screenshot({path:`/private/tmp/exhibition-management-20261009/preview-mobile-${info.project.name}.png`});
  expect((await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.schemas.length).toBe(1);
  await popup.getByRole('button',{name:'戻って編集',exact:true}).last().click();await expect(description).toHaveValue('ゆったりした説明欄で企画展の案内を入力');
  await page.locator('[data-save-schema]').click();await page.route('**/api/member/exhibitions',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'保存を再試行してください'})}));
  await popup.getByRole('button',{name:'この内容で保存',exact:true}).click();await expect(popup.locator('[data-preview-status]')).toContainText('EXH-015');await expect(popup.locator('[data-preview-status]')).toContainText('保存できませんでした');await expect(popup.getByRole('button',{name:'この内容で保存',exact:true})).toBeEnabled();
  await page.unroute('**/api/member/exhibitions');await page.setViewportSize({width:1440,height:1000});await popup.evaluate(el=>el.scrollTop=0);await page.screenshot({path:`/private/tmp/exhibition-management-20261009/preview-${info.project.name}.png`});
  await popup.getByRole('button',{name:'この内容で保存',exact:true}).click();await expect(popup).toHaveCount(0);await expect(page.locator('.exhibition-status')).toContainText('フォームを保存しました');
  const saved=(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;expect(saved.schemas.length).toBe(2);expect(saved.schemas.at(-1).sections[0].description).toContain('ゆったり');
});
test('staff can delete a confirmed exhibition and members cannot delete it',async({page,browser},info)=>{
  const e=await create(page,`削除確認 ${info.project.name}`),member=await browser.newContext();try{
    await fixtureLogin(member.request, 'http://127.0.0.1:4329/api/auth/login', {headers,data:{email:'member@example.invalid',password:'fixture-password-123'}});
    expect((await member.request.post('http://127.0.0.1:4329/api/member/exhibitions',{headers,data:{action:'delete',exhibitionId:e.id,revision:e.revision,confirmation:e.title}})).status()).toBe(403);
    await page.goto(`/Member/manage/exhibitions/${e.id}`);await page.locator('[data-delete-exhibition]').click();const dialog=page.getByRole('dialog',{name:'写真展の削除確認'});await expect(dialog.locator('[data-delete-confirm]')).toBeDisabled();await dialog.locator('[data-delete-title]').fill(e.title);await dialog.locator('[data-delete-confirm]').click();await expect(page).toHaveURL(/exhibitions\?deleted=1$/);
    expect((await page.request.get(`/api/member/exhibitions/${e.id}`)).status()).toBe(404);
  }finally{await member.close();}
});

test('extended voting invites additional recipients and staff can find recipients and added attendees by LINE name', async ({page,browser},info)=>{
  test.setTimeout(90000);
  await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'admin@example.invalid',password:'fixture-password-123'}});
  await restoreFixtureRoster(page.request);
  await page.goto('/Admin/grouping-roster');
  const revision=Number(await page.locator('[data-activity-action="roster.sync"]').getAttribute('data-revision'));
  const bindings:Record<string,string>={};
  for(const id of ['activity-0','activity-1','activity-2']) {
    bindings[id]=await page.locator(`[data-roster-user="${id}"]`).inputValue();
    expect(bindings[id]).toMatch(/^[a-f0-9]{64}$/);
  }
  const linked=await page.request.post('/api/member/activities',{headers,data:{action:'roster.link',revision,bindings}});
  expect(linked.status(),await linked.text()).toBe(200);
  const e=await create(page,`追加通知・LINE検索 ${info.project.name}`),url=`/api/member/exhibitions/${e.id}`;
  const snapshot=async()=>await(await page.request.get(url)).json();
  const now=Date.now(),iso=(delta:number)=>new Date(now+delta).toISOString(),local=(delta:number)=>new Date(now+delta+9*3600000).toISOString().slice(0,16);
  const save=async(extra:Record<string,unknown>)=>{
    const current=(await snapshot()).exhibition;
    const r=await page.request.post('/api/member/exhibitions',{headers,data:{action:'settings',exhibitionId:e.id,revision:current.revision,title:e.title,status:'open',gallery:'staff',voteOpensAt:iso(-3600000),voteClosesAt:iso(7200000),opensAt:iso(-3600000),closesAt:iso(3600000),...extra}});
    expect(r.status(),await r.text()).toBe(200);return(await r.json()).exhibition;
  };
  let current=await save({recipientIds:['activity-0']});
  expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'participation.publish',exhibitionId:e.id,revision:current.revision}})).status()).toBe(200);
  await expect.poll(async()=>(await snapshot()).exhibition.participation.state).toBe('published');
  current=(await snapshot()).exhibition;
  expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'participation.attendance.set',exhibitionId:e.id,revision:current.revision,userId:'activity-0',vote:'undecided'}})).status()).toBe(200);
  await save({voteClosesAt:iso(-120000)});
  const before=await snapshot();
  await page.goto(`/Member/manage/exhibitions/${e.id}`);
  const picker=page.locator('[data-recipient-picker]');
  await expect(picker.locator('[data-recipient-id="activity-0"]')).toBeDisabled();
  await expect(picker.locator('[data-recipient-id="activity-0"]')).toBeChecked();
  await picker.getByRole('button',{name:'全解除',exact:true}).click();
  await expect(picker.locator('input:checked')).toHaveCount(1);
  await picker.locator('[data-recipient-search]').fill('ＬＩＮＥ １');
  await expect(picker.locator('[data-recipient-name]:visible')).toHaveCount(1);
  await expect(picker.locator('[data-recipient-name]:visible')).toContainText('撮影会員 activity-1（line1）');
  await picker.locator('[data-recipient-id="activity-1"]').check();
  await picker.locator('[data-recipient-search]').fill('一致しない名前');
  await page.locator('[data-setting="voteClosesAt"]').fill(local(7200000));
  await page.locator('[data-save-settings]').click();
  await expect(page.locator('.exhibition-status')).toContainText('受付設定を保存しました');
  await expect.poll(async()=>(await snapshot()).exhibition.notices.at(-1).deliveredAt).toBeTruthy();
  const added=await snapshot();
  expect(added.exhibition.participation.recipientIds).toEqual(['activity-0','activity-1']);
  expect(added.exhibition.participation.votes).toEqual(before.exhibition.participation.votes);
  expect(added.exhibition.participation.noticeId).toBe(before.exhibition.participation.noticeId);
  expect(added.submissions).toEqual(before.submissions);
  expect(added.exhibition.notices.at(-1).recipientIds).toEqual(['activity-1']);
  await page.locator('[data-save-settings]').click();
  await expect(page.locator('.exhibition-status')).toContainText('受付設定を保存しました');
  expect((await snapshot()).exhibition.notices.length).toBe(added.exhibition.notices.length);
  await page.goto(`/Member/manage/exhibitions/${e.id}/participants`);
  const search=page.getByRole('searchbox',{name:'追加する参加者を検索'}),select=page.getByRole('combobox',{name:'追加する参加者',exact:true});
  await expect(page.locator('[data-attendee-add]')).toBeDisabled();
  await expect(select.locator('option[value="activity-1"]')).toHaveCount(0);
  await search.fill('ＬＩＮＥ ２');
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option[value="activity-2"]')).toHaveText('撮影会員 activity-2（line2）');
  await select.selectOption('activity-2');
  await search.fill('該当なし');
  await expect(select).toHaveValue('activity-2');
  await expect(select.locator('option[value="activity-2"]')).toContainText('選択中');
  for(const width of [1440,375]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2)).toBe(true);}
  await page.locator('[data-attendee-add]').click();
  await expect(page.locator('.exhibition-status')).toContainText('参加者に追加しました');
  expect((await snapshot()).exhibition.participation.votes['activity-2'].value).toBe('attending');
  await page.locator('[data-participant-filter="query"]').fill('ＬＩＮＥ ２');
  await expect(page.locator('[data-participant-row]:visible')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('participant-line-search-mobile.png'),fullPage:true});
  await page.goto('/Member/manage/notifications');
  await page.locator('[data-recipient-search]').fill('ＬＩＮＥ ２');
  await expect(page.locator('[data-recipient-name]:visible')).toHaveCount(1);
  await expect(page.locator('[data-recipient-name]:visible')).toContainText('撮影会員 activity-2（line2）');
  const context=await browser.newContext();
  try{
    await fixtureLogin(context.request,'http://127.0.0.1:4329/api/auth/login',{headers,data:{email:'activity-1@example.invalid',password:'fixture-password-123'}});
    const member=await context.newPage();await member.goto(`http://127.0.0.1:4329/Member/exhibitions/${e.id}`);
    await expect(member.getByText('現在の回答：未回答',{exact:true})).toBeVisible();
    await member.locator('[data-exhibition-answer="attending"]').click();
    await expect(member.getByRole('link',{name:'出展フォームを入力する',exact:true})).toBeVisible();
  }finally{await context.close();}
});
