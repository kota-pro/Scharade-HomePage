import { fixtureLogin } from "./fixture-auth";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
const headers = { Origin: "http://127.0.0.1:4329" };
test.use({ timezoneId: "Asia/Tokyo" });

test("staff creates an exhibition with a Kanji title from the management screen", async ({ page }, info) => {
  const title = `秋季写真展「光と影」 ${info.project.name}`;
  await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } });
  await page.goto("/Member/manage");
  await expect(page.getByRole("heading", { name: "管理・運営", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "写真展管理", exact: true }).click();
  await expect(page.getByRole("link", { name: "管理・運営へ戻る", exact: true })).toBeVisible();
  await page.getByLabel("写真展名", { exact: true }).fill(title);
  await page.getByRole("button", { name: "作成して設定を開く", exact: true }).click();
  await expect(page).toHaveURL(/\/Member\/manage\/exhibitions\/[a-f0-9-]{36}$/);
  await expect(page.locator('[data-setting="title"]')).toHaveValue(title);
  await page.goto("/Member/manage/exhibitions");
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.route("**/api/member/exhibitions", route => route.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><title>404</title>" }));
  await page.getByLabel("写真展名", { exact: true }).fill("別の写真展");
  await page.getByRole("button", { name: "作成して設定を開く", exact: true }).click();
  await expect(page.locator("#create-exhibition .exhibition-status")).toContainText("画面を再読み込み");
  await expect(page.getByLabel("写真展名", { exact: true })).toHaveValue("別の写真展");
  await expect(page.getByRole("button", { name: "作成して設定を開く", exact: true })).toBeEnabled();
});

