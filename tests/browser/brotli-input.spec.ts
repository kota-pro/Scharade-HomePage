import { test, expect } from "@playwright/test";
import { brotliCompressSync, gzipSync } from "node:zlib";
import sharp from "sharp";

const origin = "http://127.0.0.1:4329";
// Keep each browser's synthetic traffic out of the shared security-test IP bucket.
const clientHeaders = () => ({ "X-Real-IP": `192.0.2.${100 + test.info().workerIndex}` });
const login = Buffer.from(JSON.stringify({ email: "member@example.invalid", password: "fixture-password-123" }));

test("Brotli JSON and encoding chains receive normal login and member responses", async ({ request }) => {
  for (const [encoding, data] of [
    ["br", brotliCompressSync(login)], ["BR", brotliCompressSync(login)],
    ["gzip, br", brotliCompressSync(gzipSync(login))],
    ["br, gzip", gzipSync(brotliCompressSync(login))], ["identity", login],
  ] as const) {
    const response = await request.post("/api/auth/login", {
      headers: { ...clientHeaders(), Origin: origin, "Content-Encoding": encoding, "Content-Type": "application/json" }, data,
    });
    expect(response.status()).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect((await request.get("/api/member/activities")).status()).toBe(200);
    await request.post("/api/auth/logout", { headers: { Origin: origin } });
  }
});

test("Brotli multipart uploads are decoded for the normal image handler", async ({ request }) => {
  expect((await request.post("/api/auth/login", {
    headers: { ...clientHeaders(), Origin: origin, "Content-Type": "application/json", "Content-Encoding": "br" }, data: brotliCompressSync(login),
  })).status()).toBe(200);
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#888888" } }).png().toBuffer();
  const form = new FormData(); form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "synthetic.png");
  const body = new Request(origin, { method: "POST", body: form });
  const response = await request.post("/api/portfolio/upload", {
    headers: { ...clientHeaders(), Origin: origin, "Content-Type": body.headers.get("content-type")!, "Content-Encoding": "br" },
    data: brotliCompressSync(Buffer.from(await body.arrayBuffer())),
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).ok).toBe(true);
});

test("compressed requests retain authentication, origin, format, and decoded size checks", async ({ request }) => {
  const headers = { ...clientHeaders(), Origin: origin, "Content-Encoding": "br", "Content-Type": "application/json" };
  const protectedResponse = await request.post("/api/member/receipts/upload", { headers, data: brotliCompressSync(Buffer.from("{}")) });
  expect(protectedResponse.status()).toBe(401);
  const crossOrigin = await request.post("/api/auth/login", { headers: { ...headers, Origin: "https://other.invalid" }, data: brotliCompressSync(login) });
  expect(crossOrigin.status()).toBe(403);
  const malformed = await request.post("/api/auth/login", { headers, data: Buffer.from("not compressed") });
  expect(malformed.status()).toBe(400);
  const expanded = await request.post("/api/auth/login", { headers, data: brotliCompressSync(Buffer.alloc(512 * 1024 + 1)) });
  expect(expanded.status()).toBe(413);
  for (const response of [protectedResponse, crossOrigin, malformed, expanded]) {
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }
});
