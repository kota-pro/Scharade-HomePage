import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { writeData } from "../src/lib/store.ts";
import { createSession, getUserFromSession, getUserFromRequest, readSessions, readUsers } from "../src/lib/auth.ts";
import type { User } from "../src/lib/auth.ts";
import { hashPassword, hashPasswordAsync, verifyPasswordAsync, validNewPassword, needsPasswordRehash } from "../src/lib/passwords.ts";
import { startMfaChallenge, resendMfaEmail, completeMfaChallenge, mfaChallengeView } from "../src/lib/mfa.ts";
import { readMfaState, emptyMfaState, securityHash } from "../src/lib/mfaState.ts";
import { boundedBody, HttpInputError } from "../src/lib/http.ts";
import { imageSignature, withImageSlot, ImageBusyError } from "../src/lib/imageSecurity.ts";
import { sanitizeArticleHtml, safeMediaUrl, safeExternalUrl } from "../src/lib/contentSecurity.ts";
import { securityResponse } from "../src/lib/security.ts";
import { checkLoginAttempts, recordLoginAttempt, checkReauthentication } from "../src/lib/rateLimit.ts";
import { createPasswordResetToken, resetPassword } from "../src/lib/passwordReset.ts";
import { cookieOptions, sessionCookieName } from "../src/lib/sessionCookies.ts";
import { POST as requestReset } from "../src/pages/api/auth/password-reset/request.ts";
import { readData } from "../src/lib/store.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-security-test-"));
const password = "Synthetic-password-long-123!", passwordHash = hashPassword(password);
const member = { id: "member", name: "試験会員", email: "member@example.invalid", approved: true, role: "member" as const, passwordHash, providers: { credentials: true as const }, createdAt: new Date().toISOString() };
const staff = { ...member, id: "staff", role: "staff" as const, email: "staff@example.invalid" };
beforeEach(() => {
  process.env.DATA_DIR = directory; process.env.MFA_ENCRYPTION_KEY = "cd".repeat(32); process.env.TRUST_PROXY = "0";
  writeData("users.json", [member, staff]); writeData("sessions.json", []); writeData("rate-limit.json", {});
  writeData("auth-security.json", emptyMfaState());
  writeData("mfa-trusted-browsers.json", []);
  writeData("password-reset-tokens.json", []);
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function emailChallenge(user: User = staff, returnPath = "/Member/manage", maxAge = 86400) {
  let emailCode = "", recipient = "";
  const challenge = await startMfaChallenge(user, returnPath, maxAge, async (email, code) => { emailCode = code; recipient = email; });
  assert.equal(recipient, user.email); assert.match(emailCode, /^\d{6}$/);
  return { challenge, emailCode };
}
test("strong asynchronous scrypt verifies legacy hashes and rejects invalid lengths/parameters", async () => {
  const salt = crypto.randomBytes(16), legacy = `scrypt$${salt.toString("base64")}$${crypto.scryptSync(password, salt, 32).toString("base64")}`;
  assert.equal(await verifyPasswordAsync(password, legacy), true); assert.equal(needsPasswordRehash(legacy), true);
  const modern = await hashPasswordAsync(password);
  assert.equal(await verifyPasswordAsync(password, modern), true); assert.equal(await verifyPasswordAsync("wrong", modern), false);
  assert.equal(needsPasswordRehash(modern), false);
  assert.equal(await verifyPasswordAsync(password, modern.replace("32768", "9999999999")), false);
});
test("new passwords accept seven characters with every required category and reject missing categories or length overflow", () => {
  for (const value of ["Ab1!xyz", "Ab1!あいう", "Ab1。あいう", "Ab1!😀xy", "Aa1!" + "x".repeat(1020)]) {
    assert.equal(validNewPassword(value), true, value.slice(0, 30));
  }
  for (const value of ["", "Ab1!xy", "ab1!xyz", "AB1!XYZ", "Abc!xyz", "Ab1wxyz", "Ab1 xyz", "Ab1あいうえ", "Ab１!xyz", "Ab1!😀x", "Aa1!" + "x".repeat(1021)]) {
    assert.equal(validNewPassword(value), false, value.slice(0, 30));
  }
});
test("staff and admin require fresh email proof and a single-use account-bound grant; members keep ordinary login", async () => {
  await assert.rejects(createSession(staff.id, 300));
  const { challenge, emailCode } = await emailChallenge();
  assert.equal(mfaChallengeView(challenge.token).method, "email");
  assert.notEqual(mfaChallengeView(challenge.token).email, staff.email);
  const stored = JSON.stringify(readMfaState());
  assert.ok(!stored.includes(emailCode)); assert.ok(!stored.includes(challenge.token)); assert.ok(!stored.includes(staff.email));
  const result = await completeMfaChallenge(challenge.token, emailCode);
  const ordinary = await createSession(member.id, 300, undefined, undefined, result.grant);
  assert.equal(getUserFromSession(ordinary.token).user?.id, member.id); assert.equal(ordinary.mfaMethod, undefined);
  const admin = { ...staff, id: "admin", role: "admin" as const, email: "admin@example.invalid" };
  writeData("users.json", [member, staff, admin]);
  await assert.rejects(createSession(admin.id, 300, undefined, undefined, result.grant));
  const session = await createSession(staff.id, 86400, staff.passwordHash, staff.email, result.grant);
  assert.equal(session.mfaMethod, "email");
  assert.equal(Date.parse(session.expiresAt) - Date.parse(session.createdAt), 86400_000);
  await assert.rejects(createSession(staff.id, 300, undefined, undefined, result.grant));
  assert.throws(() => mfaChallengeView(challenge.token));
  assert.ok(!JSON.stringify(readSessions()).includes(session.token));
  assert.equal(getUserFromSession(session.id).user, null);
  assert.equal(getUserFromSession(session.token).user?.id, staff.id);
  assert.equal(getUserFromRequest(new Request("https://scharade.jp/Member", { headers: { Cookie: `session=${session.token}` } })).user, null);
  assert.equal(getUserFromRequest(new Request("https://scharade.jp/Member", { headers: { Cookie: `__Host-session=${session.token}` } })).user?.id, staff.id);
  const sessions = readSessions(); delete sessions.find(s => s.userId === staff.id)!.mfaMethod; writeData("sessions.json", sessions);
  assert.equal(getUserFromSession(session.token).user, null); assert.equal(getUserFromSession(ordinary.token).user?.id, member.id);
  const adminProof = await emailChallenge(admin);
  const completed = await completeMfaChallenge(adminProof.challenge.token, adminProof.emailCode);
  const adminSession = await createSession(admin.id, 300, admin.passwordHash, admin.email, completed.grant);
  assert.equal(getUserFromSession(adminSession.token).user?.role, "admin");
  const idle = readSessions(); idle.find(s => s.userId === admin.id)!.lastSeenAt = new Date(Date.now() - 31 * 60_000).toISOString(); writeData("sessions.json", idle);
  assert.equal(getUserFromSession(adminSession.token).user?.role, "admin");
  idle.find(s => s.userId === admin.id)!.lastSeenAt = new Date(Date.now() - 7 * 86400_000).toISOString(); writeData("sessions.json", idle);
  assert.equal(getUserFromSession(adminSession.token).user, null);
});
test("each privileged login sends a fresh email; code and grant replay fail", async () => {
  const first = await emailChallenge();
  const results = await Promise.allSettled([completeMfaChallenge(first.challenge.token, first.emailCode), completeMfaChallenge(first.challenge.token, first.emailCode)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const next = await emailChallenge();
  assert.notEqual(next.challenge.token, first.challenge.token);
  assert.throws(() => mfaChallengeView(first.challenge.token));
  await completeMfaChallenge(next.challenge.token, next.emailCode);
  await assert.rejects(completeMfaChallenge(next.challenge.token, next.emailCode));
});
test("completing previously stored email proof revalidates its return path", async () => {
  const { challenge, emailCode } = await emailChallenge();
  const state = readMfaState();
  state.challenges[securityHash(challenge.token)].returnPath = "/\t/example.invalid/";
  writeData("auth-security.json", state);
  const completed = await completeMfaChallenge(challenge.token, emailCode);
  assert.equal(completed.next, "/");
  const session = await createSession(staff.id, 300, staff.passwordHash, staff.email, completed.grant);
  assert.equal(getUserFromSession(session.token).user?.id, staff.id);
});
test("resending replaces the code without extending expiry or resetting the account guess budget", async () => {
  const { challenge, emailCode } = await emailChallenge();
  await assert.rejects(resendMfaEmail(challenge.token, async () => {}), (error: any) => error.status === 429);
  await assert.rejects(completeMfaChallenge(challenge.token, "bad"));
  const now = Date.now, clock = now(); Date.now = () => clock + 61_000;
  try {
    let replacement = "";
    const view = await resendMfaEmail(challenge.token, async (email, code) => { assert.equal(email, staff.email); replacement = code; });
    assert.notEqual(replacement, emailCode); assert.equal(view.expiresAt, challenge.expiresAt);
    assert.equal(Object.values(readMfaState().challenges)[0].attempts, 1);
    await assert.rejects(completeMfaChallenge(challenge.token, emailCode));
    await assert.rejects(completeMfaChallenge(challenge.token, "bad"));
    await assert.rejects(completeMfaChallenge(challenge.token, "bad"));
    await assert.rejects(completeMfaChallenge(challenge.token, "bad"));
    assert.throws(() => mfaChallengeView(challenge.token));
    await assert.rejects(startMfaChallenge(staff, "/", 300, async () => {}), (error: any) => error.status === 429);
    Date.now = () => clock + 16 * 60_000;
    const afterLockout = await emailChallenge(); await completeMfaChallenge(afterLockout.challenge.token, afterLockout.emailCode);
  } finally { Date.now = now; }
});
test("concurrent email starts reserve just one send; five sends per account window is enforced", async () => {
  let sent = 0;
  const starts = await Promise.allSettled(Array.from({ length: 12 }, () => startMfaChallenge(staff, "/", 300, async () => { sent++; })));
  assert.equal(sent, 1); assert.equal(starts.filter(result => result.status === "fulfilled").length, 1);
  const challenge = (starts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<any>).value;
  const now = Date.now, clock = now();
  try {
    for (let index = 1; index <= 4; index++) { Date.now = () => clock + index * 61_000; await resendMfaEmail(challenge.token, async () => { sent++; }); }
    Date.now = () => clock + 5 * 61_000;
    await assert.rejects(resendMfaEmail(challenge.token, async () => { sent++; }), (error: any) => error.status === 429);
    assert.equal(sent, 5);
  } finally { Date.now = now; }
});
test("expiry and account email, password, approval, role and version changes invalidate pending proof and grants", async () => {
  for (const change of [{ email: "changed@example.invalid" }, { passwordHash: "changed" }, { authVersion: 1 }, { approved: false }, { role: "member" }]) {
    writeData("users.json", [member, staff]); writeData("auth-security.json", emptyMfaState());
    const { challenge, emailCode } = await emailChallenge();
    writeData("users.json", [member, { ...staff, ...change }]);
    await assert.rejects(completeMfaChallenge(challenge.token, emailCode));
  }
  writeData("users.json", [member, staff]); writeData("auth-security.json", emptyMfaState());
  const expired = await emailChallenge(); const state = readMfaState(); Object.values(state.challenges)[0].expiresAt = Date.now() - 1; writeData("auth-security.json", state);
  await assert.rejects(completeMfaChallenge(expired.challenge.token, expired.emailCode));
  writeData("auth-security.json", emptyMfaState());
  const valid = await emailChallenge(); const completed = await completeMfaChallenge(valid.challenge.token, valid.emailCode);
  writeData("users.json", [member, { ...staff, email: "changed@example.invalid" }]);
  await assert.rejects(createSession(staff.id, 300, undefined, undefined, completed.grant));
});
test("SMTP failure and pending delivery cannot authorize login; legacy TOTP state is never accepted", async () => {
  const initial = await emailChallenge();
  let heldCode = "", release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const now = Date.now, clock = now(); Date.now = () => clock + 61_000;
  try {
    const pending = resendMfaEmail(initial.challenge.token, async (_email, code) => { heldCode = code; await held; });
    while (!heldCode) await new Promise(resolve => setImmediate(resolve));
    assert.equal(Object.values(readMfaState().challenges)[0].delivered, false);
    await assert.rejects(completeMfaChallenge(initial.challenge.token, heldCode), (error: any) => error.status === 503);
    release(); await pending;
    const result = await completeMfaChallenge(initial.challenge.token, heldCode);
    await createSession(staff.id, 300, staff.passwordHash, staff.email, result.grant);
  } finally { Date.now = now; }
  await assert.rejects(startMfaChallenge(staff, "/", 300, async () => { throw new Error("Synthetic SMTP failure"); }), (error: any) => error.status === 503);
  assert.equal(Object.keys(readMfaState().challenges).length, 0);
  const legacyToken = "a".repeat(43);
  writeData("auth-security.json", { version: 1, accounts: { staff: { secret: "legacy", recoveryHashes: ["old"] } }, challenges: { [securityHash(legacyToken)]: { stage: "verify" } }, grants: { [securityHash(legacyToken)]: { userId: staff.id, authVersion: 0, expiresAt: Date.now() + 60000 } } });
  assert.deepEqual(readMfaState(), emptyMfaState());
  await assert.rejects(createSession(staff.id, 300, undefined, undefined, legacyToken));
  assert.throws(() => mfaChallengeView(legacyToken));
  await assert.rejects(startMfaChallenge(member, "/", 300, async () => {}));
});
test("historically exposed passwords cannot be reused and all old session formats are rejected", async () => {
  writeData("users.json", [{ ...member, mustResetPassword: true }, staff]);
  writeData("sessions.json", [{ id: "legacy-token", userId: member.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }]);
  assert.equal(getUserFromSession("legacy-token").user, null); await assert.rejects(createSession(member.id, 300));
  const token = await createPasswordResetToken(member.id);
  assert.equal(await resetPassword(token, "Ab1!xy"), false);
  assert.equal(await resetPassword(token, "Ab1wxyz"), false);
  assert.equal(await resetPassword(token, password), false);
  assert.equal(await resetPassword(token, "New-synthetic-password-456!"), true);
  assert.equal(readUsers()[0].mustResetPassword, undefined); assert.equal(readSessions().length, 0);
});
test("reset requests conceal membership even when SMTP fails or is slow, and revoke undelivered tokens", async () => {
  const previousPass = process.env.GMAIL_PASS, previousTransport = nodemailer.createTransport;
  const request = (email: string) => requestReset({ request: new Request("https://scharade.jp/api/auth/password-reset/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }) } as any);
  try {
    delete process.env.GMAIL_PASS;
    assert.equal((await request(member.email)).status, 503);
    assert.equal((await request("unknown@example.invalid")).status, 503);
    process.env.GMAIL_PASS = "synthetic-no-network";
    let release!: () => void, delivered = false;
    const pending = new Promise<void>(resolve => { release = resolve; });
    nodemailer.createTransport = (() => ({ sendMail: async () => { await pending; delivered = true; throw new Error("Synthetic SMTP failure"); } })) as any;
    const started = Date.now(); const known = await request(member.email);
    assert.ok(Date.now() - started >= 500); assert.equal(delivered, false);
    const unknown = await request("unknown@example.invalid");
    assert.equal(known.status, 200); assert.equal(await known.text(), await unknown.text());
    assert.equal(readData<any[]>("password-reset-tokens.json", []).length, 1);
    release(); await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(readData<any[]>("password-reset-tokens.json", []).length, 0);
  } finally {
    nodemailer.createTransport = previousTransport;
    if (previousPass === undefined) delete process.env.GMAIL_PASS; else process.env.GMAIL_PASS = previousPass;
  }
});
test("account and IP attempt reservations are atomic; untrusted forwarded IPs cannot evade limits", async () => {
  const context = { request: new Request("https://scharade.jp/api/auth/login", { headers: { "X-Real-IP": "203.0.113.1" } }), clientAddress: "192.0.2.1" } as any;
  const attempts = await Promise.all(Array.from({ length: 15 }, () => checkLoginAttempts(context, member.email)));
  assert.equal(attempts.filter(Boolean).length, 5);
  await recordLoginAttempt(context, member.email, true);
  assert.equal(await checkLoginAttempts(context, member.email), true);
  for (let i = 0; i < 14; i++) assert.equal(await checkLoginAttempts(context, `different-${i}@example.invalid`), true);
  context.request = new Request(context.request.url, { headers: { "X-Real-IP": "203.0.113.99" } });
  assert.equal(await checkLoginAttempts(context, "fresh@example.invalid"), false);
  for (let i = 0; i < 5; i++) assert.equal(await checkReauthentication(staff.id), true);
  assert.equal(await checkReauthentication(staff.id), false);
});
test("stream size limits reject chunked and forged length bodies before parsing", async () => {
  for (const headers of [{}, { "Content-Length": "1" }]) {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(9)); controller.enqueue(new Uint8Array(9)); controller.close(); } });
    const request = new Request("http://localhost/api/test", { method: "POST", headers, body, duplex: "half" } as any);
    await assert.rejects(boundedBody(request, 16), (error: any) => error instanceof HttpInputError && error.status === 413);
  }
});
test("native image decoding admits only approved signatures and caps concurrent work/queue length", async () => {
  assert.equal(imageSignature(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(imageSignature(Buffer.from("GIF89a")), null);
  assert.equal(imageSignature(Buffer.from([255, 216, 255, 224])), "jpeg");
  assert.equal(imageSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "png");
  let count = 0, maximum = 0; const releases: Array<() => void> = [];
  const work = () => withImageSlot(async () => { count++; maximum = Math.max(maximum, count); await new Promise<void>(resolve => releases.push(resolve)); count--; });
  const jobs = Array.from({ length: 6 }, work); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(work(), ImageBusyError);
  for (let i = 0; i < 3; i++) { releases.splice(0).forEach(resolve => resolve()); await new Promise(resolve => setImmediate(resolve)); }
  await Promise.all(jobs); assert.equal(maximum, 2);
});
test("rich text preserves content while stripping scripts, active images, unsafe links and CSS URLs", () => {
  const html = sanitizeArticleHtml('<p>記事<strong>本文</strong></p><script>alert(1)</script><svg onload="alert(1)"></svg><img src="https://evil.invalid/x" onerror="alert(1)"><a href="javascript:alert(1)">リンク</a><p style="color:red;background-image:url(https://evil.invalid)">色</p><img src="https://images.microcms-assets.io/assets/a/photo.jpg"><a href="https://example.com" target="_blank">外部</a>');
  assert.match(html, /記事<strong>本文<\/strong>/); assert.match(html, /microcms-assets/); assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /script|svg|onload|onerror|javascript:|evil\.invalid|background-image/);
  assert.equal(safeMediaUrl("https://images.microcms-assets.io.evil.invalid/x"), "");
  assert.equal(safeMediaUrl("https://user:pass@images.microcms-assets.io/x"), "");
  assert.equal(safeExternalUrl("javascript:alert(1)"), "");
});
test("redirects and API errors get privacy headers, HSTS, and strict host-only HTTPS cookies", () => {
  for (const response of [Response.redirect("https://scharade.jp/Login", 302), new Response("denied", { status: 403 })]) {
    const hardened = securityResponse(response, new URL("https://scharade.jp/Admin"));
    assert.match(hardened.headers.get("Cache-Control")!, /no-store/); assert.equal(hardened.headers.get("X-Content-Type-Options"), "nosniff");
    assert.match(hardened.headers.get("Strict-Transport-Security")!, /31536000/);
    assert.ok(hardened.headers.get("Content-Security-Policy"));
  }
  const privatePage = securityResponse(new Response("ok"), new URL("https://scharade.jp/ResetPassword?token=synthetic"));
  assert.equal(privatePage.headers.get("Referrer-Policy"), "no-referrer");
  const request = new Request("https://scharade.jp/Member");
  assert.equal(sessionCookieName(request), "__Host-session");
  assert.deepEqual(cookieOptions(request, 300), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 300 });
});
