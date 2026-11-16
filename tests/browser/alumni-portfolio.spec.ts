import { test, expect } from '@playwright/test';
import { fixtureLogin } from './fixture-auth';
const archived = 'wpfqu4-8h10';
const origin = 'http://127.0.0.1:4329';
test.beforeEach(async ({page})=>{
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
});
test('alumni appear only in OB/OG even with old executive flags, on phone and desktop',async({page})=>{
 // The synthetic CMS fixtures include legacy grade spellings and an archived
 // profile with an old grade, so this checks the server-rendered grouping.
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:900}); await page.goto('/Portfolio');
  const all=page.locator('details.member-section-details').filter({has:page.locator('summary', {hasText:'All Members'})});
  const alumni=page.locator('details.member-section-details').filter({has:page.locator('summary', {hasText:'OB/OG'})});
  for(const id of [archived,'alumni-fixture-og','alumni-fixture-ob']) {
   await expect(all.locator(`a[href="/Portfolio/${id}"]`)).toHaveCount(0);
   await expect(page.locator(`.executive-section a[href="/Portfolio/${id}"]`)).toHaveCount(0);
   await expect(alumni.locator(`a[href="/Portfolio/${id}"]`)).toHaveCount(1);
   await expect(page.locator(`.member-card[href="/Portfolio/${id}"]`)).toHaveCount(1);
  }
  await alumni.locator('summary').click(); await expect(alumni.locator(`a[href="/Portfolio/${archived}"]`)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
});
test('orphan Portfolio edit page and save API remain administrator-only',async({page})=>{
 for(const [id,allowed] of [['other',false],['photo-staff-chromium',false],['photo-executive-chromium',false],['admin',true]] as const) {
  expect((await fixtureLogin(page.request,'/api/auth/login',{headers:{Origin:origin},data:{email:`${id}@example.invalid`,password:'fixture-password-123'}})).status()).toBe(200);
  const response=await page.goto(`/Portfolio/edit?id=${archived}`);
  expect(response!.status()).toBe(allowed?200:403);
  const save=await page.request.post('/api/portfolio/update',{headers:{Origin:origin},data:{portfolioId:archived,self_introduction:'架空アーカイブ編集'}});
  expect(save.status()).toBe(allowed?200:403);
  if(allowed) await expect(page.locator('#portfolio-form')).toBeVisible();
 }
});
