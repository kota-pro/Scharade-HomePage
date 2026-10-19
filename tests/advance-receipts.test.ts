import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { inspectReceipt, receiptFormData, uploadAdvanceReceipt, MAX_RECEIPT_BYTES } from "../src/lib/advanceReceipts.ts";
import type { User } from "../src/lib/auth.ts";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const user: User = { id: "member", name: "会員", email: "member@example.invalid", approved: true, createdAt: "2026-01-01", providers: {} };

test("receipt inspection accepts PDF and decoded images, ignores spoofed MIME and rejects unsafe/oversized input", async () => {
  const parsed = await inspectReceipt(new File([pdf], "領収書.pdf", { type: "text/html" }));
  assert.equal(parsed.mimeType, "application/pdf");
  const png = await sharp({ create: { width: 3, height: 3, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await inspectReceipt(new File([new Uint8Array(png)], "../receipt.txt"))).mimeType, "image/png");
  assert.equal((await inspectReceipt(new File([new Uint8Array(png)], "../receipt.txt"))).name, ".._receipt.png");
  await assert.rejects(() => inspectReceipt(new File(["<svg onload='alert(1)'></svg>"], "fake.png", { type: "image/png" })));
  await assert.rejects(() => inspectReceipt(new File([Buffer.alloc(MAX_RECEIPT_BYTES + 1)], "big.pdf")), /10MB/);
  await assert.rejects(() => inspectReceipt(new File([], "empty.pdf")), /空でない/);
});

test("multipart parser enforces the actual byte limit without trusting a missing or forged Content-Length", async () => {
  const make = (headers: Record<string,string>) => new Request("https://example.invalid/upload", { method: "POST", headers,
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_RECEIPT_BYTES + 65537)); controller.close(); } }), duplex: "half" } as RequestInit);
  for (const extra of [{}, { "content-length": "1" }] as Record<string,string>[]) {
    await assert.rejects(() => receiptFormData(make({ "content-type": "multipart/form-data; boundary=test", ...extra })), /10MB/);
  }
  const form = new FormData(); form.set("file", new File([pdf], "receipt.pdf")); form.set("uploadKey", crypto.randomUUID());
  assert.equal((await receiptFormData(new Request("https://example.invalid/upload", { method: "POST", body: form }))).get("file") instanceof File, true);
});

test("private staging, reserved Drive IDs and owner-scoped retries recover uploads without duplicate files", async () => {
  const previous = { dir: process.env.DATA_DIR, url: process.env.ACCOUNTING_GAS_URL, secret: process.env.ACCOUNTING_WEBHOOK_SECRET, fetch: globalThis.fetch };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-test-"));
  process.env.DATA_DIR = dir; process.env.ACCOUNTING_GAS_URL = "https://script.google.com/macros/s/test/exec"; process.env.ACCOUNTING_WEBHOOK_SECRET = "x".repeat(40);
  let generated = 0, uploads = 0;
  const drive = new Map<string,string>();
  globalThis.fetch = async (_url, options) => {
    const envelope = JSON.parse(String(options?.body));
    assert.equal(envelope.signature, crypto.createHmac("sha256", "x".repeat(40)).update(`v2\n${envelope.timestamp}\n${envelope.nonce}\n${envelope.payload}`).digest("hex"));
    const p = JSON.parse(envelope.payload);
    if (p.action === "receipt.prepare") return Response.json({ ok: true, receiptId: p.receiptId, driveFileId: `fixtureDriveId${++generated}` });
    uploads++;
    assert.equal(crypto.createHash("sha256").update(Buffer.from(p.data, "base64")).digest("hex"), p.sha256);
    drive.set(p.driveFileId, p.sha256);
    if (uploads === 1) throw new Error("Drive saved it but the response was lost");
    return Response.json({ ok: true, receiptId: p.receiptId, url: `https://drive.google.com/file/d/${p.driveFileId}/view` });
  };
  try {
    const key = crypto.randomUUID();
    await assert.rejects(() => uploadAdvanceReceipt(user, key, new File([pdf], "receipt.pdf")), /保存結果/);
    const staged = fs.readdirSync(dir).filter(name => name.endsWith(".bin"));
    assert.equal(staged.length, 1); assert.equal(fs.statSync(path.join(dir, staged[0])).mode & 0o777, 0o600);
    await assert.rejects(() => uploadAdvanceReceipt({ ...user, id: "other" }, key), /もう一度選んで/);
    const [one, two] = await Promise.all([uploadAdvanceReceipt(user, key), uploadAdvanceReceipt(user, key)]);
    assert.deepEqual(one, two); assert.equal(generated, 1); assert.equal(drive.size, 1); assert.equal(uploads, 2);
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith(".bin")), false);
    await assert.rejects(() => uploadAdvanceReceipt(user, key, new File([Buffer.concat([pdf.subarray(0,-6), Buffer.from("\nchanged\n%%EOF")])], "changed.pdf")), /前回と異なる/);
    await assert.rejects(() => uploadAdvanceReceipt(user, "../../escape"), /選び直して/);
    await assert.rejects(() => uploadAdvanceReceipt({ ...user, approved: false }, key), /ログイン/);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of Object.entries({ DATA_DIR: previous.dir, ACCOUNTING_GAS_URL: previous.url, ACCOUNTING_WEBHOOK_SECRET: previous.secret })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
