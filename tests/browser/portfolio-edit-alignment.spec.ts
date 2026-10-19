import { fixtureLogin } from "./fixture-auth";
import { test, expect } from '@playwright/test';
import path from 'node:path';

test('edit links keep their alignment across short and long profiles, SNS settings, and admin access', async ({page}, info) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname.endsWith('microcms-assets.io')) return route.fulfill({path:path.resolve('public/media/site/activity/Photo1-480.webp'),contentType:'image/webp'});
    return route.abort();
  });
  async function checkAlignment(width: number) {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await expect.poll(() => page.evaluate((mobile) => {
      const edit = document.querySelector('.edit-link')!.getBoundingClientRect();
      const rowElement = document.querySelector('#post-back-link')!;
      const row = rowElement.getBoundingClientRect();
      const style = getComputedStyle(rowElement);
      const target = mobile ? row.right - parseFloat(style.paddingRight) : row.left + parseFloat(style.paddingLeft);
      return Math.abs((mobile ? edit.right : edit.left) - target);
    }, width <= 768)).toBeLessThan(1);
    const geometry = await page.evaluate(() => {
      const edit = document.querySelector('.edit-link')!.getBoundingClientRect();
      const back = document.querySelector('#post-back-link > a')!.getBoundingClientRect();
      return {editTop:edit.top,editBottom:edit.bottom,backTop:back.top,editRight:edit.right,backLeft:back.left,overflow:document.documentElement.scrollWidth > innerWidth + 1};
    });
    expect(geometry.overflow).toBe(false);
    if (width <= 768) expect(geometry.backTop).toBeGreaterThanOrEqual(geometry.editBottom);
    else {
      expect(Math.abs(geometry.editTop - geometry.backTop)).toBeLessThan(1);
      expect(geometry.editRight).toBeLessThan(geometry.backLeft);
    }
  }
  for (const account of ['other', 'member', 'admin']) {
    expect((await fixtureLogin(page.request, '/api/auth/login', {headers:{Origin:'http://127.0.0.1:4329'},data:{email:account+'@example.invalid',password:'fixture-password-123'}})).status()).toBe(200);
    await page.goto('/Portfolio/'+account);
    await expect(page.getByRole('link',{name:'Edit my portfolio',exact:true})).toHaveAttribute('href','/Portfolio/edit?id='+account);
    for (const width of [320,390,768,769,1024,1440,1920]) {
      await page.setViewportSize({width,height:1000});
      await checkAlignment(width);
    }
    if (account === 'admin') {
      await page.setViewportSize({width:1440,height:1000});
      await page.screenshot({path:info.outputPath('portfolio-edit-desktop.png')});
    }
  }
  await page.goto('/Portfolio/other');
  await expect(page.getByRole('link',{name:'Edit portfolio',exact:true})).toHaveAttribute('href','/Portfolio/edit?id=other');
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});
    await checkAlignment(width);
  }
  await page.screenshot({path:info.outputPath('portfolio-edit-mobile.png')});
});
