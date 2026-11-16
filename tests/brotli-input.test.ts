import { test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, gzipSync, deflateSync } from "node:zlib";
import { boundedFormData, decodeRequestBody, HttpInputError } from "../src/lib/http.ts";

const input = Buffer.from(JSON.stringify({ message: "圧縮された通常の入力" }));
function request(body: Uint8Array, encoding: string) {
  return new Request("https://example.invalid/api/test", {
    method: "POST", headers: {
      "Content-Type": "application/json", "Content-Encoding": encoding,
      "Content-Length": String(body.byteLength), "Cookie": "session=synthetic",
      "Origin": "https://example.invalid",
    }, body: new Uint8Array(body),
  });
}

test("compressed API input is decoded in reverse encoding order and preserves request metadata", async () => {
  for (const [encoding, compressed] of [
    ["br", brotliCompressSync(input)], ["BR", brotliCompressSync(input)],
    ["gzip, Br", brotliCompressSync(gzipSync(input))],
    ["br, gzip", gzipSync(brotliCompressSync(input))],
    ["deflate, br", brotliCompressSync(deflateSync(input))],
    ["identity, br", brotliCompressSync(input)],
  ] as const) {
    const original = request(compressed, encoding), decoded = await decodeRequestBody(original, 1024);
    assert.equal(decoded.url, original.url); assert.equal(decoded.method, "POST");
    assert.equal(decoded.headers.get("cookie"), "session=synthetic");
    assert.equal(decoded.headers.get("origin"), "https://example.invalid");
    assert.equal(decoded.headers.get("content-encoding"), null);
    assert.equal(decoded.headers.get("content-length"), String(input.length));
    assert.deepEqual(await decoded.json(), JSON.parse(input.toString()));
  }
});

test("uncompressed API input is left untouched", async () => {
  for (const encoding of ["", "identity"]) {
    const original = request(input, encoding);
    assert.equal(await decodeRequestBody(original, 1024), original);
    assert.deepEqual(await original.json(), JSON.parse(input.toString()));
  }
});

test("decoded Brotli multipart remains readable by the bounded upload parser", async () => {
  const form = new FormData(); form.set("file", new Blob([input]), "synthetic.txt");
  const original = new Request("https://example.invalid/api/test/upload", { method: "POST", body: form });
  const headers = new Headers(original.headers); headers.set("Content-Encoding", "br");
  const compressed = new Request(original.url, { method: "POST", headers, body: new Uint8Array(brotliCompressSync(Buffer.from(await original.arrayBuffer()))) });
  const decoded = await decodeRequestBody(compressed, 1024);
  const parsed = await boundedFormData(decoded, 1024);
  assert.equal(await (parsed.get("file") as File).text(), input.toString());
});

test("malformed, unsupported, or oversized compressed input returns a controlled input error", async () => {
  const status = (expected: number) => (error: unknown) => error instanceof HttpInputError && error.status === expected;
  await assert.rejects(decodeRequestBody(request(Buffer.from("not compressed"), "br"), 1024), status(400));
  const truncated = brotliCompressSync(input).subarray(0, 3);
  await assert.rejects(decodeRequestBody(request(truncated, "br"), 1024), status(400));
  await assert.rejects(decodeRequestBody(request(input, "unknown, br"), 1024), status(415));
  await assert.rejects(decodeRequestBody(request(input, "br, br, br, br"), 1024), status(415));
  await assert.rejects(decodeRequestBody(request(brotliCompressSync(Buffer.alloc(2048)), "br"), 1024), status(413));
  await assert.rejects(decodeRequestBody(request(gzipSync(Buffer.alloc(2048)), "gzip, br"), 1024), status(400));
  await assert.rejects(decodeRequestBody(request(brotliCompressSync(gzipSync(Buffer.alloc(2048))), "gzip, br"), 1024), status(413));
  await assert.rejects(decodeRequestBody(request(Buffer.alloc(1025), "br"), 1024), status(413));
});
