import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({path:path.resolve("public/media/site/activity/Photo1-480.webp"),contentType:"image/webp"});
    return route.abort();
  });
});
async function login(page: Page, account="other") {
  expect((await fixtureLogin(page.request, "/api/auth/login", {headers:{Origin:"http://127.0.0.1:4329"},data:{email:`${account}@example.invalid`,password:"fixture-password-123"}})).status()).toBe(200);
}
test("Portfolio preserves editing while logout moves to the member portal", async ({page}) => {
  await login(page);await page.goto("/Portfolio/other");
  await expect(page.locator("#portfolio-logout")).toHaveCount(0);
  for(const width of [1440,769,768,390,320]) {
    await page.setViewportSize({width,height:900});
    const edit=page.getByRole("link",{name:"Edit my portfolio",exact:true});
    await expect(edit).toBeVisible();
    await expect.poll(()=>edit.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth+1;})).toBe(true);
  }
  await page.getByRole("link",{name:"Edit my portfolio",exact:true}).click();
  await expect(page).toHaveURL(/\/Portfolio\/edit\?id=other$/);
  await page.locator(".user-welcome").click();await expect(page).toHaveURL(/\/Member$/);
  await expect(page.getByRole("link",{name:"自分のPortfolioを見る",exact:false})).toHaveAttribute("href","/Portfolio/other");
  await expect(page.locator("#member-logout")).toBeVisible();
});
test("member logout handles failure, prevents duplicate requests and ends the session", async ({page})=>{
  await login(page);await page.goto("/Member");let attempts=0;
  await page.route("**/api/auth/logout",async route=>{attempts++;await route.fulfill({status:503,json:{ok:false}});});
  const button=page.locator("#member-logout");
  await button.evaluate((el:HTMLButtonElement)=>{el.click();el.click();});
  await expect(page.locator("#member-logout-status")).toHaveAttribute("data-site-error-code", "SITE-011");
  expect(attempts).toBe(1);await expect(button).toBeEnabled();
  await page.unroute("**/api/auth/logout");await button.focus();await page.keyboard.press("Enter");
  await expect(page).toHaveURL("http://127.0.0.1:4329/");await expect(page.locator(".user-welcome")).toHaveCount(0);
  expect((await page.request.get("/Member",{maxRedirects:0})).status()).toBe(302);
});
