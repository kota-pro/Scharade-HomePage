import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { fixtureLogin, restoreFixtureRoster } from "./fixture-auth";
const origin = "http://127.0.0.1:4329",
  headers = { Origin: origin };
const admission =
  "https://docs.google.com/spreadsheets/d/admission_browser_fixture_2027/edit#gid=11";
const continuation =
  "https://docs.google.com/spreadsheets/d/continuation_browser_fixture_2027/edit#gid=22";
async function login(page: Page, email: string) {
  expect(
    (
      await fixtureLogin(page.request, "/api/auth/login", {
        headers,
        data: { email, password: "fixture-password-123" },
      })
    ).status(),
  ).toBe(200);
}
async function waitDone(page: Page, id: string, state?: string) {
  await expect
    .poll(
      async () => {
        const data = await (
          await page.request.get("/api/admin/club-forms")
        ).json();
        const form = data.forms.find((form: any) => form.id === id);
        return form?.delivery === "done" && (!state || form.state === state);
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.reload();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort(),
  );
});

test("optional capacity is available for admission and welcome forms, persists, and can be cleared", async ({
  page,
}, info) => {
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  const form = page.locator('form[data-club-action="create"]');
  const capacity = form.locator('[name="capacity"]');
  await expect(capacity).toBeVisible();
  await expect(capacity).toHaveValue("");
  await form.locator('[name="kind"]').selectOption("continuation");
  await expect(capacity).toBeHidden();
  await expect(capacity).toBeDisabled();
  for (const kind of ["welcome_photo", "welcome_meal", "admission"]) {
    await form.locator('[name="kind"]').selectOption(kind);
    await expect(capacity).toBeVisible();
    await expect(capacity).toBeEnabled();
  }
  await capacity.fill("30");
  await form.locator('[name="year"]').fill("2027");
  await form.locator('[name="deadline"]').fill("2027-11-08T23:59");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await form.screenshot({
    path: info.outputPath("capacity-settings-mobile.png"),
  });
  const posted = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/club-forms") &&
      r.request().method() === "POST",
  );
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    form
      .getByRole("button", { name: "下書きフォームを生成", exact: true })
      .click(),
  ]);
  const response = await posted;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().input.capacity).toBe(30);
  const id = response.request().postDataJSON().id;
  await waitDone(page, id, "draft");
  const card = page.locator(`[data-club-id="${id}"]`);
  await expect(
    card.getByText("定員：30人 · 回答数：0件", { exact: true }),
  ).toBeVisible();
  await card.locator("summary").click();
  const edit = card.locator('form[data-club-action="update"]');
  await expect(edit.locator('[name="capacity"]')).toHaveValue("30");
  await edit.locator('[name="capacity"]').fill("");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    edit.getByRole("button", { name: "変更を保存", exact: true }).click(),
  ]);
  await waitDone(page, id, "draft");
  await expect(card.getByText("定員：制限なし", { exact: true })).toBeVisible();
});

