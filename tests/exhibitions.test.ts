import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { exhibitionAction, publicAction, readExhibitions, uploadExhibitionAsset, updateExhibitionStore } from "../src/lib/exhibitions.ts";
import { exhibitionLayoutPdf, exhibitionLayoutPng, exhibitionLayoutSvg, generateTitleBoards } from "../src/lib/exhibitionOutputs.ts";
import { createExhibitionGoogleForm, deliverExhibitionVersion } from "../src/lib/exhibitionIntegrations.ts";
import { ExhibitionError } from "../src/lib/exhibitionValidation.ts";
import { writeData } from "../src/lib/store.ts";
import type { User } from "../src/lib/auth.ts";
import { parseContent } from "../src/lib/exhibitionValidation.ts";
import { importTitleBoardRows } from "../src/lib/exhibitionSheetImport.ts";
import { workLayoutPng } from "../src/lib/exhibitionOutputs.ts";

type AnyRecord = Record<string, any>;

const users: User[] = [
  { id: "staff", name: "運営", email: "staff@example.invalid", approved: true, role: "staff", createdAt: "2026-01-01", providers: {} },
  { id: "author", name: "山田 花子", email: "author@example.invalid", approved: true, role: "member", portfolioId: "portfolio-1", createdAt: "2026-01-01", providers: {} },
];
async function makeEligible(exhibitionId: string) {
  await updateExhibitionStore(data => {
    const e = data.exhibitions.find(e => e.id === exhibitionId)!;
    const now = Date.now();
    e.opensAt = new Date(now - 1000).toISOString(); e.closesAt = new Date(now + 60000).toISOString();
    e.participation = { state: "published", opensAt: new Date(now - 3000).toISOString(), closesAt: new Date(now - 2000).toISOString(), recipientIds: ["author"], votes: { author: { value: "attending", at: new Date(now - 2500).toISOString(), actorId: "author" } } };
  });
}
async function attach(exhibitionId: string, token: string) {
  const bytes = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const assetId = crypto.randomUUID();
  await uploadExhibitionAsset(exhibitionId, token, assetId, new File([new Uint8Array(bytes)], "cover.png", { type: "image/png" }), "author");
  return { assetId, x: 0, y: 0, width: 120, height: 80, rotation: 0 };
}

