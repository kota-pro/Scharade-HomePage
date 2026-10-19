import { fixtureLogin } from "./fixture-auth";
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
  await popup.getByRole('button',{name:'この内容で保存',exact:true}).click();await expect(popup.locator('[data-preview-status]')).toContainText('保存を再試行');await expect(popup.getByRole('button',{name:'この内容で保存',exact:true})).toBeEnabled();
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