test("each card has a lower-right delete button, cancellation preserves the form and confirmation removes it", async ({
  page,
}, info) => {
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  const id = crypto.randomUUID();
  const result = await page.request.post("/api/admin/club-forms", {
    headers,
    data: {
      action: "create",
      id,
      operationId: crypto.randomUUID(),
      input: {
        year: 2027,
        season: "spring",
        kind: "welcome_meal",
        fee: 0,
        eventName: "削除操作の確認",
        startsAt: "2027-11-10T06:00:00Z",
        endsAt: "",
        deadline: "2027-11-08T14:59:00Z",
        place: "架空の会場",
      },
    },
  });
  expect(result.ok()).toBe(true);
  await waitDone(page, id, "draft");
  const card = page.locator(`[data-club-id="${id}"]`);
  const button = card.getByRole("button", {
    name: "フォームを削除",
    exact: true,
  });
  const [cardBox, buttonBox] = await Promise.all([
    card.boundingBox(),
    button.boundingBox(),
  ]);
  expect(
    cardBox!.x + cardBox!.width - buttonBox!.x - buttonBox!.width,
  ).toBeLessThan(28);
  expect(
    cardBox!.y + cardBox!.height - buttonBox!.y - buttonBox!.height,
  ).toBeLessThan(28);
  await card.screenshot({ path: info.outputPath("club-delete-card.png") });
  let deletes = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/admin/club-forms") &&
      request.method() === "POST" &&
      request.postDataJSON()?.action === "delete"
    )
      deletes++;
  });
  await button.click();
  const dialog = page.getByRole("dialog", {
    name: "フォームを削除しますか？",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog.getByText(/削除操作の確認/)).toBeVisible();
  await expect(dialog.getByText(/Googleフォームと回答シート/)).toBeVisible();
  await dialog.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(deletes).toBe(0);
  await expect(card).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await button.click();
  await expect(dialog).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await dialog.screenshot({
    path: info.outputPath("club-delete-confirm-mobile.png"),
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(deletes).toBe(0);
  await button.click();
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/club-forms") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "delete",
  );
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    dialog.getByRole("button", { name: "削除する", exact: true }).click(),
  ]);
  const response = await posted;
  expect(response.ok()).toBe(true);
  const payload = response.request().postDataJSON();
  expect(payload.confirm).toBe(true);
  expect(deletes).toBe(1);
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/admin/club-forms")).json()
        ).forms.some((form: any) => form.id === id),
      { timeout: 30000 },
    )
    .toBe(false);
  await page.reload();
  await expect(card).toHaveCount(0);
  const replay = await page.request.post("/api/admin/club-forms", {
    headers,
    data: payload,
  });
  expect(replay.ok()).toBe(true);
});

test("welcome title placeholders follow date and place, accept overrides, and keep the requested field order", async ({
  page,
}, info) => {
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const form = page.locator('form[data-club-action="create"]');
  await form.locator('[name="kind"]').selectOption("welcome_photo");
  const name = form.getByLabel("企画名", { exact: true });
  await expect(name).toHaveAttribute(
    "placeholder",
    "【月/日（曜日）】シャレード新歓撮影会＠場所",
  );
  await form.getByLabel("西暦", { exact: true }).fill("2027");
  await form.getByLabel("場所", { exact: true }).fill("新宿御苑");
  await form.getByLabel("開催日時", { exact: true }).fill("2027-04-02T15:00");
  await expect(name).toHaveAttribute(
    "placeholder",
    "【4/2（金）】シャレード新歓撮影会＠新宿御苑",
  );
  await form.locator('[name="kind"]').selectOption("welcome_meal");
  await expect(name).toHaveAttribute(
    "placeholder",
    "【4/2（金）】シャレード新歓食事会＠新宿御苑",
  );
  await name.fill("自由な企画名");
  await form.getByLabel("場所", { exact: true }).fill("代々木公園");
  await form.getByLabel("開催日時", { exact: true }).fill("2027-04-03T15:00");
  await expect(name).toHaveValue("自由な企画名");
  await name.fill("");
  const expected = "【4/3（土）】シャレード新歓食事会＠代々木公園";
  await expect(name).toHaveAttribute("placeholder", expected);
  await form.getByLabel("提出期限", { exact: true }).fill("2027-04-01T23:59");
  const labels = await form
    .locator("[data-club-welcome] input")
    .evaluateAll((inputs) => inputs.map((input) => input.getAttribute("name")));
  expect(labels).toEqual(["eventName", "place", "startsAt", "endsAt"]);
  const [titleBox, placeBox, startBox, endBox] = await Promise.all([
    name.boundingBox(),
    form.getByLabel("場所", { exact: true }).boundingBox(),
    form.getByLabel("開催日時", { exact: true }).boundingBox(),
    form.getByLabel("終了日時（任意）", { exact: true }).boundingBox(),
  ]);
  expect(Math.abs(titleBox!.y - placeBox!.y)).toBeLessThan(2);
  expect(titleBox!.x).toBeLessThan(placeBox!.x);
  expect(startBox!.y).toBeGreaterThan(titleBox!.y);
  expect(Math.abs(startBox!.y - endBox!.y)).toBeLessThan(2);
  expect(startBox!.x).toBeLessThan(endBox!.x);
  expect(
    (await form.locator("label").allTextContents()).join(""),
  ).not.toContain("日本時間");
  await form
    .locator(".club-form-fields")
    .screenshot({ path: info.outputPath("welcome-title-settings.png") });
  const navigation = page.waitForEvent("domcontentloaded");
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/club-forms") &&
      response.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "下書きフォームを生成", exact: true })
    .click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  const { id } = response.request().postDataJSON();
  await navigation;
  await waitDone(page, id, "draft");
  const current = async () =>
    (await (await page.request.get("/api/admin/club-forms")).json()).forms.find(
      (item: any) => item.id === id,
    );
  expect((await current()).eventName).toBe(expected);
  expect((await current()).autoEventName).toBe(true);
  const card = page.locator(`[data-club-id="${id}"]`);
  await card.locator("summary").click();
  const edit = card.locator('form[data-club-action="update"]');
  await expect(edit.getByLabel("企画名", { exact: true })).toHaveValue("");
  await expect(edit.getByLabel("企画名", { exact: true })).toHaveAttribute(
    "placeholder",
    expected,
  );
  await edit.getByLabel("企画名", { exact: true }).fill("手入力を優先する企画");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    edit.getByRole("button", { name: "変更を保存", exact: true }).click(),
  ]);
  await waitDone(page, id, "draft");
  expect((await current()).eventName).toBe("手入力を優先する企画");
  expect((await current()).autoEventName).toBeUndefined();
  await page.setViewportSize({ width: 375, height: 812 });
  await card.locator("summary").click();
  await expect(edit.getByLabel("企画名", { exact: true })).toHaveValue(
    "手入力を優先する企画",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
});