test("exhibition editor preserves draft slots, numeric questions, replacements and local dates", async ({ page, browser }, info) => {
  await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } });
  const index = ["chromium", "firefox", "webkit"].indexOf(info.project.name) + 1;
  const seed = (await (await page.request.get(`/api/member/exhibitions/f1000000-0000-4000-8000-00000000000${index}`)).json()).exhibition;
  const command = async (data: Record<string, unknown>) => {
    const response = await page.request.post("/api/member/exhibitions", { headers, data });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).exhibition;
  };
  let e = await command({ action: "create", title: `入力・置換の確認 ${info.project.name}` });
  const field = crypto.randomUUID();
  e = await command({ action: "schema", exhibitionId: e.id, revision: e.revision, schema: { ...seed.schemas[0], fields: [{ id: field, label: "展示費用", description: "", type: "number", scope: "common", required: true, options: [] }] } });
  const voteOpened = new Date(Date.now() - 10000).toISOString();
  e = await command({ action: "settings", exhibitionId: e.id, revision: e.revision, title: e.title, status: "open", gallery: "staff", opensAt: new Date(Date.now() + 3600000).toISOString(), closesAt: seed.closesAt, voteOpensAt: voteOpened, voteClosesAt: new Date(Date.now() + 5 * 60000).toISOString(), recipientIds: ["member"] });
  await command({ action: "participation.publish", exhibitionId: e.id, revision: e.revision, body: "架空の出展テストです。" });
  await expect.poll(async () => (await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.participation.state).toBe("published");
  await page.goto(`/Member/manage/exhibitions/${e.id}`);
  const localOpens = new Date(Date.parse(e.opensAt) + 9 * 3600000).toISOString().slice(0, 16);
  await expect(page.locator('[data-setting="opensAt"]')).toHaveValue(localOpens);
  await page.getByRole("button", { name: "受付設定を保存", exact: true }).click();
  await expect(page.locator(".exhibition-status")).toContainText("受付設定を保存しました");
  expect((await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.opensAt).toBe(new Date(`${localOpens}:00+09:00`).toISOString());
  await page.goto(`/Member/manage/exhibitions/${e.id}/layout`);
  await page.getByRole("button", { name: "展示室を追加", exact: true }).click();
  await expect(page.locator('[data-room-root="name"]')).toHaveValue("展示室 1");
  await page.getByRole("button", { name: "展示室レイアウトを保存", exact: true }).click();
  await expect(page.locator(".exhibition-status")).toContainText("展示室レイアウトを保存しました");
  const publicContext = await browser.newContext({ timezoneId: "Asia/Tokyo" });
  const submit = await publicContext.newPage();
  const errors: string[] = []; submit.on("pageerror", e => errors.push(e.message));
  try {
    await fixtureLogin(submit.request, "http://127.0.0.1:4329/api/auth/login", { headers, data: { email: "member@example.invalid", password: "fixture-password-123" } });
    expect((await submit.request.post(`http://127.0.0.1:4329/api/member/exhibitions/${e.id}/participation`, { headers, data: { vote: "attending" } })).status()).toBe(200);
    e = (await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;
    e = await command({ action: "settings", exhibitionId: e.id, revision: e.revision, title: e.title, status: "open", gallery: "staff", opensAt: seed.opensAt, closesAt: seed.closesAt, voteOpensAt: seed.participation.opensAt, voteClosesAt: seed.participation.closesAt });
    await submit.goto(`http://127.0.0.1:4329/Exhibition/${e.id}`);
    if (await submit.locator('[data-begin]').count()) await submit.locator('[data-begin]').click();
    await submit.locator('[data-common="name"]').fill("作者"); await submit.locator('[data-common="grade"]').fill("1年"); await submit.locator('[data-common="authorName"]').fill("作者");
    await submit.getByLabel("展示費用").fill("1200");
    await submit.getByLabel("通常展示", { exact: true }).check();
    await submit.getByLabel("単写真枚数").fill("0"); await submit.getByLabel("単写真枚数").press("Tab");
    await submit.getByLabel("ブック冊数").fill("0"); await submit.getByLabel("ブック冊数").press("Tab");
    await submit.getByLabel("組写真作品数").fill("1"); await submit.getByLabel("組写真作品数").press("Tab");
    await submit.locator('[data-work-key="title"]').fill("組写真");
    await submit.locator('[data-photo-index="1"][data-photo-key="x"]').fill("-40"); await submit.locator('[data-photo-index="1"][data-photo-key="x"]').press("Tab");
    await submit.getByRole("button", { name: "下書きを保存", exact: true }).click();
    await expect(submit.locator(".exhibition-status")).toContainText("下書きを保存しました"); await submit.reload();
    await expect(submit.getByLabel("展示費用")).toHaveValue("1200"); await expect(submit.locator('[data-photo-index="1"][data-photo-key="x"]')).toHaveValue("-40");
    const a = await sharp({ create: { width: 30, height: 20, channels: 3, background: "white" } }).png().toBuffer();
    const b = await sharp({ create: { width: 20, height: 30, channels: 3, background: "black" } }).png().toBuffer();
    const upload = async (index: number, name: string, buffer: Buffer) => {
      const response = submit.waitForResponse(r => r.url().endsWith(`/api/exhibitions/${e.id}/upload`) && r.request().method() === "POST");
      await submit.locator(`[data-upload-index="${index}"]`).setInputFiles({ name, mimeType: "image/png", buffer });
      expect((await response).ok()).toBe(true);
      await expect(submit.locator(".exhibition-status")).toContainText("写真を保存しました");
      await expect(submit.locator("[data-submit]")).toBeEnabled();
    };
    await upload(0, "a.png", a);
    const previous = await submit.locator(".work-photo-row img").first().getAttribute("src");
    await upload(0, "b.png", b);
    expect(await submit.locator(".work-photo-row img").first().getAttribute("src")).not.toBe(previous);
    await upload(1, "a.png", a);
    await submit.getByRole("button", { name: "提出する", exact: true }).click(); await expect(submit.locator(".exhibition-status")).toContainText("提出しました");
    await page.goto(`/Member/manage/exhibitions/${e.id}/submissions`);
    await page.getByText("タイトルボードの内容を修正", { exact: true }).click();
    await page.locator('[data-board-key="title"]').fill("修正した組写真");
    await page.getByRole("button", { name: "修正を保存", exact: true }).click();
    await expect(page.locator(".exhibition-status")).toContainText("タイトルボードの内容を修正しました");
    await page.reload();
    await page.getByText("タイトルボードの内容を修正", { exact: true }).click();
    await expect(page.locator('[data-board-key="title"]')).toHaveValue("修正した組写真");
    await page.screenshot({ path: "/private/tmp/scharade-exhibition-reviewed.png", fullPage: true });
    expect(errors).toEqual([]);
  } finally { await publicContext.close(); }
});

test("series mm controls, grid drag and paper sizes remain usable without overlapping at desktop and mobile widths", async ({ page }, info) => {
  const index = ["chromium", "firefox", "webkit"].indexOf(info.project.name) + 1, id = `f1000000-0000-4000-8000-00000000000${index}`;
  await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "member@example.invalid", password: "fixture-password-123" } });
  await page.goto(`/Exhibition/${id}`);
  if (await page.locator('[data-begin]').count()) await page.locator('[data-begin]').click();
  await page.getByLabel("通常展示", { exact: true }).check();
  await page.getByLabel("単写真枚数").fill("0"); await page.getByLabel("単写真枚数").press("Tab");
  await page.getByLabel("ブック冊数").fill("0"); await page.getByLabel("ブック冊数").press("Tab");
  await page.getByLabel("組写真作品数").fill("1"); await page.getByLabel("組写真作品数").press("Tab");
  await expect(page.locator('[data-series-editor]')).toBeVisible();
  await page.locator('[data-photo-paper="0"]').selectOption("A4");
  await page.locator('[data-photo-orientation="0"]').selectOption("portrait");
  await expect(page.locator('[data-photo-index="0"][data-photo-key="width"]')).toHaveValue("210");
  await expect(page.locator('[data-photo-index="0"][data-photo-key="height"]')).toHaveValue("297");
  await page.locator('[data-photo-index="0"][data-photo-key="rotation"]').fill("37");
  await page.locator('[data-photo-index="0"][data-photo-key="rotation"]').press("Tab");
  await page.locator('[data-series-pair-gap="x"]').fill("12.5"); await page.locator('[data-series-pair-gap="x"]').press("Tab");
  await expect(page.locator('[data-series-pair-gap="x"]')).toHaveValue("12.5");
  await page.locator('[data-series-select-all]').click();
  await page.locator('[data-series-setting="mode"]').selectOption("horizontal");
  await page.locator('[data-series-setting="gapX"]').fill("20"); await page.locator('[data-series-setting="gapX"]').press("Tab");
  await page.locator('[data-series-arrange]').click();
  await expect(page.locator('[data-series-pair-gap="x"]')).toHaveValue("20");
  const canvas = page.locator('[data-series-work]'), first = canvas.locator('[data-series-photo="0"]');
  await first.scrollIntoViewIfNeeded(); const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 23, box.y + box.height / 2 + 13); await page.mouse.up();
  const x = Number(await page.locator('[data-photo-index="0"][data-photo-key="x"]').inputValue());
  expect(Math.abs(x / 5 - Math.round(x / 5))).toBeLessThan(.001);
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await expect(page.locator(".exhibition-status")).toContainText("下書きを保存しました");
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true);
    const fields = await page.locator('.work-photo-row label').evaluateAll(elements => elements.map(e => { const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; }));
    for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) expect(Math.min(fields[i].right,fields[j].right)-Math.max(fields[i].x,fields[j].x)>1 && Math.min(fields[i].bottom,fields[j].bottom)-Math.max(fields[i].y,fields[j].y)>1).toBe(false);
    await page.screenshot({ path: `/private/tmp/exhibition-form-${info.project.name}-${width}.png`, fullPage: true });
  }
  const top = page.locator('a.page-top-nav');
  await expect(top).toHaveCount(1); await expect(top.locator('svg path')).toHaveAttribute('d', /^M2\.692 16 12 6\.692/);
});