test("photo exhibition enforces submissions, QR confirmation and an eight-up A4 title-board PDF", async () => {
  const previous = process.env.DATA_DIR, directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-exhibition-"));
  process.env.DATA_DIR = directory;
  try {
    writeData("users.json", users);
    const created = await exhibitionAction("staff", { action: "create", title: "春の写真展" });
    const exhibition = created.exhibition;
    const configured = await exhibitionAction("staff", { action: "settings", exhibitionId: exhibition.id, revision: exhibition.revision, title: exhibition.title, status: "open", gallery: "staff", opensAt: "", closesAt: "" });
    const opened = configured.exhibition;
    await makeEligible(opened.id);
    const begun = await publicAction(opened.id, "", { action: "begin", revision: 0 }, "author");
    assert.ok("token" in begun);
    const section = opened.schemas[0].sections[0];
    const photo = await attach(opened.id, begun.token);
    const submitted = await publicAction(opened.id, begun.token, {
      action: "submit", revision: begun.submission.revision,
      content: { name: "山田 花子", grade: "2年", authorName: "山田 花子", portfolioUrl: "", fields: {}, sections: [{ sectionId: section.id, singles: 0, series: 0, books: 1, seriesPhotoCounts: [], fields: {} }], works: [{ id: crypto.randomUUID(), sectionId: section.id, kind: "book", title: "記録", caption: "光と影を記録した一冊です。", location: "東京都新宿区", equipment: "Nikon Z f", settings: "1/125秒 F2.8 ISO 400", photos: [photo], fields: {} }] },
    }, "author");
    assert.equal(submitted.submission.versions.length, 1);
    let boards = await generateTitleBoards(readExhibitions(), opened, "https://example.invalid");
    assert.ok(boards.pdf, "unique registered names automatically receive their Portfolio QR");
    const refreshed = readExhibitions().exhibitions.find(item => item.id === opened.id)!;
    await exhibitionAction("staff", { action: "qr", exhibitionId: refreshed.id, revision: refreshed.revision, submissionId: submitted.submission.id, portfolioId: "portfolio-1" });
    boards = await generateTitleBoards(readExhibitions(), readExhibitions().exhibitions.find(item => item.id === opened.id)!, "https://example.invalid");
    assert.ok(boards.pdf);
    if (process.env.EXHIBITION_FIXTURE_OUTPUT) fs.writeFileSync(process.env.EXHIBITION_FIXTURE_OUTPUT, boards.pdf!);
    const pdf = await PDFDocument.load(boards.pdf!);
    assert.equal(pdf.getPageCount(), 1);
    const size = pdf.getPage(0).getSize();
    assert.deepEqual([Math.round(size.width), Math.round(size.height)], [595, 842]);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("room validation refuses malformed rooms and keeps each work in one place", async () => {
  const previous = process.env.DATA_DIR, directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-exhibition-room-"));
  process.env.DATA_DIR = directory;
  try {
    writeData("users.json", users);
    const created = await exhibitionAction("staff", { action: "create", title: "配置確認" });
    await assert.rejects(
      () => exhibitionAction("staff", { action: "rooms", exhibitionId: created.exhibition.id, revision: created.exhibition.revision, rooms: [{ id: crypto.randomUUID(), name: "展示室", vertices: [{ x: 0, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }, { x: 1000, y: 0 }], wallHeights: [3000, 3000, 3000, 3000], openings: [], placements: [], tables: [], books: [] }] }),
      (error: unknown) => error instanceof ExhibitionError && /閉じた形/.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("exhibition layout exports a real-scale floor plan as SVG, PNG and landscape A4 PDF", async () => {
  const room = { id: crypto.randomUUID(), name: "第一展示室", vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }], wallHeights: [3000, 3000, 3000, 3000], openings: [{ id: crypto.randomUUID(), wall: 0, kind: "door" as const, offset: 500, width: 900, bottom: 0, height: 2100 }], placements: [], tables: [{ id: crypto.randomUUID(), name: "ブック台", x: 1200, y: 900, width: 1200, depth: 600, rotation: 0 }], books: [] };
  const svg = exhibitionLayoutSvg(room, []), png = exhibitionLayoutPng(room, []), pdf = await exhibitionLayoutPdf([room], []);
  assert.match(svg, /第一展示室/);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const page = (await PDFDocument.load(pdf)).getPage(0).getSize();
  assert.ok(page.width > page.height);
});

test("Google Forms gateway batches one response per work and makes retries idempotent", async () => {
  const previousNewUrl = process.env.EXHIBITION_DRIVE_GAS_URL, previousNewSecret = process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET;
  const previous = process.env.DATA_DIR, previousUrl = process.env.EXHIBITION_GAS_URL, previousSecret = process.env.EXHIBITION_WEBHOOK_SECRET, originalFetch = globalThis.fetch;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-exhibition-gateway-"));
  process.env.DATA_DIR = directory; process.env.EXHIBITION_GAS_URL = "https://script.google.com/macros/s/fixture/exec"; process.env.EXHIBITION_WEBHOOK_SECRET = "x".repeat(64);
  process.env.EXHIBITION_DRIVE_GAS_URL = "https://script.google.com/macros/s/newfixture/exec"; process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = "y".repeat(64);
  const received: AnyRecord[] = [];
  try {
    writeData("users.json", users);
    globalThis.fetch = async (_input, init) => {
      const envelope = JSON.parse(String(init?.body)), request = JSON.parse(envelope.payload); received.push(request);
      if (request.action === "health") return Response.json({ ok: true, gatewayVersion: 3, owner: "sharadeshashinten@gmail.com", driveApi: true });
      if (request.action === "folders.ensure") return Response.json({ ok: true, owner: "sharadeshashinten@gmail.com", folderId: "folder_fixture_123", originalsId: "originals_fixture_123", layoutsId: "layouts_fixture_123", outputsId: "outputs_fixture_123", yearFolderName: `${request.year}年` });
      if (request.action === "file.begin") return Response.json({ ok: true, done: false, offset: 0 });
      if (request.action === "file.chunk") return Response.json({ ok: true, done: true, owner: "sharadeshashinten@gmail.com", fileId: "file_fixture_123", url: "https://drive.google.com/file/d/file_fixture_123/view" });
      if (request.action === "form.create") return Response.json({ ok: true, formId: "form_fixture_123", spreadsheetId: "sheet_fixture_123", itemIds: Object.fromEntries(request.fields.map((field: AnyRecord, index: number) => [field.id, index + 1])) });
      if (request.action === "response.submit") return Response.json({ ok: true, delivered: request.rows.map((row: AnyRecord) => row.idempotencyKey) });
      return Response.json({ ok: false }, { status: 400 });
    };
    const created = await exhibitionAction("staff", { action: "create", title: "Google連携" });
    const configured = await exhibitionAction("staff", { action: "settings", exhibitionId: created.exhibition.id, revision: created.exhibition.revision, title: "Google連携", status: "open", gallery: "staff", opensAt: "", closesAt: "" });
    await makeEligible(configured.exhibition.id);
    const begun = await publicAction(configured.exhibition.id, "", { action: "begin", revision: 0 }, "author"); assert.ok("token" in begun);
    const section = configured.exhibition.schemas[0].sections[0];
    const photo = await attach(configured.exhibition.id, begun.token);
    const bookWorks = Array.from({ length: 9 }, () => ({ id: crypto.randomUUID(), sectionId: section.id, kind: "book", title: "冊子", caption: "", location: "", equipment: "", settings: "", photos: [photo], fields: {} }));
    const submitted = await publicAction(configured.exhibition.id, begun.token, { action: "submit", revision: begun.submission.revision, content: { name: "山田 花子", grade: "2年", authorName: "山田 花子", portfolioUrl: "", fields: {}, sections: [{ sectionId: section.id, singles: 0, series: 0, books: 9, seriesPhotoCounts: [], fields: {} }], works: bookWorks } }, "author");
    await createExhibitionGoogleForm(configured.exhibition.id);
    assert.equal(await deliverExhibitionVersion(configured.exhibition.id, submitted.submission.id, 1), true);
    const batches = received.filter(request => request.action === "response.submit");
    assert.deepEqual(batches.map(batch => batch.rows.length), [8, 1]);
    assert.equal(readExhibitions().submissions[0].versions[0].delivery, "delivered");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousNewUrl === undefined) delete process.env.EXHIBITION_DRIVE_GAS_URL; else process.env.EXHIBITION_DRIVE_GAS_URL = previousNewUrl;
    if (previousNewSecret === undefined) delete process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET; else process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = previousNewSecret;
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    if (previousUrl === undefined) delete process.env.EXHIBITION_GAS_URL; else process.env.EXHIBITION_GAS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.EXHIBITION_WEBHOOK_SECRET; else process.env.EXHIBITION_WEBHOOK_SECRET = previousSecret;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("drafts retain unuploaded photo slots and book images are optional on final submission", () => {
  const sectionId = crypto.randomUUID(), schema = { version: 1, captionLabel: "説明", sections: [{ id: sectionId, title: "通常展示", description: "" }], fields: [] };
  const content = { name: "作者", grade: "1年", authorName: "作者", fields: {}, sections: [{ sectionId, singles: 0, series: 1, books: 0, seriesPhotoCounts: [2], fields: {} }], works: [{ id: crypto.randomUUID(), kind: "series", sectionId, title: "作品", photos: [{ assetId: "", x: -25, y: 12, width: 200, height: 150, rotation: 90 }, { assetId: "", x: 250, y: 0, width: 120, height: 80, rotation: 0 }], fields: {} }] };
  const draft = parseContent(content, schema, [], false);
  assert.equal(draft.works[0].photos.length, 2);
  assert.equal(draft.works[0].photos[0].x, -25);
  assert.throws(() => parseContent(content, schema, [], true), ExhibitionError);
  content.works[0].kind = "book"; content.works[0].photos = [];
  content.sections[0] = { sectionId, singles: 0, series: 0, books: 1, seriesPhotoCounts: [], fields: {} };
  assert.equal(parseContent(content, schema, [], true).works[0].photos.length, 0);
  content.works[0].photos = [{ assetId: "", x: 0, y: 0, width: 210, height: 297, rotation: 0 }];
  assert.equal(parseContent(content, schema, [], true).works[0].photos.length, 0);
});

test("sheet import creates title-board works, updates rows without duplicates and reports invalid rows", async () => {
  const previous = process.env.DATA_DIR, directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-exhibition-import-"));
  process.env.DATA_DIR = directory;
  try {
    writeData("users.json", users);
    const created = await exhibitionAction("staff", { action: "create", title: "既存フォーム" });
    const input = [["名前", "学年", "作者名", "作品タイトル", "キャプション"], ["山田 花子", "2年", "山田 花子", "光", "説明"], ["", "2年", "", "不正", ""]];
    const result = await importTitleBoardRows(created.exhibition.id, "source_spreadsheet_id_123", "フォームの回答 1", input);
    assert.equal(result.imported, 1); assert.equal(result.issues.length, 1);
    let data = readExhibitions(); assert.equal(data.submissions.length, 1); assert.equal(data.submissions[0].qrConfirmed, true);
    const workId = data.submissions[0].versions[0].content.works[0].id;
    assert.equal((await importTitleBoardRows(created.exhibition.id, "source_spreadsheet_id_123", "フォームの回答 1", input)).unchanged, 1);
    input[1][3] = "朝";
    await importTitleBoardRows(created.exhibition.id, "source_spreadsheet_id_123", "フォームの回答 1", input);
    data = readExhibitions(); assert.equal(data.submissions.length, 1);
    assert.equal(data.submissions[0].versions.at(-1)!.content.works[0].id, workId);
    assert.ok((await generateTitleBoards(data, data.exhibitions[0], "https://scharade.jp")).pdf);
    const submission = data.submissions[0], content = structuredClone(submission.versions.at(-1)!.content);
    content.works[0].title = "修正";
    await assert.rejects(() => exhibitionAction("author", { action: "submission.board" }), /運営以上/);
    await exhibitionAction("staff", { action: "submission.board", exhibitionId: created.exhibition.id, revision: data.exhibitions[0].revision, submissionId: submission.id, submissionRevision: submission.revision, content });
    data = readExhibitions();
    assert.equal(data.submissions[0].versions.at(-1)!.content.works[0].title, "修正");
    assert.equal(data.submissions[0].versions.at(-1)!.content.works[0].id, workId);
    assert.equal(data.submissions[0].versions.at(-1)!.delivery, "delivered");
    await assert.rejects(() => exhibitionAction("staff", { action: "submission.board", exhibitionId: created.exhibition.id, revision: data.exhibitions[0].revision, submissionId: submission.id, submissionRevision: submission.revision, content }), /別の画面/);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(directory, { recursive: true, force: true }); }
});

test("layout exports preserve top-down wall coordinates and fit extremely tall compositions", async () => {
  const room = { id: crypto.randomUUID(), name: "部屋", vertices: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }], wallHeights: [1000, 1000, 1000, 1000], openings: [], placements: [], tables: [], books: [] };
  const work = { id: crypto.randomUUID(), sectionId: crypto.randomUUID(), kind: "single" as const, title: "写真", caption: "", location: "", equipment: "", settings: "", fields: {}, photos: [{ assetId: crypto.randomUUID(), x: 0, y: 0, width: .1, height: 100000, rotation: 0 }] };
  const png = workLayoutPng(work), metadata = await sharp(png).metadata();
  assert.ok(metadata.width! <= 800 && metadata.height! <= 800);
  work.photos[0].width = 200; work.photos[0].height = 100;
  room.placements.push({ workId: work.id, wall: 0, x: 0, bottom: 0, rotation: 0 } as never);
  assert.match(exhibitionLayoutSvg(room, [work],{view:"wall:0"}), /rotate\(0\)"><rect x="0" y="0"/);
});
