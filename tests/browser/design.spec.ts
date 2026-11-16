import {test,expect} from "@playwright/test";
import path from "node:path";
test.beforeEach(async ({page}) => {
 await page.route("**/*", route => {
  const url=new URL(route.request().url());
  if(url.hostname === "127.0.0.1")return route.continue();
  if(url.hostname.endsWith("microcms-assets.io"))return route.fulfill({path:path.resolve("public/media/site/activity/Photo1-480.webp"),contentType:"image/webp"});
  return route.abort();
 });
});
test("original film motion, card reveal, schedule tabs and equipment slideshow remain usable",async ({page}) => {
 await page.setViewportSize({width:1440,height:900});await page.goto("/");
 await page.locator(".photo-carousel").scrollIntoViewIfNeeded();
 const track=page.locator(".photo-carousel-contents ul").first();
 const before=await track.evaluate(e=>getComputedStyle(e).transform);
 await expect.poll(()=>track.evaluate(e=>getComputedStyle(e).transform)).not.toBe(before);
 // Retarget after the carousel's initial image layout changes the page geometry.
 await expect.poll(async () => {
  await page.locator("#card-2").hover();
  return page.locator("#card-2 p").evaluate(e => getComputedStyle(e).opacity);
 }).toBe("1");
 await page.locator(".main-visual-photo3").click();
 await expect(page.locator("#photo-dialog [data-photo-image]")).toBeVisible();
 await page.keyboard.press("Escape");await expect(page.locator("#photo-dialog")).not.toBeVisible();
 await page.goto("/About_us");
 await page.locator('label[for="tab2"]').click();
 await expect(page.locator("#card-jul")).toBeVisible();
 await expect(page.locator("#card-apr-may")).not.toBeVisible();
 await page.locator(".equipment-image").first().scrollIntoViewIfNeeded();
 const first=page.locator(".image-container section").first();
 await expect(first).toHaveCSS("animation-duration","25s");
 await expect.poll(()=>first.locator("img").evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await expect.poll(()=>first.locator("img").evaluate(img=>img.getBoundingClientRect().width)).toBeGreaterThan(100);
});
test("contact confirmation preserves click-to-edit and prevents duplicate sends",async ({page}) => {
 await page.setViewportSize({width:390,height:844});await page.goto("/Contact");
 for(const [name,value] of Object.entries({name:"確認用",furigana:"かくにん",institution:"大学",email:"test@example.invalid",message:"本文"})) await page.locator(`[name="${name}"]`).fill(value);
 await page.locator('[name="grade"][value="1年"]').check();await page.getByLabel("見学・体験希望",{exact:true}).check();
 await page.getByRole("button",{name:"Confirm",exact:true}).click();
 await expect(page.locator("#preview-furigana")).toHaveText("カクニン");
 await page.locator("#preview-name").click();await expect(page.locator('[name="name"]')).toBeFocused();
 await page.getByRole("button",{name:"Confirm",exact:true}).click();
 let requests=0;
 await page.route("**/api/contact",async route=>{requests++;await new Promise(resolve=>setTimeout(resolve,300));await route.fulfill({json:{message:"隔離テスト送信完了"}});});
 await page.locator("#contact-send").evaluate((button:HTMLButtonElement)=>{button.click();button.click();});
 await expect(page.locator("#contact-result")).toHaveText("隔離テスト送信完了");expect(requests).toBe(1);
});

test("gallery keeps the original 100-photo pagination after additional metadata loads",async ({page}) => {
 await page.goto("/Gallery/public-album");
 await expect(page.locator(".photo-wrapper")).toHaveCount(135);
 await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
 await page.locator(".next-btn-top").click();
 await expect(page.locator(".photo-wrapper:visible")).toHaveCount(35);
 const image=page.locator(".photo-wrapper:visible img").first();
 await expect(image).toHaveAttribute("alt","写真 101");
 await expect(image).toHaveCSS("object-fit","contain");
 await expect(page.locator(".page-input-top")).toHaveValue("2");
 await page.locator(".prev-btn-top").click();
 await expect(page.locator(".photo-wrapper:visible")).toHaveCount(100);
});

test("Portfolio accordion hides closed cards and keeps headings and menu clickable",async ({page}) => {
 for (const width of [390,1440]) {
  await page.setViewportSize({width,height:844});
  await page.goto("/Portfolio");
  const sections=page.locator('details[name="member-section"]');
  const all=sections.filter({has:page.locator('summary').filter({hasText:/^\s*All Members\s*$/})});
  const first=sections.filter({has:page.locator('summary').filter({hasText:/^\s*1st Grade\s*$/})});
  const second=sections.filter({has:page.locator('summary').filter({hasText:/^\s*2nd Grade\s*$/})});
  const closedCards=page.locator('.member-section-details:not([open]) .member-card');
  const checkClosedCards=async()=>{
   // Even positioned/blended descendants must leave no rendered boxes to leak
   // through Safari's closed-details paint layer or intercept another tab.
   await expect.poll(()=>closedCards.evaluateAll(cards=>cards.every(card=>card.getClientRects().length===0))).toBe(true);
  };
  for (const id of ['admin','member','other']) await expect(all.locator(`a[href="/Portfolio/${id}"]`)).toHaveCount(1);
  await checkClosedCards();
  await first.locator('summary').click();
  await expect(all).not.toHaveAttribute('open');
  await expect(first.locator('.member-card').first()).toBeVisible();
  await checkClosedCards();
  await second.locator('summary').click();
  await expect(first).not.toHaveAttribute('open');
  await checkClosedCards();
  await all.locator('summary').click();
  await expect(second).not.toHaveAttribute('open');
  await expect(all.locator('.member-card').first()).toBeVisible();
  await checkClosedCards();
  await all.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(all).not.toHaveAttribute('open');
  await checkClosedCards();
  await page.keyboard.press('Enter');
  await all.locator('.member-card').first().scrollIntoViewIfNeeded();
  if(width>767) await page.evaluate(()=>window.scrollTo({top:200,behavior:'instant'}));
  await page.getByRole('button',{name:'メニューを開く'}).click();
  await page.locator('#site-menu a[href="/Portfolio"]').click();
  await expect(page).toHaveURL(/\/Portfolio$/);
  await expect(all.locator('.member-card').first()).toBeVisible();
 }
});

test("Portfolio with many members keeps every card above the next grade heading",async ({page}) => {
 for(const width of [390,768,1440]) {
  await page.setViewportSize({width,height:844});
  await page.goto('/Portfolio');
  const all=page.locator('details[name="member-section"][open]');
  // Use enough rows to expose a per-row height error as on the live 25-member list.
  await all.locator('.member-grid').evaluate(grid=>{
   const sample=grid.firstElementChild!;
   while(grid.children.length<25) grid.append(sample.cloneNode(true));
  });
  const fit=await all.evaluate(section=>{
   const grid=section.querySelector('.member-grid')!.getBoundingClientRect();
   const next=section.nextElementSibling!.getBoundingClientRect();
   return [...section.querySelectorAll('.member-card')].every(card=>{
    const r=card.getBoundingClientRect();
    return r.bottom<=grid.bottom+1&&r.bottom<next.top&&r.left>=grid.left-1&&r.right<=grid.right+1&&Math.abs(r.width-r.height)<=1;
   });
  });
  expect(fit,`all 25 square cards fit before the next heading at ${width}px`).toBe(true);
 }
});
