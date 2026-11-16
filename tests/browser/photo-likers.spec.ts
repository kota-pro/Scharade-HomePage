import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
async function session(browser: Browser, email: string) {
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
  expect((await fixtureLogin(context.request, "/api/auth/login", { headers, data: { email, password: "fixture-password-123" } })).ok()).toBe(true); return context;
}
async function images(page: Page) {
  await page.route("**/*", route => { const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${/-2\.jpg$/.test(url.pathname) ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="#b3c6ce"/></svg>` });
    return route.abort();
  });
}
async function state(context: BrowserContext, ref: any) { const response = await context.request.post("/api/photos/state", { headers, data: { refs: [ref] } }); expect(response.ok()).toBe(true); const body = await response.json(); expect(body.results[0].ok).toBe(true); return body.results[0].photo; }
async function like(context: BrowserContext, ref: any, liked: boolean) { const response = await context.request.post("/api/photos/like", { headers, data: { ref, liked, likerId: "forged-account" } }); expect(response.ok()).toBe(true); return (await response.json()).photo; }
const bell = (page: Page) => page.locator('[data-placement="member"]:visible');

test("owners see signed-in senders in notifications, photo counts and rankings while guests stay anonymous", async ({ browser }, info) => {
  const id = `photo-owner-${info.project.name}`, owner = await session(browser, `${id}@example.invalid`), alice = await session(browser, "other@example.invalid"), bob = await session(browser, "member@example.invalid"), secondDevice = await session(browser, "other@example.invalid"), administrator = await session(browser, "admin@example.invalid"), executive = await session(browser, `photo-executive-${info.project.name}@example.invalid`), guest = await browser.newContext({ baseURL: origin });
  const contexts = [owner, alice, bob, secondDevice, administrator, executive, guest];
  const page = await owner.newPage(); await images(page); let ref: any, metadata: any;
  try {
    await page.goto(`/Portfolio/${id}`); ref = JSON.parse((await page.locator(".photo-wrapper").nth(1).getAttribute("data-photo-ref"))!);
    await like(alice, ref, false); await like(bob, ref, false);
    const original = await state(owner, ref); metadata = Object.fromEntries(["title", "caption", "camera", "lens", "fNumber", "shutterSpeed", "iso"].filter(key => original[key] !== undefined).map(key => [key, original[key]]));
    expect((await owner.request.post("/api/photos/metadata", { headers, data: { ref, metadata: { title: "いいねの確認写真" } } })).ok()).toBe(true);
    expect((await owner.request.post("/api/member/photo-notifications", { headers, data: { action: "all" } })).ok()).toBe(true);
    await like(guest, ref, true); const actorResponse = await like(alice, ref, true); expect(actorResponse.likers).toBeUndefined(); expect(actorResponse.count).toBeUndefined(); await like(bob, ref, true); await like(secondDevice, ref, true);
    const total = await state(owner, ref), names = total.likers.map((person: any) => person.name);
    expect(total.count).toBe(original.count + 3); expect(names.filter((name: string) => name === "別の会員")).toHaveLength(1); expect(total.likers.some((person: any) => person.href === "/Portfolio/member")).toBe(true);
    for (const unauthorized of [guest, alice]) { const value = await state(unauthorized, ref); expect(value.count).toBeUndefined(); expect(value.likers).toBeUndefined(); }
    await page.goto("/Member"); await bell(page).click(); const notifications = page.locator("#photo-notifications"), row = notifications.locator('[data-photo-notifications-list] > li').filter({ has: page.locator(`.photo-notification-photo[href*="${ref.imageId}"]`) });
    await expect(row).toContainText("いいねの確認写真に3件のいいねがありました。"); await expect(row.locator(".photo-liker-list > li")).toHaveCount(2); await expect(row).toContainText("別の会員"); await expect(row.locator('a[href="/Portfolio/member"]')).toHaveCount(1);
    await row.locator(".photo-notification-photo").click(); const viewer = page.locator("#photo-dialog"), count = viewer.locator("[data-photo-count]"), heart = viewer.locator("[data-photo-like]");
    await expect(viewer).toBeVisible(); await expect(count).toHaveText(String(total.count)); await expect(heart).toHaveAttribute("aria-pressed", "false");
    let ownerLikeRequests = 0; page.on("request", request => { if (new URL(request.url()).pathname === "/api/photos/like") ownerLikeRequests++; });
    await count.click(); const people = page.locator("#photo-likers"); await expect(people).toBeVisible(); await expect(people).toContainText("別の会員"); await expect(people.locator(".photo-liker-list > li")).toHaveCount(total.likers.length);
    await page.keyboard.press("Escape"); await expect(people).not.toBeVisible(); await expect(viewer).toBeVisible(); await expect(count).toBeFocused(); await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    await viewer.locator("[data-photo-close]").click(); const card = page.locator(".photo-wrapper").nth(1); await card.hover(); await card.locator("[data-photo-count]").click(); await expect(people).toBeVisible(); await expect(viewer).not.toBeVisible();
    await page.keyboard.press("Escape"); await expect(card.locator("[data-photo-count]")).toBeFocused(); expect(ownerLikeRequests).toBe(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 }); await card.locator(".photo-open").focus(); await card.locator(".photo-open").press("Enter"); await viewer.locator("[data-photo-count]").click(); await expect(people).toBeVisible();
      expect(await people.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1; })).toBe(true);
      await people.locator("[data-photo-likers-close]").click(); await viewer.locator("[data-photo-close]").click();
    }
    for (const context of [administrator, executive]) {
      const ranking = await context.newPage(); await images(ranking); await ranking.goto("/Admin/photos"); await ranking.locator("#photo-container").selectOption(`portfolio:${id}`); await expect(ranking.locator("#photo-manager")).toHaveAttribute("aria-busy", "false");
      const photo = ranking.locator(".photo-ranking-row").filter({ has: ranking.locator(`.photo-ranking-thumbnail[href*="${ref.imageId}"]`) }); await expect(photo.locator("[data-photo-likers]")).toContainText("別の会員");
      for (const width of [320, 390, 1440]) { await ranking.setViewportSize({ width, height: 1000 }); expect(await ranking.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
      await ranking.close();
    }
    await like(alice, ref, false); await page.goto(`/Portfolio/${id}`); await card.locator(".photo-open").focus(); await card.locator(".photo-open").press("Enter"); await expect(viewer).toBeVisible(); await viewer.locator("[data-photo-count]").click({ timeout: 5000 }); await expect(people).not.toContainText("別の会員");
  } finally {
    if (ref) { for (const context of [alice, bob, guest]) await like(context, ref, false); if (metadata) await owner.request.post("/api/photos/metadata", { headers, data: { ref, metadata } }); }
    for (const context of contexts) await context.close();
  }
});

test("exhibition Gallery notifications and photo counts identify the signed-in sender", async ({ browser }, info) => {
  const owner = await session(browser, `photo-owner-${info.project.name}@example.invalid`), actor = await session(browser, "other@example.invalid"); let ref: any;
  try {
    const page = await owner.newPage(); await images(page); await page.goto(`/Gallery/photo-exhibition-${info.project.name}`); ref = JSON.parse((await page.locator(".photo-wrapper").first().getAttribute("data-photo-ref"))!);
    await like(actor, ref, false); await owner.request.post("/api/member/photo-notifications", { headers, data: { action: "all" } }); await like(actor, ref, true);
    await page.reload(); await page.locator(".photo-open").first().click(); await page.locator("#photo-dialog [data-photo-count]").click(); await expect(page.locator("#photo-likers")).toContainText("別の会員"); await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.goto("/Member"); await bell(page).click(); const row = page.locator('[data-photo-notifications-list] > li').filter({ has: page.locator(`.photo-notification-photo[href*="${ref.imageId}"]`) }); await expect(row).toContainText("展示写真に1件のいいねがありました。"); await expect(row).toContainText("別の会員");
  } finally { if (ref) await like(actor, ref, false); await owner.close(); await actor.close(); }
});

test("Blog and Home share member attribution and expose no sender list to guests or unrelated staff", async ({ browser }, info) => {
  const administrator = await session(browser, "admin@example.invalid"), actor = await session(browser, "other@example.invalid"), staff = await session(browser, `photo-staff-${info.project.name}@example.invalid`), guest = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } }); let ref: any, original: any;
  const change = async (action: string, data?: any) => { const current = (await (await administrator.request.get("/api/admin/content/home")).json()).document; expect((await administrator.request.post("/api/admin/content/home", { headers, data: { action, revision: current.revision, data } })).ok()).toBe(true); };
  try {
    const page = await administrator.newPage(); await images(page); await page.goto("/posts/test-post"); ref = JSON.parse((await page.locator(".photo-wrapper").first().getAttribute("data-photo-ref"))!); await like(actor, ref, false); const baseline = await state(administrator, ref); await like(actor, ref, true);
    await page.reload(); await page.locator(".photo-open").first().click(); await page.locator("#photo-dialog [data-photo-count]").click(); await expect(page.locator("#photo-likers")).toContainText("別の会員"); await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    const catalog = (await (await administrator.request.get("/api/admin/home-photos")).json()).photos; original = (await (await administrator.request.get("/api/admin/content/home")).json()).document;
    expect(catalog.some((photo: any) => photo.id === ref.imageId)).toBe(true); await change("save", { ...original.published, excludedPhotoIds: catalog.filter((photo: any) => photo.id !== ref.imageId).map((photo: any) => photo.id) }); await change("publish");
    await page.goto("/"); const main = page.locator('[data-photo-group="home-main"]'); await expect(main).toHaveCount(1); const homeRef = JSON.parse((await main.getAttribute("data-photo-ref"))!); await like(actor, homeRef, true);
    const shared = await state(administrator, homeRef); expect(shared.count).toBe(baseline.count + 1); expect(shared.likers.filter((person: any) => person.name === "別の会員")).toHaveLength(1);
    await main.click(); await page.locator("#photo-dialog [data-photo-count]").click(); await expect(page.locator("#photo-likers")).toContainText("別の会員");
    const publicPage = await guest.newPage(); await images(publicPage); await publicPage.goto("/"); await publicPage.locator('[data-photo-group="home-main"]').click(); await expect(publicPage.locator("#photo-dialog [data-photo-count]")).toBeHidden(); await expect(publicPage.locator("#photo-likers")).toHaveCount(0);
    for (const context of [guest, staff]) { const value = await state(context, homeRef); expect(value.count).toBeUndefined(); expect(value.likers).toBeUndefined(); }
  } finally {
    if (ref) await like(actor, ref, false);
    if (original) { await change("save", original.published); await change("publish"); if (JSON.stringify(original.draft) !== JSON.stringify(original.published)) await change("save", original.draft); }
    for (const context of [administrator, actor, staff, guest]) await context.close();
  }
});