test("welcome fee notice can be selected, saved, reopened for editing and replaced by an amount", async ({
  page,
}, info) => {
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  const form = page.locator('form[data-club-action="create"]');
  const message = "当日、参加費がかかる場合があります";
  await expect(
    form.getByRole("button", { name: message, exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "新歓撮影会フォームを作成", exact: true })
    .click();
  await form.getByRole("button", { name: message, exact: true }).click();
  await expect(
    form.getByRole("button", { name: message, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(form.locator('[name="fee"]')).toBeDisabled();
  await form
    .getByRole("button", { name: "金額を指定する", exact: true })
    .click();
  await form.locator('[name="fee"]').fill("500");
  await form.getByRole("button", { name: message, exact: true }).click();
  await form.locator('[name="kind"]').selectOption("admission");
  await expect(form.locator('[name="fee"]')).toBeEnabled();
  await expect(
    form.getByRole("button", { name: message, exact: true }),
  ).toBeHidden();
  await form.locator('[name="kind"]').selectOption("welcome_meal");
  await expect(
    form.getByRole("button", { name: message, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await form.locator('[name="year"]').fill("2027");
  await form.locator('[name="deadline"]').fill("2027-11-08T23:59");
  await form.locator('[name="eventName"]').fill("参加費案内の確認");
  await form.locator('[name="startsAt"]').fill("2027-11-10T15:00");
  await form.locator('[name="place"]').fill("架空の会場");
  await page.setViewportSize({ width: 375, height: 812 });
  await form
    .getByRole("button", { name: message, exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("welcome-fee-notice-mobile.png"),
    fullPage: true,
  });
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/club-forms") &&
      response.request().method() === "POST",
  );
  const navigation = page.waitForEvent("domcontentloaded");
  await form
    .getByRole("button", { name: "下書きフォームを生成", exact: true })
    .click();
  const response = await posted;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON().input.feeOnDay).toBe(true);
  const { id } = response.request().postDataJSON();
  await navigation;
  await waitDone(page, id, "draft");
  const card = page.locator(`[data-club-id="${id}"]`);
  await expect(
    card.locator("p").filter({ hasText: "提出期限：" }),
  ).toContainText(message);
  await card
    .locator("summary")
    .filter({ hasText: "案内・料金・期限を変更" })
    .click();
  const edit = card.locator('form[data-club-action="update"]');
  await expect(
    edit.getByRole("button", { name: message, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await edit
    .getByRole("button", { name: "金額を指定する", exact: true })
    .click();
  await edit.locator('[name="fee"]').fill("500");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    edit.getByRole("button", { name: "変更を保存", exact: true }).click(),
  ]);
  await waitDone(page, id, "draft");
  await expect(
    card.locator("p").filter({ hasText: "提出期限：" }),
  ).toContainText("500円");
  await expect(
    card.locator("p").filter({ hasText: "提出期限：" }),
  ).not.toContainText(message);
});

test("upload copies show the restore instruction and cannot open until the owner restores the folder and checks readiness", async ({
  page,
}, info) => {
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  const createForm = page.locator('form[data-club-action="create"]');
  await createForm.locator('[name="kind"]').selectOption("welcome_meal");
  await createForm.locator('[name="year"]').fill("2027");
  await createForm.locator('[name="fee"]').fill("0");
  await createForm.locator('[name="deadline"]').fill("2027-11-08T23:59");
  await createForm.locator('[name="eventName"]').fill("画像準備テスト");
  await createForm.locator('[name="startsAt"]').fill("2027-11-10T15:00");
  await createForm.locator('[name="place"]').fill("架空の会場");
  const navigation = page.waitForEvent("domcontentloaded");
  const posted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/club-forms") &&
      response.request().method() === "POST",
  );
  await createForm
    .getByRole("button", { name: "下書きフォームを生成", exact: true })
    .click();
  const response = await posted;
  const { id } = response.request().postDataJSON();
  await navigation;
  await waitDone(page, id, "draft");
  const card = page.locator(`[data-club-id="${id}"]`);
  await expect(
    card.getByText("画像保存先の準備待ち", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText(/「復元」を1回押してください/)).toBeVisible();
  await expect(
    card.getByRole("button", { name: "受付開始", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("club-upload-setup.png"),
    fullPage: true,
  });
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    card
      .getByRole("button", { name: "画像保存先の準備を確認", exact: true })
      .click(),
  ]);
  await expect(
    card.getByRole("button", { name: "受付開始", exact: true }),
  ).toBeEnabled();
  await expect(
    card.getByText("画像保存先の準備待ち", { exact: true }),
  ).toHaveCount(0);
});

test("executives generate all four draft types, inspect actual links, and control closing and reopening without new files", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await login(page, `photo-executive-${info.project.name}@example.invalid`);
  await page.goto("/Admin/club-forms");
  await expect(
    page.getByRole("heading", {
      name: "入会・継続・新歓フォーム",
      exact: true,
    }),
  ).toBeVisible();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const labels = {
    admission: "入会",
    continuation: "継続",
    welcome_photo: "新歓撮影会",
    welcome_meal: "新歓食事会",
  };
  let firstId = "",
    firstUrl = "";
  for (const [kind, label] of Object.entries(labels)) {
    await page
      .getByRole("button", { name: `${label}フォームを作成`, exact: true })
      .click();
    const form = page.locator('form[data-club-action="create"]');
    await form.getByLabel("西暦", { exact: true }).fill("2027");
    await form
      .getByRole("combobox", { name: "春・秋", exact: true })
      .selectOption("autumn");
    await form
      .getByRole("spinbutton", { name: /^会費・参加費（円）/ })
      .fill(kind === "admission" ? "4500" : "500");
    await form.getByLabel("提出期限", { exact: true }).fill("2027-11-08T23:59");
    if (kind.startsWith("welcome_")) {
      await form
        .getByLabel("企画名", { exact: true })
        .fill(`新歓テスト ${info.project.name} ${kind}`);
      await form
        .getByLabel("開催日時", { exact: true })
        .fill("2027-11-10T15:00");
      await form
        .getByLabel("終了日時（任意）", { exact: true })
        .fill("2027-11-10T18:00");
      await form.getByLabel("場所", { exact: true }).fill("早稲田周辺");
    }
    const navigation = page.waitForEvent("domcontentloaded");
    const posted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/club-forms") &&
        response.request().method() === "POST",
    );
    await form
      .getByRole("button", { name: "下書きフォームを生成", exact: true })
      .click();
    const response = await posted;
    expect(response.ok(), `作成要求の応答: ${response.status()}`).toBe(true);
    const { id } = response.request().postDataJSON();
    await navigation;
    await waitDone(page, id, "draft");
    const card = page.locator(`[data-club-id="${id}"]`);
    await expect(card.getByText("下書き", { exact: true })).toBeVisible();
    for (const link of ["回答用フォーム", "編集", "回答シート", "保存先"])
      await expect(
        card.getByRole("link", { name: link, exact: true }),
      ).toHaveAttribute("href", /^https:\/\/(?:docs|drive)\.google\.com\//);
    expect(
      await card.getByRole("link", { name: "統合名簿", exact: true }).count(),
    ).toBe(kind.startsWith("welcome_") ? 0 : 1);
    if (!firstId) {
      firstId = id;
      firstUrl = (await card
        .getByRole("link", { name: "回答用フォーム", exact: true })
        .getAttribute("href"))!;
    }
  }
  let card = page.locator(`[data-club-id="${firstId}"]`);
  await card
    .locator('[data-club-action="open"] input[name="deadline"]')
    .fill("2027-12-01T23:59");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    card.getByRole("button", { name: "受付開始", exact: true }).click(),
  ]);
  await waitDone(page, firstId, "open");
  card = page.locator(`[data-club-id="${firstId}"]`);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    card.getByRole("button", { name: "今すぐ受付終了", exact: true }).click(),
  ]);
  await waitDone(page, firstId, "closed");
  card = page.locator(`[data-club-id="${firstId}"]`);
  const reopen = card.locator('form[data-club-action="open"]');
  await reopen.locator('[name="deadline"]').fill("2020-01-01T00:00");
  await reopen.getByRole("button", { name: "受付を再開", exact: true }).click();
  await expect(reopen.locator("[data-status]")).toContainText("未来");
  await reopen.locator('[name="deadline"]').fill("2027-12-15T23:59");
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    reopen.getByRole("button", { name: "受付を再開", exact: true }).click(),
  ]);
  await waitDone(page, firstId, "open");
  await expect(
    page
      .locator(`[data-club-id="${firstId}"]`)
      .getByRole("link", { name: "回答用フォーム", exact: true }),
  ).toHaveAttribute("href", firstUrl);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("club-forms-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.screenshot({
    path: info.outputPath("club-forms-desktop.png"),
    fullPage: true,
  });
});