test("room anchors and precision inspector are separate columns on PC, retain walls and offer undo", async ({ page }, info) => {
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } })).status()).toBe(200);
  const created = await page.request.post("/api/member/exhibitions", { headers, data: { action: "create", title: `展示室精密編集の確認 ${info.project.name}` } });
  expect(created.status()).toBe(200);
  const id = (await created.json()).exhibition.id;
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`/Member/manage/exhibitions/${id}/layout`);
  await page.locator('[data-room-add]').click();
  await page.locator('[data-open-room-editor="floor"]').click();await page.locator('[data-layout-tool="direct"]').click();await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(4);
  const left = (await page.locator('.layout-stage').boundingBox())!, right = (await page.locator('.layout-sidebar').boundingBox())!;
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width);
  await page.locator('[data-layout-tool="direct"]').click();await page.locator('[data-vector-node="0"][data-vector-target="room"]').click();await page.locator('[data-vector-coordinate="0"][data-vector-key="x"]').fill("100"); await page.locator('[data-vector-coordinate="0"][data-vector-key="x"]').press("Tab");
  await page.locator('[data-layout-property="wall-length"]').fill("5000"); await page.locator('[data-layout-property="wall-length"]').press('Tab');
  await expect(page.locator('[data-layout-property="wall-length"]')).toHaveValue("5000");
  await page.locator('[data-layout-tool="draw"]').click();const midpoint=await page.locator('[data-layout-wall="0"]').evaluate(el=>{const path=el as SVGPathElement,p=path.getPointAtLength(path.getTotalLength()/2),q=new DOMPoint(p.x,p.y).matrixTransform(path.getScreenCTM()!);return{x:q.x,y:q.y};});await page.mouse.click(midpoint.x,midpoint.y); await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(5);
  await page.locator('[data-layout-undo]').click(); await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(4);
  await page.locator('[data-layout-redo]').click(); await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(5);
  await page.locator('[data-layout-tool="direct"]').click();await page.locator('[data-vector-node="1"][data-vector-target="room"]').click(); await page.keyboard.press('Delete');
  await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(4);
  await page.locator('[data-layout-save]').click(); await expect(page.locator('.site-notice').last()).toContainText('展示室レイアウトを保存しました');
  await page.reload(); await page.locator('[data-open-room-editor="floor"]').click();await page.locator('[data-layout-tool="direct"]').click();await page.locator('[data-layout-tool="direct"]').click();await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(4);
  for (const width of [1024, 375]) { await page.setViewportSize({width,height:900}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2)).toBe(true); await page.screenshot({path:`/private/tmp/exhibition-room-${info.project.name}-${width}.png`,fullPage:true}); }
});

