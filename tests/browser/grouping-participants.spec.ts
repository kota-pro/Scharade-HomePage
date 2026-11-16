import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";
const origin = "http://127.0.0.1:4329", headers = { Origin: origin };
const sheet = "https://docs.google.com/spreadsheets/d/participant-form-fixture-2026/edit#gid=123";
test("staff import preview, manual guests, reuse, deduplication and guest-only generation", async ({page}, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", r => new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort());
  const login = async (id: string) => expect((await fixtureLogin(page.request, "/api/auth/login", {
    headers, data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  })).status()).toBe(200);
  const activity = async (data: Record<string, unknown>) => {
    const response = await page.request.post("/api/member/activities", { headers, data });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  await login("planner");
  const eventTitle = `投票取り込み ${info.project.name}`;
  const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const { eventId } = await activity({
    action: "event.save", title: eventTitle, description: "参加者確認", startsAt: iso(3), endsAt: iso(4),
    deadline: iso(2), ownerId: "planner", meeting: "", itinerary: "", fee: "", theme: "",
    recipientIds: ["activity-7", "activity-6"],
  });
  await activity({ action: "event.publish", eventId, revision: 1 });
  await login("activity-7");
  await activity({ action: "vote", eventId, vote: "attending" });
  await login("activity-6");
  await activity({ action: "vote", eventId, vote: "absent" });
  await login("planner");
  await page.goto("/Member/manage/grouping");
  await page.getByText("企画の参加投票から追加", { exact: true }).click();
  await page.getByLabel("読み込む企画").selectOption(eventId);
  await page.locator("[data-participant-event-load]").click();
  const eventRow = page.locator('[data-import-source="event"]');
  await expect(eventRow).toHaveCount(1);
  await expect(eventRow.locator('[data-import-field="name"]')).toHaveValue("撮影会員 activity-7");
  await eventRow.locator('[data-import-field="grade"]').selectOption("2");
  await eventRow.locator('[data-import-field="gender"]').selectOption("female");
  await page.getByText("フォームのスプレッドシートから追加",{exact:true}).click();
  await page.locator("[data-participant-url]").fill(sheet);
  await page.locator("[data-participant-load]").click();
  await expect(page.locator('[data-import-source="sheet"]')).toHaveCount(3);
  await expect(eventRow).toHaveCount(1);
  await expect(page.locator('[data-participant-column="lineName"]')).toHaveValue("5");
  await expect(page.locator('[data-import-source="sheet"] [data-import-field="grade"]').first()).toHaveValue("1");
  await page.getByText("名前・学年・性別で追加",{exact:true}).click();
  await page.locator('[data-guest-field="name"]').fill(`手動参加者 ${info.project.name}`);
  await page.locator('[data-guest-field="grade"]').selectOption("3");
  await page.locator('[data-guest-field="gender"]').selectOption("male");
  await page.locator('[data-guest-field="lineName"]').fill(`manual-${info.project.name}`);
  await page.locator("[data-participant-manual-add]").click();
  await expect(page.locator('[data-import-source="manual"]')).toHaveCount(1);
  await page.locator("[data-participant-confirm]").click();
  await expect(page.locator('[name="participantIds"]:checked')).toHaveCount(5);
  const checkSources = async () => {
    for (const [source, count] of [["event", 1], ["sheet", 3], ["manual", 1]] as const)
      await expect(page.locator(`[data-recipient-group="${source}"] [name="participantIds"]:checked`)).toHaveCount(count);
  };
  await checkSources();
  for(const width of [320,390,1440]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
  }
  await page.locator('form[data-activity-action="run.save"] [name="title"]').fill(`フォーム班分け ${info.project.name}`);
  await page.locator('form[data-activity-action="run.save"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/Member\/manage\/grouping\/[a-f0-9-]+/);
  const path = new URL(page.url()).pathname;
  await page.getByText("参加者・参照する履歴を変更", { exact: true }).click();
  await checkSources();
  await page.getByText("参加者・参照する履歴を変更", { exact: true }).click();
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
  await expect(page.locator('[data-recipient-group="sheet"] [name="participantIds"]')).toHaveCount(3);
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
