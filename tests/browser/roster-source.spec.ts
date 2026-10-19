import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from "@playwright/test";
import { activityRosterUrl } from "../../src/lib/activityRoster";
const origin = "http://127.0.0.1:4329";
const nextUrl =
  "https://docs.google.com/spreadsheets/d/next-roster-fixture-2027/edit#gid=123";
async function submit(page: Page, action: string, button: string) {
  const navigation = page.waitForEvent("domcontentloaded");
  await page
    .locator(`form[data-activity-action="${action}"]`)
    .getByRole("button", { name: button, exact: true })
    .click();
  await navigation;
}
test("administrator previews a roster change, confirms departures, preserves links and excludes former members", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90000);
  await page.route("**/*", (r) =>
    new URL(r.request().url()).hostname === "127.0.0.1"
      ? r.continue()
      : r.abort(),
  );
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers: { Origin: origin },
        data: {
          email: "admin@example.invalid",
          password: "fixture-password-123",
        },
      })
    ).status(),
  ).toBe(200);
  async function getPreview(url: string) {
    await page.goto("/Admin/grouping-roster");
    await page
      .getByText("名簿の参照先を変更・退会対象を確認", { exact: true })
      .click();
    await page.getByLabel("参照するGoogleスプレッドシートのURL").fill(url);
    await submit(page, "roster.preview", "変更内容を確認");
    await expect(page).toHaveURL(/grouping-roster\/preview\?id=/);
  }
  await getPreview(activityRosterUrl);
  await page.getByRole("checkbox").check();
  await submit(page, "roster.apply", "名簿の参照先と退会処理を適用");
  await submit(page, "roster.link", "対応を確認して連携を保存");
  const key0 = await page
    .locator('[data-roster-user="activity-0"]')
    .inputValue();
  const key1 = await page
    .locator('[data-roster-user="activity-1"]')
    .inputValue();
  const bindings = page.locator('form[data-activity-action="roster.link"]'), accountSearch = page.locator('[data-roster-account-search]');
  const row = page.locator('[data-roster-user="activity-0"]').locator('xpath=ancestor::div[contains(@class,"activity-roster-row")]');
  const personSearch = row.locator('[data-person-search]'), selected = row.locator('[data-roster-user]');
  const totalRows = await bindings.locator('[data-roster-user]').count();
  await accountSearch.fill('撮影会員 activity-0');
  await expect(bindings.locator('[data-roster-account-name]:visible')).toHaveCount(1);
  await personSearch.fill('ＬＩＮＥ１');
  await personSearch.press('Enter');await expect(bindings).not.toHaveAttribute('data-busy','true');
  await expect(row.locator('[data-person-matches]')).toContainText('1人が一致');
  await expect(selected).toHaveValue(key0);
  await expect(selected.locator('option[value=""]')).toHaveText('連携しない・未回答');
  await expect(bindings).not.toHaveAttribute('data-dirty','true');
  await selected.selectOption(key1);await personSearch.fill('一致する人がいません');
  await expect(row.locator('[data-person-matches]')).toContainText('0人が一致');await expect(selected).toHaveValue(key1);
  await personSearch.fill('');await selected.selectOption('');await personSearch.fill('line0');await expect(selected).toHaveValue('');await selected.selectOption(key0);
  await accountSearch.fill('一致するアカウントがいません');await expect(bindings.locator('[data-roster-account-name]:visible')).toHaveCount(0);
  await expect(page.locator('[data-roster-account-count]')).toContainText('見つかりません');
  expect(await bindings.locator('[data-roster-user]').count()).toBe(totalRows);
  // Hidden accounts and a person outside the current search keep their saved bindings.
  await submit(page,'roster.link','対応を確認して連携を保存');
  await expect(page.locator('[data-roster-user="activity-0"]')).toHaveValue(key0);await expect(page.locator('[data-roster-user="activity-1"]')).toHaveValue(key1);
  for(const width of [390,1440]){await page.setViewportSize({width,height:1000});await page.locator('[data-roster-account-search]').fill('撮影会員 activity-0');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await bindings.screenshot({path:info.outputPath(`roster-name-search-${width}.png`)});}
  await page.locator('[data-roster-account-search]').fill('');
  const create = await page.request.post("/api/member/grouping", {
    headers: { Origin: origin },
    data: {
      action: "run.save",
      title: "参照先の切替確認",
      participantIds: [key0, key1],
      previousRunId: "",
    },
  });
  expect(create.status()).toBe(200);
  const { runId } = await create.json();
  await getPreview(nextUrl);
  const url = page.url();
  await expect(page.getByText("退会対象：1人", { exact: false })).toBeVisible();
  await expect(page.locator(".activity-list")).toContainText(
    "撮影会員 activity-0",
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1200 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    if (width !== 320)
      await page.screenshot({
        path: info.outputPath(`roster-preview-${width}.png`),
        fullPage: true,
      });
  }
  await page
    .getByRole("button", { name: "名簿の参照先と退会処理を適用", exact: true })
    .click();
  expect(page.url()).toBe(url);
  await page.goto("/Admin/grouping-roster");
  await expect(
    page.getByRole("link", { name: "2026年度後期テスト名簿", exact: true }),
  ).toHaveAttribute("href", activityRosterUrl);
  await page.goto(url);
  await page.getByRole("checkbox").check();
  await submit(page, "roster.apply", "名簿の参照先と退会処理を適用");
  await expect(
    page.getByRole("link", { name: "2027年度テスト名簿", exact: true }),
  ).toHaveAttribute("href", nextUrl);
  await expect(page.locator('[data-roster-user="activity-1"]')).toHaveValue(
    key1,
  );
  await expect(page.locator(".activity-list")).toContainText(
    "撮影会員 activity-0",
  );
  await submit(page, "roster.link", "対応を確認して連携を保存");
  await page.goto("/Admin/accounts/activity-0");
  await expect(page.locator(".admin-account-roster-status")).toContainText(
    "退会扱い",
  );
  await expect(page.locator(".admin-account-roster-field")).toContainText([
    "撮影会員 activity-0",
    "line0",
    "テスト大学",
    "女性",
    "1年生",
    "退会",
  ]);
  await page.goto(`/Member/manage/grouping/${runId}`);
  await expect(
    page.locator(`input[name="participantIds"][value="${key0}"]`),
  ).toHaveCount(0);
  await page.goto("/Admin/grouping-roster");
  await submit(page, "roster.sync", "Google名簿から更新");
  await expect(
    page.getByRole("link", { name: "2027年度テスト名簿", exact: true }),
  ).toHaveAttribute("href", nextUrl);
  const staff = await browser.newContext({ baseURL: origin });
  try {
    await fixtureLogin(staff.request, "/api/auth/login", {
      headers: { Origin: origin },
      data: {
        email: "planner@example.invalid",
        password: "fixture-password-123",
      },
    });
    expect((await staff.request.get(url)).status()).toBe(403);
    for (const action of ["roster.preview", "roster.apply", "roster.retry"])
      expect(
        (
          await staff.request.post("/api/member/activities", {
            headers: { Origin: origin },
            data: { action, url: nextUrl, revision: 0 },
          })
        ).status(),
      ).toBe(403);
  } finally {
    await staff.close();
  }
});
