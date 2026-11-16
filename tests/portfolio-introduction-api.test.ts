import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INTRODUCTION_HTML_PREFIX } from "../src/utils/portfolioIntroduction.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "portfolio-introduction-"));
Object.assign(process.env, { DATA_DIR: directory, NODE_ENV: "test", MICROCMS_SERVICE_DOMAIN: "fixture", MICROCMS_SERVER_API_KEY: "fixture", SITE_URL: "https://scharade.jp" });
const { writeData } = await import("../src/lib/store.ts");
const { createSession } = await import("../src/lib/auth.ts");
const { POST } = await import("../src/pages/api/portfolio/update.ts");
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test("introduction updates sanitize HTML, preserve legacy writes, validate limits and retain ownership checks", async t => {
  writeData("users.json", [{ id: "intro-member", name: "架空会員", email: "intro@example.invalid", approved: true, role: "member", portfolioId: "intro-member", createdAt: new Date().toISOString(), providers: { credentials: true } }]);
  const session = await createSession("intro-member", 3600);
  const writes: Record<string, unknown>[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, options?: RequestInit) => {
    writes.push(JSON.parse(String(options?.body)));
    return Response.json({ id: "intro-member" });
  });
  const update = (payload: unknown, authenticated = true) => POST({ request: new Request("https://scharade.jp/api/portfolio/update", {
    method: "POST", headers: { ...(authenticated ? { Cookie: `__Host-session=${session.token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }) } as any);
  assert.equal((await update({ self_introduction: "<p>紹介</p>", self_introduction_format: "html" }, false)).status, 401);
  assert.equal((await update({ portfolioId: "someone-else", self_introduction: "紹介" })).status, 403);
  assert.equal(writes.length, 0);
  assert.equal((await update({ self_introduction: '<p><strong>太字</strong><img src="https://evil.invalid/x"><script>alert(1)</script><a href="javascript:alert(1)">リンク</a></p>', self_introduction_format: "html" })).status, 200);
  assert.deepEqual(writes.pop(), { self_introduction: INTRODUCTION_HTML_PREFIX + '<p><strong>太字</strong><a>リンク</a></p>' });
  assert.equal((await update({ self_introduction: "<strong>装飾ではなく文字</strong>\n  字下げ" })).status, 200);
  assert.deepEqual(writes.pop(), { self_introduction: "<strong>装飾ではなく文字</strong>\n  字下げ" });
  assert.equal((await update({ self_introduction: "<p><br></p>", self_introduction_format: "html" })).status, 200);
  assert.deepEqual(writes.pop(), { self_introduction: "" });
  assert.equal((await update({ self_introduction: `<p>${"あ".repeat(5000)}</p>`, self_introduction_format: "html" })).status, 200);
  writes.pop();
  for (const payload of [
    { self_introduction: "あ".repeat(5001) },
    { self_introduction: `<p>${"あ".repeat(5001)}</p>`, self_introduction_format: "html" },
    { self_introduction: "<b></b>".repeat(5000), self_introduction_format: "html" },
    { self_introduction: 123, self_introduction_format: "html" },
    { self_introduction: "紹介", self_introduction_format: "markdown" },
  ]) assert.equal((await update(payload)).status, 400);
  assert.equal(writes.length, 0);
});
