import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
const sheet = "https://docs.google.com/spreadsheets/d/participant-form-fixture-2026/edit#gid=123";
test("staff import preview, manual guests, reuse, deduplication and guest-only generation", async ({page}, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
  expect((await fixtureLogin(page.request,"/api/auth/login",{ headers, data:{email:"planner@example.invalid",password:"fixture-password-123"} })).status()).toBe(200);
  await page.goto("/Member/manage/grouping");
  await page.getByText("フォームのスプレッドシートから追加",{exact:true}).click();
  await page.locator("[data-participant-url]").fill(sheet);
  await page.locator("[data-participant-load]").click();
  await expect(page.locator(".grouping-import-row")).toHaveCount(3);
  await expect(page.locator('[data-participant-column="lineName"]')).toHaveValue("5");
  await expect(page.locator('[data-import-field="grade"]').first()).toHaveValue("1");
  await page.locator("[data-participant-confirm]").click();
  await expect(page.locator('[name="participantIds"]:checked')).toHaveCount(3);
  await page.getByText("名前・学年・性別で追加",{exact:true}).click();
  await page.locator('[data-guest-field="name"]').fill(`手動参加者 ${info.project.name}`);
  await page.locator('[data-guest-field="grade"]').selectOption("3");
  await page.locator('[data-guest-field="gender"]').selectOption("male");
  await page.locator('[data-guest-field="lineName"]').fill(`manual-${info.project.name}`);
  await page.locator("[data-participant-manual-add]").click();
  await page.locator("[data-participant-confirm]").click();
  await expect(page.locator('[name="participantIds"]:checked')).toHaveCount(4);
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  }
  await page.locator('form[data-activity-action="run.save"] [name="title"]').fill(`フォーム班分け ${info.project.name}`);
  await page.locator('form[data-activity-action="run.save"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/Member\/manage\/grouping\/[a-f0-9-]+/);
  const path = new URL(page.url()).pathname;
  await page.locator('form[data-activity-action="groups.rules"] [name="count"]').fill("1");
  await page.locator('form[data-activity-action="groups.rules"] [name="count"]').dispatchEvent("change");
  await page.locator('form[data-activity-action="groups.rules"] [name="leader"]').selectOption({label:`手動参加者 ${info.project.name}（manual-${info.project.name}）`});
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.locator('form[data-activity-action="groups.rules"] button[type="submit"]').click(),
  ]);
  await page.locator('form[data-activity-action="groups.generate"] button').click();
  await expect(page.locator('form[data-activity-action="groups.save"]')).toBeVisible();
  await page.locator('form[data-activity-action="groups.publish"] button').click();
  await expect(page.getByRole("heading",{name:"確定済みの班（第1版）",exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("guests-grouped.png"),fullPage:true});
  await page.goto("/Member/manage/grouping");
  await expect(page.locator('.activity-recipient-options').getByText(`手動参加者 ${info.project.name}（manual-${info.project.name}）`,{exact:false})).toBeVisible();
  await page.getByText("フォームのスプレッドシートから追加",{exact:true}).click();
  await page.locator("[data-participant-url]").fill(sheet); await page.locator("[data-participant-load]").click();
  await expect(page.locator(".grouping-import-row")).toHaveCount(3);
  const matches = await page.locator("[data-import-match]").evaluateAll(selects => selects.map(el => (el as HTMLSelectElement).value));
  expect(matches.every(value => value.startsWith("guest-"))).toBe(true);
  await page.locator("[data-participant-confirm]").click();
  expect(await page.locator('[name="participantIds"]:checked').count()).toBe(3);
  for(const match of matches) expect(await page.locator(`[name="participantIds"][value="${match}"]`).count()).toBe(1);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:info.outputPath("participant-import-mobile.png"),fullPage:true});
  await page.goto(path); expect(errors).toEqual([]);
});
