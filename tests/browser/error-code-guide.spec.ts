import {test, expect} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});

async function login(page: import('@playwright/test').Page) {
  expect((await fixtureLogin(page.request, '/api/auth/login', {headers:{Origin:'http://127.0.0.1:4329'},data:{email:'member@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
}

test('the footer shows Error Code List beside Disclaimer only while signed in', async ({page}) => {
  await page.goto('/Disclaimer');
  await expect(page.locator('footer a[href="/Errors"]')).toHaveCount(0);
  await login(page);await page.reload();
  const link=page.locator('footer a[href="/Errors"]');
  await expect(link).toHaveText('Error Code List');
  expect(await link.evaluate(el=>(el.previousElementSibling as HTMLAnchorElement)?.pathname)).toBe('/Disclaimer');
  await link.click();await expect(page.getByRole('heading',{level:1,name:'Error Code',exact:true})).toBeVisible();
  await expect(page.locator('footer a[href="/Errors"]')).toHaveAttribute('aria-current','page');
  await page.locator('#footer-logout').click();await page.waitForURL('http://127.0.0.1:4329/');
  await page.goto('/Disclaimer');await expect(page.locator('footer a[href="/Errors"]')).toHaveCount(0);
});

test('codes and incident descriptions filter locally, with normalization, empty results and clearing', async ({page}) => {
  const reports:string[]=[];
  page.on('request',request=>{if(request.url().endsWith('/api/error-reports'))reports.push(request.url());});
  await page.goto('/Errors');
  const search=page.getByRole('searchbox',{name:'エラーコード・障害の内容で検索'});
  const entries=page.locator('[data-error-code-entry]:visible');
  await expect(search).toBeVisible();await expect(entries).toHaveCount(38);
  await search.fill('ｅｘｈ－００１');await expect(entries).toHaveCount(1);await expect(page.locator('#EXH-001')).toBeVisible();
  await expect(page.locator('[data-error-code-group]').first()).toBeHidden();
  await search.fill('site016');await expect(entries).toHaveCount(1);await expect(page.locator('#SITE-016')).toBeVisible();
  await search.fill('通信');await expect(entries).toHaveCount(2);await expect(page.locator('#SITE-012')).toBeVisible();await expect(page.locator('#EXH-013')).toBeVisible();
  await search.fill('写真 添付');await expect(entries).toHaveCount(2);await expect(page.locator('#EXH-001')).toBeVisible();await expect(page.locator('#EXH-002')).toBeVisible();
  await search.fill('メールアドレスまたはパスワードが間違っています');await expect(entries).toHaveCount(1);await expect(page.locator('#SITE-016')).toBeVisible();
  await search.fill('該当しない検索内容');await expect(entries).toHaveCount(0);await expect(page.locator('[data-error-search-empty]')).toBeVisible();
  await expect(page.locator('[data-error-search-count]')).toHaveText('検索結果：0件 / 全38件');
  await page.getByRole('button',{name:'クリア',exact:true}).click();await expect(entries).toHaveCount(38);await expect(search).toHaveValue('');await expect(search).toBeFocused();
  await expect(page.locator('[data-error-search-empty]')).toBeHidden();
  expect(page.url()).toBe('http://127.0.0.1:4329/Errors');expect(reports).toHaveLength(0);
});

test('the Disclaimer typography and mobile footer arrangement remain readable at narrow and wide sizes', async ({page},info) => {
  await login(page);await page.goto('/Errors');
  for(const width of [320,375,768,1024,1440]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>window.scrollTo(0,0));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>{
      const disclaimer=document.querySelector('footer a[href="/Disclaimer"]')?.getBoundingClientRect(),errors=document.querySelector('footer a[href="/Errors"]')?.getBoundingClientRect();
      return !!disclaimer&&!!errors&&(innerWidth<=800
        ? Math.abs(disclaimer.x-errors.x)<2&&disclaimer.bottom<=errors.y+1
        : Math.abs(disclaimer.y-errors.y)<2&&disclaimer.right<=errors.x+1);
    })).toBe(true);
    if(width===375||width===1440){
      await page.screenshot({path:info.outputPath(`error-code-${width}.png`)});
      if(width===375)await page.locator('footer').screenshot({path:info.outputPath('error-code-footer-mobile.png')});
    }
  }
  const actual=await page.locator('.section-title h1').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,spacing:getComputedStyle(el).letterSpacing}));
  await page.goto('/Disclaimer');
  const reference=await page.locator('.section-title h1').evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,spacing:getComputedStyle(el).letterSpacing}));
  expect(actual).toEqual(reference);
});