test("members and staff cannot use the management page or API", async ({
  browser,
}, info) => {
  for (const who of ["member", `photo-staff-${info.project.name}`]) {
    const context = await browser.newContext({ baseURL: origin }),
      p = await context.newPage();
    await p.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "127.0.0.1"
        ? route.continue()
        : route.abort(),
    );
    await login(p, `${who}@example.invalid`);
    expect((await p.request.get("/api/admin/club-forms")).status()).toBe(403);
    expect((await p.goto("/Admin/club-forms"))!.status()).toBe(403);
    expect(
      (
        await p.request.post("/api/admin/club-forms", {
          headers,
          data: {
            action: "create",
            id: crypto.randomUUID(),
            operationId: crypto.randomUUID(),
            input: {},
          },
        })
      ).status(),
    ).toBe(403);
    await context.close();
  }
});

test("two-source roster preview shows explicit declines and grade changes, applies only on confirmation and exports a merged sheet", async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, "admin@example.invalid");
  await restoreFixtureRoster(page.request);
  await page.goto("/Admin/grouping-roster");
  const link = page.locator('form[data-activity-action="roster.link"]');
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    link
      .getByRole("button", { name: "対応を確認して連携を保存", exact: true })
      .click(),
  ]);
  const form = page
    .locator('form[data-activity-action="roster.preview"]')
    .filter({ has: page.locator('[name="mode"][value="term"]') });
  await form.getByLabel("対象の西暦", { exact: true }).fill("2027");
  await form
    .getByRole("combobox", { name: "春・秋", exact: true })
    .selectOption("spring");
  await form.locator('[name="admissionUrl"]').fill(admission);
  await form.locator('[name="continuationUrl"]').fill(continuation);
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    form
      .getByRole("button", { name: "入会・継続の変更内容を確認", exact: true })
      .click(),
  ]);
  await expect(page).toHaveURL(/grouping-roster\/preview\?id=/);
  await expect(
    page.getByRole("heading", { name: "追加・復会・学年変更", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("継続しない", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("1年生 → 2年生", { exact: false })).toBeVisible();
  await page.getByRole("checkbox").check();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page
      .getByRole("button", {
        name: "名簿の参照先と退会処理を適用",
        exact: true,
      })
      .click(),
  ]);
  await expect
    .poll(async () => {
      await page.reload();
      return page
        .getByRole("link", {
          name: "確定した統合名簿をGoogleで開く",
          exact: true,
        })
        .count();
    })
    .toBe(1);
  await expect(
    page.getByRole("link", { name: "入会フォームの回答", exact: true }),
  ).toHaveAttribute("href", admission);
  await restoreFixtureRoster(page.request);
});