test("nonparticipants and anonymous callers cannot read forms, uploads or another member's assets", async ({ page, browser }, info) => {
  const index = ["chromium", "firefox", "webkit"].indexOf(info.project.name) + 1, id = `f1000000-0000-4000-8000-00000000000${index}`;
  expect((await page.request.get(`/api/exhibitions/${id}`)).status()).toBe(401);
  await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "other@example.invalid", password: "fixture-password-123" } });
  const result = await (await page.request.get(`/api/exhibitions/${id}`)).json();
  expect(result.submission).toBeNull(); expect(result.exhibition.accepting).toBe(false);
  expect((await page.request.post(`/api/exhibitions/${id}`, {headers,data:{action:'begin'}})).status()).toBe(403);
  const owner = await browser.newContext();
  try {
    const ownerPage = await owner.newPage(); await fixtureLogin(ownerPage.request, 'http://127.0.0.1:4329/api/auth/login', {headers,data:{email:'member@example.invalid',password:'fixture-password-123'}});
    expect((await ownerPage.request.post(`http://127.0.0.1:4329/api/exhibitions/${id}`,{headers,data:{action:'begin',revision:0}})).status()).toBe(200);
    const buffer=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).png().toBuffer(),assetId=crypto.randomUUID();
    expect((await ownerPage.request.post(`http://127.0.0.1:4329/api/exhibitions/${id}/upload`,{headers,multipart:{token:'',assetId,file:{name:'private.png',mimeType:'image/png',buffer}}})).status()).toBe(200);
    expect((await page.request.get(`/api/exhibitions/${id}/assets/${assetId}?preview=1`)).status()).toBe(403);
  }
  finally { await owner.close(); }
});

