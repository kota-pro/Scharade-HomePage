import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";
import jsQR from "jsqr";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    if (host === "127.0.0.1" || url.protocol === "blob:") return route.continue();
    if (host.endsWith("microcms-assets.io")) return route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#aaa"/></svg>'});
    return route.abort();
  });
});

async function openShare(page: Page) {
  await page.locator(".portfolio-share-trigger:visible").click();
  await expect(page.locator("#portfolio-share-dialog")).toBeVisible();
  await expect(page.getByRole("button", {name:"QR画像をコピー",exact:true})).toBeEnabled();
}

test("Portfolio share offers an SNS button at all widths, focus and safe canonical links", async ({ page }) => {
  const qrRequests: string[] = [];
  page.on("request", r => { if (r.url().includes("portfolioQr")) qrRequests.push(r.url()); });
  await page.setViewportSize({width:1440,height:900});
  await page.goto("/Portfolio/other?from=portfolio&utm_source=test#photos");
  const shareButton=page.locator(".profile-header .portfolio-share-social");
  await expect(page.locator(".portfolio-share-trigger")).toHaveCount(1);
  await expect(shareButton).toBeVisible();
  expect(qrRequests).toHaveLength(0);
  await shareButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", {name:"QR画像をコピー",exact:true})).toBeEnabled();
  await expect(page.locator("#portfolio-share-url")).toHaveValue("https://scharade.jp/Portfolio/other");
  await expect(page.getByRole("button",{name:"共有画面を閉じる"})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#portfolio-share-dialog")).not.toBeVisible();
  await expect(shareButton).toBeFocused();
  expect(qrRequests).toHaveLength(1);
  for (const width of [320,390,768,1024,1440,1920]) {
    await page.setViewportSize({width,height:740});
    await expect(shareButton).toBeVisible();
    const a=await page.locator('.profile-header .sns a[href*="instagram.com"]').boundingBox();
    const b=await shareButton.boundingBox();
    expect(b!.x).toBeGreaterThanOrEqual(a!.x+a!.width);
    await openShare(page);
    expect(await page.locator("#portfolio-share-dialog").evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
    const bounds=await page.locator("#portfolio-share-dialog").boundingBox();
    if (width<=768) expect(Math.abs(bounds!.y+bounds!.height-740)).toBeLessThan(2);
    await page.getByRole("button",{name:"共有画面を閉じる"}).click();
    await expect(shareButton).toBeFocused();
    expect(await page.evaluate(()=>getComputedStyle(document.body).overflowY)).not.toBe("hidden");
  }
  expect(qrRequests).toHaveLength(1);
});

test("Portfolio share can retry QR generation after a logo network failure", async ({ page }) => {
  let allowLogo = false;
  await page.route("**/icons/logo.svg", route => allowLogo ? route.continue() : route.abort());
  await page.setViewportSize({width:390,height:844});
  await page.goto("/Portfolio/other");
  await page.locator(".portfolio-share-trigger:visible").click();
  await expect(page.getByRole("button",{name:"QRコードを再生成"})).toBeVisible();
  await expect(page.getByRole("button",{name:"QR画像をコピー",exact:true})).toBeDisabled();
  await expect(page.locator("#portfolio-share-url")).toHaveValue("https://scharade.jp/Portfolio/other");
  allowLogo = true;
  await page.getByRole("button",{name:"QRコードを再生成"}).click();
  await expect(page.getByRole("button",{name:"QR画像をコピー",exact:true})).toBeEnabled();
  await expect(page.getByRole("button",{name:"QRコードを再生成"})).not.toBeVisible();
});

test("Portfolio share copies the link and PNG and downloads a readable QR containing the logo", async ({ page, context, browserName }) => {
  await page.setViewportSize({width:390,height:844});
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read","clipboard-write"]);
  } else {
    // System clipboard permissions are not exposed by Playwright on these engines.
    await page.addInitScript(() => {
      const store: any = window;
      Object.defineProperty(navigator,"clipboard",{configurable:true,value:{
        writeText: async(text:string)=>{store.copiedLink=text;},
        write: async(items:ClipboardItem[])=>{store.copiedPng=await items[0].getType("image/png");},
      }});
    });
  }
  await page.goto("/Portfolio/member?from=portfolio");
  await openShare(page);
  await page.locator("#portfolio-share-url").click();
  await expect(page.locator(".portfolio-share-status")).toHaveText("リンクをコピーしました。");
  const copied=await page.evaluate(async native=>native ? navigator.clipboard.readText() : (window as any).copiedLink,browserName==="chromium");
  expect(copied).toBe("https://scharade.jp/Portfolio/member");
  await page.getByRole("button",{name:"リンクをコピー",exact:true}).click();
  await expect(page.locator(".portfolio-share-status")).toHaveText("リンクをコピーしました。");
  await page.getByRole("button",{name:"QR画像をコピー",exact:true}).click();
  await expect(page.locator(".portfolio-share-status")).toHaveText("QR画像をコピーしました。");
  const copiedBytes=await page.evaluate(async native=> {
    const blob=native ? await (await navigator.clipboard.read())[0].getType("image/png") : (window as any).copiedPng;
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },browserName==="chromium");
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("link",{name:"ダウンロード"}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe("Scharade-Portfolio-member.png");
  expect(await download.failure()).toBeNull();
  const png=await fs.readFile((await download.path())!);
  const image=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  expect(jsQR(new Uint8ClampedArray(image.data),image.info.width,image.info.height)?.data).toBe(copied);
  const clipboardImage=await sharp(Buffer.from(copiedBytes)).ensureAlpha().raw().toBuffer();
  expect(clipboardImage.equals(image.data)).toBe(true);
  // Check the logo survived compositing (the QR underneath the white plate is erased).
  const center=await sharp(png).extract({left:438,top:457,width:148,height:110}).raw().toBuffer();
  expect([...center].filter(value=>value<100).length).toBeGreaterThan(100);
  const thumbnail=await sharp(png).resize(232,232).ensureAlpha().raw().toBuffer();
  expect(jsQR(new Uint8ClampedArray(thumbnail),232,232)?.data).toBe(copied);
  await expect(page.locator(".share-saved-icon")).toBeVisible();
  await expect(page.locator(".share-download-icon")).not.toBeVisible();
});

test("Portfolio share reports denied or unavailable clipboard access without false success", async ({ page }) => {
  await page.setViewportSize({width:320,height:640});
  await page.addInitScript(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:{
    writeText:()=>Promise.reject(new Error("Permission denied")),
    write:()=>Promise.reject(new Error("Permission denied")),
  }}));
  await page.goto("/Portfolio/member");
  await openShare(page);
  await page.getByRole("button",{name:"リンクをコピー",exact:true}).click();
  await expect(page.locator(".portfolio-share-status")).toContainText("コピーできませんでした");
  await page.getByRole("button",{name:"QR画像をコピー",exact:true}).click();
  await expect(page.locator(".portfolio-share-status")).toContainText("QR画像をコピーできませんでした");
  await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{value:undefined}));
  await page.getByRole("button",{name:"QR画像をコピー",exact:true}).click();
  await expect(page.locator(".portfolio-share-status")).toContainText("このブラウザではQR画像をコピーできません");
  await expect(page.getByRole("link",{name:"ダウンロード"})).toHaveAttribute("aria-disabled","false");
  await page.getByRole("button",{name:"共有画面を閉じる"}).click();
  await expect(page.locator("#portfolio-share-dialog")).not.toBeVisible();
});
