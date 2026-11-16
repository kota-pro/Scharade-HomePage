import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
async function setup(page: Page, email = "admin@example.invalid") {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="${/-2\.jpg$/.test(url.pathname) ? 600 : 1200}" height="800"><rect width="100%" height="100%" fill="#879f9b"/></svg>` });
    return route.abort();
  });
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email, password: "fixture-password-123" } })).status()).toBe(200);
}
const sample = (scope = "", page = 1, count = 12) => ({ ok: true, page, pages: 2, pageSize: 20, photos: [{ rank: page === 1 ? 1 : 21, key: "cms:sample", ref: { source: "portfolio", containerId: "member", imageId: "sample" }, src: "https://images.microcms-assets.io/assets/fixture/photo.jpg", full: "https://images.microcms-assets.io/assets/fixture/photo.jpg", alt: "写真", title: page === 1 ? "ランキングの写真" : "2ページ目の写真", caption: "写真の概要です。", camera: "Z5", liked: false, count, href: "/Portfolio/member?photo=sample", containerName: "作者", sourceLabel: "Portfolio" }], summary: { totalLikes: count, likedPhotos: 25, mostLikes: count }, scope: { value: scope, label: scope ? "撮影会のお知らせ" : "すべての掲載先" }, unavailable: 0, generatedAt: "2026-11-01T06:00:00.000Z" });

test("rankings show real descending counts and summaries, support filters and are read-only for administrators and executives", async ({ page, browser }, info) => {
  await setup(page); const id = `photo-owner-${info.project.name}`;
  await page.goto(`/Portfolio/${id}`);
  const refs = await page.locator(".photo-wrapper").evaluateAll(elements => elements.map(element => JSON.parse((element as HTMLElement).dataset.photoRef!)));
  for (let index = 0; index < 3; index++) {
    const guest = await browser.newContext({ baseURL: origin });
    try { expect((await guest.request.post("/api/photos/like", { headers, data: { ref: refs[0], liked: true } })).ok()).toBe(true); } finally { await guest.close(); }
  }
  await page.goto("/Admin/photos"); await expect(page.locator("#photo-manager")).toHaveAttribute("aria-busy", "false");
  const data = await (await page.request.get("/api/admin/photos")).json();
  expect(data.photos.length).toBeGreaterThan(0);
  const counts = data.photos.map((photo: { count: number }) => photo.count); expect(counts).toEqual([...counts].sort((a, b) => b - a));
  await expect(page.locator("[data-photo-summary=totalLikes]")).toHaveText(data.summary.totalLikes.toLocaleString("ja-JP"));
  await expect(page.locator("[data-photo-manager-list] article")).toHaveCount(data.photos.length);
  await expect(page.locator("[data-photo-manager-list] form, [data-photo-manager-list] input, [data-photo-manager-list] textarea")).toHaveCount(0);
  await page.locator("#photo-container").selectOption(`portfolio:${id}`); await expect(page.locator("#photo-manager")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("[data-photo-ranking-scope]")).toHaveText(`写真確認 owner ${info.project.name}`);
  const link = page.locator(".photo-ranking-thumbnail").first(); await expect(link).toHaveAttribute("href", new RegExp(`/Portfolio/${id}\\?photo=`));
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
  await link.click(); await expect(page.locator("#photo-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  const context = await browser.newContext({ baseURL: origin }); const executive = await context.newPage();
  try { await setup(executive, `photo-executive-${info.project.name}@example.invalid`); await executive.goto("/Admin/photos"); await expect(executive.locator("#photo-manager")).toHaveAttribute("aria-busy", "false"); await expect(executive.locator("[data-photo-summary=totalLikes]")).not.toHaveText("—"); await expect(executive.locator("[data-photo-manager-list] form")).toHaveCount(0); } finally { await context.close(); }
});

test("filter races cannot restore stale rankings, empty results are clear and failed requests can be retried", async ({ page }) => {
  await setup(page); let release!: () => void, initial = false, fail = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/admin/photos?*", async route => {
    const scope = new URL(route.request().url()).searchParams.get("container") || "";
    if (!scope) { initial = true; await pending; return route.fulfill({ contentType: "application/json", body: JSON.stringify(sample("", 1, 99)) }).catch(() => {}); }
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false }) });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...sample(scope), photos: [], pages: 1, summary: { totalLikes: 0, likedPhotos: 0, mostLikes: 0 } }) });
  });
  try {
    await page.goto("/Admin/photos"); await expect.poll(() => initial).toBe(true); await expect(page.locator("[data-photo-ranking-loading]")).toBeVisible();
    await page.locator("#photo-container").selectOption("blog:post"); await expect(page.locator("[data-photo-summary=totalLikes]")).toHaveText("0");
    release(); await expect(page.locator("[data-photo-manager-status]")).toContainText("まだいいね"); await expect(page.locator("[data-photo-summary=totalLikes]")).toHaveText("0");
    fail = true; await page.locator("[data-photo-ranking-refresh]").click(); await expect(page.locator("[data-photo-manager-status]")).toHaveAttribute("data-error", "true");
    fail = false; await page.locator("[data-photo-ranking-refresh]").click(); await expect(page.locator("[data-photo-manager-status]")).toHaveAttribute("data-error", "false"); await expect(page.locator("[data-photo-summary=totalLikes]")).toHaveText("0");
  } finally { release(); }
});

test("ranking pagination keeps the global rank and returns to the previous page", async ({ page }) => {
  await setup(page);
  await page.route("**/api/admin/photos?*", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(sample("", Number(new URL(route.request().url()).searchParams.get("page")))) }));
  await page.goto("/Admin/photos"); await expect(page.locator(".photo-ranking-row")).toHaveAttribute("data-photo-rank", "1");
  await page.locator("[data-photo-manager-next]").click(); await expect(page.locator(".photo-ranking-row")).toHaveAttribute("data-photo-rank", "21"); await expect(page.locator("[data-photo-ranking-page]")).toContainText("21");
  await page.locator("[data-photo-manager-prev]").click(); await expect(page.locator(".photo-ranking-row")).toHaveAttribute("data-photo-rank", "1"); await expect(page.locator("[data-photo-manager-prev]")).toBeHidden();
});

test("portrait hover separates wrapped equipment and unbroken settings without overlapping the author or footer", async ({ page }, info) => {
  await setup(page); const id = `photo-owner-${info.project.name}`; await page.goto(`/Portfolio/${id}`);
  const card = page.locator(".photo-wrapper").nth(1), ref = JSON.parse((await card.getAttribute("data-photo-ref"))!);
  const metadata = { title: "縦写真", camera: "FUJIFILM GFX100 II Limited Edition Professional Camera", lens: "FUJINON GF 100-200mm F5.6 R LM OIS WR Long Lens", fNumber: "16", shutterSpeed: "1/400", iso: "4000" };
  expect((await page.request.post("/api/photos/metadata", { headers, data: { ref, metadata } })).ok()).toBe(true);
  try {
    await page.reload();
    await expect(page.locator(".justified-grid")).toHaveAttribute("data-layout", "justified");
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    for (const [width, height] of [[240, 360], [160, 240], [112, 168]]) {
      await card.evaluate((element, [width, height]) => { Object.assign((element as HTMLElement).style, { width: `${width}px`, height: `${height}px` }); }, [width, height]);
      await card.hover(); await expect(card.locator(".photo-hover")).toHaveCSS("opacity", "1");
      await expect(card.locator("[data-photo-camera]")).toHaveText(metadata.camera);
      await expect.poll(() => card.evaluate(element => {
        const box = (selector: string) => element.querySelector(selector)!.getBoundingClientRect();
        const equipment = box("[data-photo-equipment]"), settings = box("[data-photo-settings]"), footer = box(".photo-footer"), author = box(".photo-author img"), bounds = element.getBoundingClientRect();
        const clear = (a: DOMRect, b: DOMRect) => a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
        const right = element.querySelector<HTMLElement>("[data-photo-settings]")!;
        return equipment.bottom <= settings.top && settings.bottom <= footer.top && equipment.top >= bounds.top && right.scrollWidth <= right.clientWidth + 1 && clear(equipment, author) && clear(settings, author);
      })).toBe(true);
    }
    await card.locator(".photo-open").click(); const viewer = page.locator("#photo-dialog"); await viewer.locator("[data-photo-toggle]").click();
    await expect(viewer.locator("[data-photo-camera]")).toHaveText(metadata.camera); await expect(viewer.locator("[data-photo-lens]")).toHaveText(metadata.lens);
  } finally { expect((await page.request.post("/api/photos/metadata", { headers, data: { ref, metadata: {} } })).ok()).toBe(true); }
});
