import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import sharp from "sharp";
import { PORTFOLIO_PHOTO_SAVE_LIMIT, PORTFOLIO_UPLOAD_LIMIT } from "../src/types/portfolioUpload.ts";

const directory = mkdtempSync(join(tmpdir(), "portfolio-upload-"));
Object.assign(process.env, {
  DATA_DIR: directory, NODE_ENV: "test",
  MICROCMS_SERVICE_DOMAIN: "fixture", MICROCMS_SERVER_API_KEY: "fixture",
});
const { writeData } = await import("../src/lib/store.ts");
const { createSession } = await import("../src/lib/auth.ts");
const { POST } = await import("../src/pages/api/portfolio/upload.ts");
after(() => rmSync(directory, { recursive: true, force: true }));

writeData("users.json", [{
  id: "uploader", name: "架空会員", email: "uploader@example.invalid", approved: true,
  role: "member", providers: { credentials: true }, createdAt: new Date().toISOString(),
}]);
const session = await createSession("uploader", 3600);
const mediaUrl = "https://images.microcms-assets.io/assets/fixture/photo.webp";

function upload(file: File, options: { signal?: AbortSignal; anonymous?: boolean } = {}) {
  const body = new FormData();
  body.set("file", file);
  return POST({ request: new Request("https://scharade.jp/api/portfolio/upload", {
    method: "POST", body, signal: options.signal,
    headers: options.anonymous ? {} : { Cookie: `__Host-session=${session.token}` },
  }) } as Parameters<typeof POST>[0]);
}

test("a detailed photograph fits the media limit and retains its orientation and camera information", async t => {
  const width = 4400, height = 3500;
  const jpeg = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { Model: "Nikon Z5" } })
    .jpeg({ quality: 92 }).toBuffer();
  assert.ok(jpeg.length > PORTFOLIO_PHOTO_SAVE_LIMIT && jpeg.length < PORTFOLIO_UPLOAD_LIMIT);
  const save = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://fixture.microcms-management.io/api/v1/media");
    assert.equal(options.method, "POST");
    const image = (options.body as FormData).get("file") as File;
    assert.equal(image.name, "sample.webp");
    assert.equal(image.type, "image/webp");
    assert.ok(image.size <= PORTFOLIO_PHOTO_SAVE_LIMIT);
    const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok(metadata.width > 2000);
    assert.ok(Math.abs(metadata.width / metadata.height - height / width) < 0.002);
    return Response.json({ url: mediaUrl }, { status: 201 });
  });
  const response = await upload(new File([new Uint8Array(jpeg)], "sample.jpg", { type: "image/jpeg" }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, mediaUrl);
  assert.equal(result.photoMetadata.camera, "Nikon Z5");
  assert.equal(save.mock.callCount(), 1);
});

test("only a request that reaches the media store can have an unknown save result", async t => {
  const png = await sharp({ create: { width: 32, height: 16, channels: 4, background: "#0055cc40" } }).png().toBuffer();
  const file = new File([new Uint8Array(png)], "transparent.png", { type: "image/png" });
  const save = t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => {
    const image = (options.body as FormData).get("file") as File;
    const result = await sharp(Buffer.from(await image.arrayBuffer())).ensureAlpha().raw().toBuffer();
    assert.equal(result[3], 0x40);
    return Response.json({}, { status: 201 });
  });
  assert.equal((await upload(file, { anonymous: true })).status, 401);
  assert.equal((await upload(new File(["invalid"], "invalid.png", { type: "image/png" }))).status, 400);
  const expired = await upload(file, { signal: AbortSignal.abort() });
  assert.equal(expired.status, 408);
  assert.match((await expired.json()).message, /まだ保存していません/);
  assert.equal(save.mock.callCount(), 0);

  const unknown = await upload(file);
  assert.equal(unknown.status, 502);
  assert.equal((await unknown.json()).errorCode, "SITE-009");
  assert.equal(save.mock.callCount(), 1);
});
