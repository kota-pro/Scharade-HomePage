import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writeData } from "../src/lib/store.ts";
import { exhibitionAction, readExhibitions, updateExhibitionStore } from "../src/lib/exhibitions.ts";
import { archiveExhibitionOutput, deliverExhibitionDriveFile, drainExhibitionDriveFiles, ensureExhibitionDriveFolders } from "../src/lib/exhibitionDrive.ts";
import { createExhibitionGoogleForm } from "../src/lib/exhibitionIntegrations.ts";

test("cached exhibitions migrate to the year-suffixed hierarchy even without pending uploads, then reuse their folder IDs", async () => {
  const previous = process.env.DATA_DIR, previousUrl = process.env.EXHIBITION_DRIVE_GAS_URL, previousSecret = process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET, originalFetch = globalThis.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-year-folder-")); process.env.DATA_DIR = dir;
  process.env.EXHIBITION_DRIVE_GAS_URL = "https://script.google.com/macros/s/drivefixture/exec"; process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = "d".repeat(64);
  try {
    writeData("users.json", [{ id: "staff", name: "運営", email: "staff@example.invalid", role: "staff", approved: true }]);
    const e = (await exhibitionAction("staff", { action: "create", title: "秋季写真展" })).exhibition;
    const folders = { folderId: "exhibition_folder_123", originalsId: "originals_folder_123", layoutsId: "layouts_folder_123", outputsId: "outputs_folder_123", title: e.title, year: 2026 };
    await updateExhibitionStore(store => { store.exhibitions[0].year = 2026; store.exhibitions[0].driveFolders = folders; });
    let currentGateway = false;
    const years: number[] = [];
    globalThis.fetch = async (_, init) => {
      const p = JSON.parse(JSON.parse(String(init?.body)).payload);
      assert.equal(p.action, "folders.ensure"); years.push(p.year);
      return Response.json({ ok: true, owner: "sharadeshashinten@gmail.com", ...folders, ...(currentGateway ? { yearFolderName: `${p.year}年` } : {}) });
    };
    await assert.rejects(ensureExhibitionDriveFolders(e.id), /drive-folders-response/);
    assert.deepEqual(readExhibitions().exhibitions[0].driveFolders, folders);
    currentGateway = true;
    assert.deepEqual(await drainExhibitionDriveFiles(), { attempted: 0, delivered: 0 });
    assert.deepEqual(readExhibitions().exhibitions[0].driveFolders, { ...folders, yearFolderName: "2026年" });
    await ensureExhibitionDriveFolders(e.id); await drainExhibitionDriveFiles();
    assert.deepEqual(years, [2026, 2026]);
    await updateExhibitionStore(store => { store.exhibitions[0].year = 2027; });
    await drainExhibitionDriveFiles();
    assert.deepEqual(readExhibitions().exhibitions[0].driveFolders, { ...folders, year: 2027, yearFolderName: "2027年" });
    assert.deepEqual(years, [2026, 2026, 2027]);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    if (previousUrl === undefined) delete process.env.EXHIBITION_DRIVE_GAS_URL; else process.env.EXHIBITION_DRIVE_GAS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET; else process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = previousSecret;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("20 MB Drive delivery resumes after an acknowledged chunk is interrupted and never creates a second file", async () => {
  const previous = process.env.DATA_DIR, previousUrl = process.env.EXHIBITION_DRIVE_GAS_URL, previousSecret = process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET, originalFetch = globalThis.fetch;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-drive-")); process.env.DATA_DIR = dir;
  process.env.EXHIBITION_DRIVE_GAS_URL = "https://script.google.com/macros/s/drivefixture/exec"; process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = "d".repeat(64);
  let uploaded = 0, created = 0, interrupted = false; const requests: any[] = [];
  try {
    writeData("users.json", [{ id: "staff", name: "運営", email: "staff@example.invalid", role: "staff", approved: true }]);
    const e = (await exhibitionAction("staff", { action: "create", title: "秋季写真展「光」" })).exhibition;
    const bytes = crypto.randomBytes(20 * 1024 * 1024), output = await archiveExhibitionOutput(e.id, "layout-pdf", "配置.pdf", "application/pdf", bytes);
    assert.equal((await archiveExhibitionOutput(e.id, "layout-pdf", "配置.pdf", "application/pdf", bytes)).id, output.id);
    globalThis.fetch = async (_url, init) => {
      const envelope = JSON.parse(String(init?.body));
      assert.equal(envelope.signature, crypto.createHmac("sha256", "d".repeat(64)).update(`v2\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.payload}`).digest("hex"));
      assert.ok(Buffer.byteLength(String(init?.body)) < 2 * 1024 * 1024);
      const p = JSON.parse(envelope.payload); requests.push(p);
      if (p.action === "folders.ensure") return Response.json({ ok: true, owner: "sharadeshashinten@gmail.com", folderId: "exhibition_folder_123", originalsId: "originals_folder_123", layoutsId: "layouts_folder_123", outputsId: "outputs_folder_123", yearFolderName: `${p.year}年` });
      if (p.action === "file.begin") { if (!uploaded) created++; return Response.json({ ok: true, done: false, offset: uploaded }); }
      if (p.action === "file.chunk") {
        assert.equal(p.offset, uploaded); const chunk = Buffer.from(p.data, "base64");
        assert.deepEqual(chunk, bytes.subarray(uploaded, uploaded + chunk.length)); uploaded += chunk.length;
        if (uploaded === 2 * 1024 * 1024 && !interrupted) { interrupted = true; throw new Error("network-interrupted"); }
        return Response.json(uploaded === bytes.length ? { ok: true, done: true, owner: "sharadeshashinten@gmail.com", fileId: "uploaded_file_123", url: "https://drive.google.com/file/d/uploaded_file_123/view" } : { ok: true, done: false, offset: uploaded });
      }
      throw new Error("unexpected-action");
    };
    assert.equal(await deliverExhibitionDriveFile("output", output.id), false);
    assert.equal(readExhibitions().outputs![0].drive.status, "pending");
    await updateExhibitionStore(store => { store.outputs![0].drive.nextAttemptAt = 0; });
    assert.equal(await deliverExhibitionDriveFile("output", output.id), true);
    assert.equal(uploaded, bytes.length); assert.equal(created, 1);
    assert.equal(readExhibitions().outputs![0].drive.status, "delivered");
    const count = requests.length;
    assert.equal(await deliverExhibitionDriveFile("output", output.id), true);
    assert.equal(requests.length, count);
    assert.equal(requests[0].year, new Date(Date.now() + 9 * 3600000).getUTCFullYear());
    assert.equal(requests[0].exhibitionTitle, "秋季写真展「光」");
    assert.equal((await drainExhibitionDriveFiles()).attempted, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    if (previousUrl === undefined) delete process.env.EXHIBITION_DRIVE_GAS_URL; else process.env.EXHIBITION_DRIVE_GAS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET; else process.env.EXHIBITION_DRIVE_WEBHOOK_SECRET = previousSecret;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("an existing form retains its legacy connection when new-file storage is unavailable", async () => {
  const previous = process.env.DATA_DIR, dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-legacy-")); process.env.DATA_DIR = dir;
  try {
    writeData("users.json", [{ id: "staff", name: "運営", email: "staff@example.invalid", role: "staff", approved: true }]);
    const e = (await exhibitionAction("staff", { action: "create", title: "旧写真展" })).exhibition;
    const old = { schemaVersion: 1, formId: "old_form_123", spreadsheetId: "old_sheet_123", itemIds: {} };
    await updateExhibitionStore(store => { store.exhibitions[0].googleForms.push(old); });
    await assert.rejects(()=>createExhibitionGoogleForm(e.id), /configuration/);
    assert.deepEqual(readExhibitions().exhibitions[0].googleForms[0], old);
    assert.equal(readExhibitions().exhibitions[0].googleSync?.pending,true);
    assert.equal(readExhibitions().exhibitions[0].googleForms.length, 1);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); }
});