test("staff notice opens voting, both periods appear in the calendar, and only attendees start the form after the vote closes", async ({ page, browser }, info) => {
  await fixtureLogin(page.request, "/api/auth/login", { headers, data: { email: "planner@example.invalid", password: "fixture-password-123" } });
  let e = (await (await page.request.post('/api/member/exhibitions',{headers,data:{action:'create',title:`参加投票確認 ${info.project.name}`}})).json()).exhibition;
  const now = Date.now(), iso = (delta: number) => new Date(now+delta).toISOString();
  e = (await (await page.request.post('/api/member/exhibitions',{headers,data:{action:'settings',exhibitionId:e.id,revision:e.revision,title:e.title,status:'open',gallery:'staff',voteOpensAt:iso(-10000),voteClosesAt:iso(60000),opensAt:iso(60000),closesAt:iso(3600000),recipientIds:['member','other']}})).json()).exhibition;
  expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'participation.publish',exhibitionId:e.id,revision:e.revision,body:'参加をご回答ください。'}})).ok()).toBe(true);
  await expect.poll(async () => (await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition.participation.state).toBe('published');
  const context = await browser.newContext({timezoneId:'Asia/Tokyo'}), member = await context.newPage();
  try {
    await fixtureLogin(member.request, 'http://127.0.0.1:4329/api/auth/login', {headers,data:{email:'member@example.invalid',password:'fixture-password-123'}});
    await member.goto(`http://127.0.0.1:4329/Member/exhibitions/${e.id}`); await member.locator('[data-exhibition-answer="attending"]').click();
    await expect(member.getByText('現在の回答：参加', {exact:true})).toBeVisible();
    expect((await member.request.post(`http://127.0.0.1:4329/api/exhibitions/${e.id}`,{headers,data:{action:'begin'}})).status()).toBe(403);
    const month = new Date(now+9*3600000).toISOString().slice(0,7);
    await member.goto(`http://127.0.0.1:4329/Member?view=calendar&month=${month}`);
    await expect(member.locator('[data-calendar-kind="exhibition-vote"]').filter({hasText:e.title}).first()).toBeVisible();
    await expect(member.locator('[data-calendar-kind="exhibition-form"]').filter({hasText:e.title}).first()).toBeVisible();
    e = (await (await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;
    expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'settings',exhibitionId:e.id,revision:e.revision,title:e.title,status:'open',gallery:'staff',voteOpensAt:iso(-10000),voteClosesAt:iso(-1000),opensAt:iso(-1000),closesAt:iso(3600000)}})).ok()).toBe(true);
    expect((await member.request.post(`http://127.0.0.1:4329/api/member/exhibitions/${e.id}/participation`,{headers,data:{vote:'absent'}})).status()).toBe(409);
    await member.goto(`http://127.0.0.1:4329/Member/exhibitions/${e.id}`);
    await member.getByRole('link',{name:'出展フォームを入力する',exact:true}).click(); await member.getByRole('button',{name:'出展を開始する',exact:true}).click();
    await expect(member.locator('[data-common="name"]')).toBeVisible();
    await fixtureLogin(member.request, 'http://127.0.0.1:4329/api/auth/login', {headers,data:{email:'other@example.invalid',password:'fixture-password-123'}});
    expect((await member.request.post(`http://127.0.0.1:4329/api/exhibitions/${e.id}`,{headers,data:{action:'begin'}})).status()).toBe(403);
  } finally { await context.close(); }
});
