import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodemailer from "nodemailer";
import { readData, writeData } from "../src/lib/store.ts";
import { readUsers } from "../src/lib/auth.ts";
import { requestSignupCode, confirmSignupEmail, validSignupEmail, SignupVerificationError } from "../src/lib/signupVerification.ts";
import { POST } from "../src/pages/api/auth/signup.ts";
import { verifyPasswordAsync } from "../src/lib/passwords.ts";
import { createReviewSignature, verifyReviewSignature } from "../src/lib/signupReview.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-signup-test-"));
const originalFetch = globalThis.fetch, originalTransport = nodemailer.createTransport;
const originalEnv = { ...process.env };
const password = "Ab1!xyz";
const deliveries = new Map<string, string>();
let cmsCreated = 0, cmsDeleted = 0, reviews = 0;
beforeEach(() => {
  Object.assign(process.env, { DATA_DIR: directory, GMAIL_PASS: "synthetic-no-network", SIGNUP_REVIEW_SECRET: "synthetic-review-secret-at-least-32-characters", SITE_URL: "https://scharade.jp", MICROCMS_SERVICE_DOMAIN: "synthetic", MICROCMS_SERVER_API_KEY: "synthetic-write" });
  writeData("users.json", []); writeData("rate-limit.json", {}); writeData("signup-verifications.json", []);
  deliveries.clear(); cmsCreated = 0; cmsDeleted = 0; reviews = 0;
  nodemailer.createTransport = (() => ({ sendMail: async (message: any) => {
    if (message.to === "contact@scharade.jp") { reviews++; return { accepted: [message.to] }; }
    assert.ok(String(message.to).endsWith("@example.invalid"));
    const code = message.text.match(/確認コード：(\d{6})/)[1]; deliveries.set(message.to, code);
    return { accepted: [message.to] };
  } })) as any;
  globalThis.fetch = (async (input: any, options: any) => {
    assert.equal(new URL(String(input)).hostname, "synthetic.microcms.io");
    assert.equal(options.headers["X-MICROCMS-API-KEY"], "synthetic-write");
    if (options.method === "DELETE") { cmsDeleted++; return Response.json({}); }
    assert.equal(options.method, "POST"); cmsCreated++;
    return Response.json({ id: `synthetic-portfolio-${cmsCreated}` }, { status: 201 });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = originalFetch; nodemailer.createTransport = originalTransport;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv); fs.rmSync(directory, { recursive: true, force: true });
});
const signup = (payload: object) => POST({ request: new Request("https://scharade.jp/api/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) } as any);
const details = (email: string) => ({ name: "架空の申請者", portfolioName: "架空Portfolio", email, password, passwordConfirm: password });
async function challenge(email: string) {
  const verification = await requestSignupCode(email);
  return { ...verification, code: deliveries.get(email)! };
}
function isVerificationError(status: number, restart: boolean) {
  return (error: any) => error instanceof SignupVerificationError && error.status === status && error.restart === restart;
}
test("request responses do not consult accounts or CMS before mailbox ownership and take a uniform minimum time", async () => {
  // Corrupt account data would throw if the public request path consulted it.
  fs.writeFileSync(path.join(directory, "users.json"), "synthetic-invalid-json");
  const started = Date.now();
  const responses = await Promise.all([signup({ action: "request-code", email: "known@example.invalid" }), signup({ action: "request-code", email: "new@example.invalid" })]);
  assert.ok(Date.now() - started >= 570);
  const bodies = await Promise.all(responses.map(response => response.json()));
  for (const [i, response] of responses.entries()) {
    assert.equal(response.status, 200); assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.match(bodies[i].verificationToken, /^[A-Za-z0-9_-]{43}$/); assert.equal(bodies[i].verificationRequired, true);
  }
  assert.deepEqual(Object.keys(bodies[0]).sort(), Object.keys(bodies[1]).sort()); assert.equal(bodies[0].message, bodies[1].message);
  assert.equal(cmsCreated, 0); assert.equal(reviews, 0); assert.equal(deliveries.size, 2);
  const withoutProof = await signup(details("known@example.invalid")); assert.equal(withoutProof.status, 400); assert.equal(cmsCreated, 0);
});
test("confirmation state contains only token/code hashes, is bound to email, and consumes atomically once", async () => {
  const email = "owner@example.invalid", first = await challenge(email);
  const raw = fs.readFileSync(path.join(directory, "signup-verifications.json"), "utf8");
  assert.ok(!raw.includes(first.verificationToken)); assert.ok(!raw.includes(`"${first.code}"`)); assert.ok(!raw.includes(password));
  assert.equal(fs.statSync(path.join(directory, "signup-verifications.json")).mode & 0o777, 0o600);
  await assert.rejects(confirmSignupEmail(first.verificationToken, "other@example.invalid", first.code), isVerificationError(400, false));
  const concurrent = await Promise.allSettled([confirmSignupEmail(first.verificationToken, email.toUpperCase(), first.code), confirmSignupEmail(first.verificationToken, email, first.code)]);
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  await assert.rejects(confirmSignupEmail(first.verificationToken, email, first.code), isVerificationError(410, true));
  assert.deepEqual(readData("signup-verifications.json", []), []);
});
test("codes expire after ten minutes and stop after five wrong attempts", async () => {
  const email = "guess@example.invalid", first = await challenge(email);
  for (let i = 0; i < 4; i++) await assert.rejects(confirmSignupEmail(first.verificationToken, email, "invalid"), isVerificationError(400, false));
  await assert.rejects(confirmSignupEmail(first.verificationToken, email, "invalid"), isVerificationError(410, true));
  await assert.rejects(confirmSignupEmail(first.verificationToken, email, first.code), isVerificationError(410, true));
  const expired = await challenge(email), records = readData<any[]>("signup-verifications.json", []);
  records.forEach(record => { record.expiresAt = Date.now() - 1; }); writeData("signup-verifications.json", records);
  await assert.rejects(confirmSignupEmail(expired.verificationToken, email, expired.code), isVerificationError(410, true));
});
test("requests are limited atomically per email while resend keeps previously delivered challenges valid", async () => {
  const email = "resend@example.invalid";
  const responses = await Promise.all(Array.from({ length: 8 }, () => requestSignupCode(email)));
  const records = readData<any[]>("signup-verifications.json", []); assert.equal(records.length, 5);
  assert.equal(responses.length, 8); responses.forEach(response => assert.match(response.verificationToken, /^[A-Za-z0-9_-]{43}$/));
  writeData("signup-verifications.json", []); writeData("rate-limit.json", {});
  const first = await challenge(email), next = await challenge(email);
  assert.equal(await confirmSignupEmail(first.verificationToken, email, first.code), email);
  assert.equal(await confirmSignupEmail(next.verificationToken, email, next.code), email);
});
test("slow and failed SMTP has the same public response and invalidates only the undelivered challenge", async () => {
  const email = "mail@example.invalid", delivered = await challenge(email);
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const slow = await requestSignupCode(email, async () => { await pending; throw new Error("Synthetic SMTP failure"); });
  assert.equal(readData<any[]>("signup-verifications.json", []).length, 2);
  release(); await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(confirmSignupEmail(slow.verificationToken, email, "123456"), isVerificationError(410, true));
  assert.equal(await confirmSignupEmail(delivered.verificationToken, email, delivered.code), email);
});
test("invalid mailbox addresses and missing configuration cannot create challenges or contact SMTP", async () => {
  for (const email of ["Person <owner@example.invalid>", "a@example.invalid,b@example.invalid", "a@example.invalid\r\nBcc:other@example.invalid", ".a@example.invalid", "a..b@example.invalid", "a@-example.invalid", "a@localhost"]) assert.equal(validSignupEmail(email), false, email);
  for (const key of ["GMAIL_PASS", "SIGNUP_REVIEW_SECRET"]) {
    const previous = process.env[key]; process.env[key] = "";
    assert.equal((await signup({ action: "request-code", email: "known@example.invalid" })).status, 503);
    assert.equal((await signup({ action: "request-code", email: "unknown@example.invalid" })).status, 503);
    process.env[key] = previous;
  }
  assert.equal(deliveries.size, 0); assert.equal(cmsCreated, 0); assert.deepEqual(readData("signup-verifications.json", []), []);
});
test("complete creates one unapproved hashed-password account and requires a fresh code for any replay", async () => {
  const email = "create@example.invalid", confirmation = await challenge(email), payload = { ...details(email), ...confirmation };
  const response = await signup(payload); assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  const users = readUsers(); assert.equal(users.length, 1); assert.equal(users[0].approved, false); assert.equal(users[0].role, "member");
  assert.equal(users[0].portfolioId, "synthetic-portfolio-1"); assert.notEqual(users[0].passwordHash, password); assert.equal(await verifyPasswordAsync(password, users[0].passwordHash!), true);
  assert.equal(cmsCreated, 1); assert.equal(reviews, 1);
  const replay = await signup(payload); assert.equal(replay.status, 410); assert.equal(cmsCreated, 1); assert.equal(readUsers().length, 1);
});
test("signup rejects incomplete password categories before consuming ownership proof or creating a Portfolio", async () => {
  const email = "password-policy@example.invalid", confirmation = await challenge(email);
  for (const value of ["Ab1!xy", "ab1!xyz", "AB1!XYZ", "Abc!xyz", "Ab1wxyz", "Ab1 xyz"]) {
    const response = await signup({ ...details(email), ...confirmation, password: value, passwordConfirm: value });
    assert.equal(response.status, 400); assert.match((await response.json()).message, /7文字以上.*大文字.*小文字.*数字.*記号/);
    assert.equal(cmsCreated, 0); assert.equal(reviews, 0); assert.equal(readUsers().length, 0);
  }
  const response = await signup({ ...details(email), ...confirmation });
  assert.equal(response.status, 200); assert.equal(cmsCreated, 1); assert.equal(readUsers().length, 1);
});
test("only mailbox owners see duplicate-account guidance and concurrent confirmed submissions provision once", async () => {
  const email = "concurrent@example.invalid", first = await challenge(email), second = await challenge(email);
  const responses = await Promise.all([signup({ ...details(email), ...first }), signup({ ...details(email), ...second })]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]); assert.equal(readUsers().length, 1); assert.equal(cmsCreated, 1); assert.equal(cmsDeleted, 0);
  const owner = await challenge(email), exists = await signup({ ...details(email), ...owner });
  assert.equal(exists.status, 409); assert.match((await exists.json()).message, /登録済み/); assert.equal(cmsCreated, 1);
});
test("failed CMS provisioning consumes the code without saving an account or exposing the service error", async () => {
  const email = "cms-fail@example.invalid", confirmation = await challenge(email);
  globalThis.fetch = (async () => Response.json({ error: "synthetic-private-service-detail" }, { status: 500 })) as typeof fetch;
  const response = await signup({ ...details(email), ...confirmation }); assert.equal(response.status, 502);
  const body = await response.json(); assert.equal(body.verificationRequired, true); assert.ok(!JSON.stringify(body).includes("synthetic-private-service-detail"));
  assert.equal(readUsers().length, 0); assert.equal(reviews, 0);
  assert.equal((await signup({ ...details(email), ...confirmation })).status, 410);
});
test("an account write race cleans up only its own newly created unlinked Portfolio", async () => {
  const email = "write-race@example.invalid", confirmation = await challenge(email);
  const normalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, options: any) => {
    const response = await normalFetch(input, options);
    if (options.method === "POST") writeData("users.json", [{ id: "existing", email, portfolioId: "unrelated-portfolio" }]);
    if (options.method === "DELETE") assert.match(String(input), /\/synthetic-portfolio-1$/);
    return response;
  }) as typeof fetch;
  const response = await signup({ ...details(email), ...confirmation }); assert.equal(response.status, 503);
  assert.equal(cmsCreated, 1); assert.equal(cmsDeleted, 1); assert.equal(readUsers()[0].portfolioId, "unrelated-portfolio"); assert.equal(reviews, 0);
});
test("review signatures follow runtime secret rotation and fail closed on weak configuration", () => {
  const input = { action: "approve" as const, expires: new Date(Date.now() + 60_000).toISOString(), userId: "synthetic" };
  const signature = createReviewSignature(input); assert.equal(verifyReviewSignature({ ...input, signature }), true);
  process.env.SIGNUP_REVIEW_SECRET = "new-synthetic-review-secret-at-least-32-characters";
  assert.equal(verifyReviewSignature({ ...input, signature }), false);
  process.env.SIGNUP_REVIEW_SECRET = "weak"; assert.throws(() => createReviewSignature(input));
});
