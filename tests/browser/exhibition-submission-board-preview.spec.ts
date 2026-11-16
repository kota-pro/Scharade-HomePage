import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

test("submission QR tab previews all saved cards without changing drafts, versions or Drive outputs", async ({ page }, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const headers = { Origin: "http://127.0.0.1:4329" };
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } })).ok()).toBe(true);
  const id = `f2000000-0000-4000-8000-00000000000${["chromium", "firefox", "webkit"].indexOf(info.project.name) + 1}`;
  const endpoint = `/api/member/exhibitions/${id}`;
  const get = async () => await (await page.request.get(endpoint)).json();
  const before = await get();
  await page.goto(`/Member/manage/exhibitions/${id}/submissions`);
  await page.locator('[data-submission-tab="status"]').click();
  await page.locator('[data-submission-row][data-stage="submitted"] [data-submission-detail]').first().click();
  const detail = page.locator(".submission-detail-dialog");
  // A local correction must survive previewing and remain absent from the saved card.
  await detail.getByRole("button", { name: "名前を修正", exact: true }).click();
  await detail.locator('[data-common="name"]').fill("保存前の修正");
  await detail.locator('[data-se-tab="qr"]').click();
  const trigger = detail.getByRole("button", { name: "タイトルボードをプレビュー", exact: true });
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate(button => {
    const actions = button.parentElement!;
    return actions.matches(".exhibition-actions") && actions.lastElementChild === button
      && [...actions.querySelectorAll("[data-qr-submission]")].every(qr => !!(qr.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await trigger.click();
  const preview = page.locator(".submission-board-preview-dialog");
  const image = preview.locator("[data-board-preview-image]");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "「海辺の朝」のタイトルボード");
  expect(await image.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([840, 594]);
  await expect(preview).toContainText("展示者さんの保存済みの最新提出内容");
  await expect(preview.locator("[data-board-preview-position]")).toHaveText("1 / 3");
  await expect(preview.locator("[data-board-preview-prev]")).toBeDisabled();
  await preview.locator("[data-board-preview-next]").click();
  await expect(image).toHaveAttribute("alt", "「街の光」のタイトルボード");
  await expect(image).toBeVisible();
  await preview.locator("[data-board-preview-work]").selectOption({ index: 2 });
  await expect(image).toHaveAttribute("alt", "「森の記憶」のタイトルボード");
  await expect(image).toBeVisible();
  await expect(preview.locator("[data-board-preview-next]")).toBeDisabled();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await preview.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 2)).toBe(true);
    await preview.screenshot({ path: info.outputPath(`submission-board-${width}.png`) });
  }
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(detail).toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  // Failed reads are recoverable and leave the original detail dialog intact.
  const pattern = `**/api/member/exhibitions/${id}/output?kind=board-preview&workId=**`;
  await page.route(pattern, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, message: "一時的な読み込みエラー" }) }));
  await trigger.click();
  await expect(preview.locator("[data-board-preview-status]")).toContainText("タイトルボードのプレビューを表示できませんでした。");
  await expect(image).toBeHidden();
  await page.unroute(pattern);
  await preview.locator("[data-board-preview-refresh]").click();
  await expect(image).toBeVisible();
  await preview.getByRole("button", { name: "提出詳細に戻る", exact: true }).click();
  await detail.locator('[data-se-tab="content"]').click();
  await expect(detail.locator('[data-common="name"]')).toHaveValue("保存前の修正");
  await expect(detail.locator("[data-se-next]")).toBeEnabled();
  const after = await get();
  expect(after.submissions).toEqual(before.submissions);
  expect(after.outputs).toEqual(before.outputs);
  expect(after.exhibition.revision).toBe(before.exhibition.revision);
  page.once("dialog", dialog => dialog.accept());
  await detail.locator("[data-submission-detail-close]").click();
  await expect(detail).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  expect(errors).toEqual([]);
});
