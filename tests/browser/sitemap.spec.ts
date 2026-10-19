import { test, expect } from "@playwright/test";
import { publicPages } from "../../src/data/publicPages";

test("sitemaps expose public routes with valid XML, without private albums or internal screens", async ({
  page,
  request,
}, info) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/xml");
  const xml = await response.text();
  await page.goto("/sitemap");
  const parsed = await page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, "application/xml");
    return {
      errors: document.querySelectorAll("parsererror").length,
      namespace: document.documentElement.namespaceURI,
      urls: [...document.querySelectorAll("loc")].map(
        (node) => node.textContent!,
      ),
    };
  }, xml);
  expect(parsed.errors).toBe(0);
  expect(parsed.namespace).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
  expect(new Set(parsed.urls).size).toBe(parsed.urls.length);
  for (const item of publicPages) {
    expect(parsed.urls).toContain(`https://scharade.jp${item.href}`);
    await expect(
      page.locator(`.sitemap-list a[href="${item.href}"]`),
    ).toHaveCount(1);
  }
  expect(xml).toContain("/Gallery/public-album");
  expect(xml).not.toMatch(
    /\/Gallery\/private-album|\/Member|\/Admin|\/Exhibition\/|\/api\/|\/Portfolio\/edit|\/SearchResult/,
  );
  for (const url of parsed.urls) {
    const pathname = new URL(url).pathname;
    expect((await request.get(pathname)).status(), pathname).toBe(200);
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "App & Account", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("sitemap-mobile.png"),
    fullPage: true,
  });
});

test("robots retains public discovery and noindex remains on event shares and member screens", async ({
  request,
}) => {
  const response = await request.get("/robots.txt");
  expect(response.status()).toBe(200);
  const robots = await response.text();
  expect(robots).toContain("Sitemap: https://scharade.jp/sitemap.xml");
  expect(robots).toContain("Disallow: /Member\nAllow: /Member/events/");
  const event = await request.get("/Member/events/missing-synthetic-event");
  expect(event.status()).toBe(404);
  expect(event.headers()["x-robots-tag"]).toContain("noindex");
  const member = await request.get("/Member", { maxRedirects: 0 });
  expect(member.status()).toBe(302);
  expect(member.headers()["x-robots-tag"]).toContain("noindex");
  for (const pathname of ["/AppPrivacy", "/AccountDeletion"]) {
    const page = await request.get(pathname);
    expect(page.status()).toBe(200);
    expect(page.headers()["x-robots-tag"] ?? "").not.toContain("noindex");
  }
});
