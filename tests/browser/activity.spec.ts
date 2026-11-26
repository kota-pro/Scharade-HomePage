import {test,expect} from '@playwright/test';
import path from 'node:path';

test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='127.0.0.1')return route.continue();
  if(url.hostname.endsWith('microcms-assets.io'))return route.fulfill({path:path.resolve('public/media/site/activity/Photo1-480.webp'),contentType:'image/webp'});
  return route.abort();
 });
});

test('Activity links open Japanese articles with punctuation and return to the list',async({page})=>{
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:844});
  for(const title of ['暗室の使い方②　〜現像編〜','暗室の使い方①　〜導入編〜','ホームページを作成しました！','撮影会 [春] #1? 100%','literal%20text']) {
   await page.goto('/Activity');
   const article=page.locator('.tab-panel.is-active .Activity-item').filter({has:page.getByRole('heading',{name:title,exact:true})});
   const [response]=await Promise.all([
    page.waitForResponse(r=>r.request().isNavigationRequest()&&r.url().includes('/posts/')),
    article.getByRole('link',{name:title,exact:true}).click(),
   ]);
   expect(response.status(),title).toBe(200);
   await expect(page.locator('.post-title')).toHaveText(title);
   await expect(page.locator('.post-body')).toContainText('試験用の記事本文です。');
   await page.getByRole('link',{name:'Activityへ戻る',exact:true}).click();
   await expect(page).toHaveURL(/\/Activity$/);
  }
 }
});

test('Home, search and sitemap keep the same encoded blog URL',async({page,request})=>{
 const title='暗室の使い方②　〜現像編〜';
 const url='/posts/'+encodeURIComponent(title);
 await page.goto('/');
 await page.locator(`.Activity-item a[href="${url}?from=home"]`).first().click();
 await expect(page.locator('.post-title')).toHaveText(title);
 await page.goto('/SearchResult?q='+encodeURIComponent('現像編'));
 await page.locator(`a[href="${url}"]`).click();
 await expect(page.locator('.post-title')).toHaveText(title);
 expect(await (await request.get('/sitemap.xml')).text()).toContain(url);
 expect((await request.get('/posts/'+encodeURIComponent('存在しない記事！'))).status()).toBe(404);
 expect((await request.get('/posts/'+encodeURIComponent('test-post[or]slug[exists]'))).status()).toBe(404);
 expect((await request.get('/posts/test-post')).status()).toBe(200);
 expect((await request.get('/posts/test-post/')).status()).toBe(200);
});

test('Japanese tag buttons select the corresponding articles on Activity and Home',async({page})=>{
 const cases:[string,string[]][]=[
  ['暗室',['暗室の使い方②　〜現像編〜','暗室の使い方①　〜導入編〜']],
  ['撮影会',['撮影会のお知らせ']],
  ['お知らせ',['ホームページを作成しました！']],
  ['All',['撮影会 [春] #1? 100%']],
  ['all',['literal%20text']],
 ];
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:844});
  for(const route of ['/Activity','/']) {
   await page.goto(route);
   const tabs=page.locator(route==='/' ? '.Activity .tab' : '.body-contents .tab');
   for(const [tag,titles] of cases) {
    await tabs.locator('label').filter({hasText:new RegExp('^'+tag+'$')}).click();
    await expect(tabs.locator('.Activity-item:visible .Activity-title'),`${route}: ${tag}`).toHaveText(titles);
   }
   await tabs.locator('label').filter({hasText:'All tags'}).click();
   await expect(tabs.locator('.Activity-item:visible')).toHaveCount(route==='/' ? 3 : 6);
  }
 }
});
