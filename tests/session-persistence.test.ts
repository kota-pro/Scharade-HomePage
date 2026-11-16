import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, deleteSession, getUserFromSession, readSessions, renewSession, touchSession, type User } from "../src/lib/auth.ts";
import { readTrustedBrowsers, trustedMfaBrowser } from "../src/lib/mfaTrustedBrowsers.ts";
import { startMfaChallenge, completeMfaChallenge } from "../src/lib/mfa.ts";
import { emptyMfaState } from "../src/lib/mfaState.ts";
import { readData, writeData } from "../src/lib/store.ts";
import { DEFAULT_SESSION_SECONDS, REMEMBER_SESSION_SECONDS, MFA_IDLE_MS } from "../src/lib/sessionPolicy.ts";
import { POST as login } from "../src/pages/api/auth/login.ts";
import { GET as status, POST as sessionAction } from "../src/pages/api/auth/session.ts";
import { setSessionCookie } from "../src/lib/sessionCookies.ts";
import { hashPassword } from "../src/lib/passwords.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-session-test-"));
const password = "Synthetic-password-123!", passwordHash = hashPassword(password);
const member: User = { id: "member", name: "架空会員", email: "member@example.invalid", approved: true, role: "member", passwordHash, createdAt: new Date().toISOString(), providers: { credentials: true } };
const staff: User = { ...member, id: "staff", role: "staff", email: "staff@example.invalid" };
const admin: User = { ...member, id: "admin", role: "admin", email: "admin@example.invalid" };
beforeEach(() => {
  process.env.DATA_DIR = directory; process.env.NODE_ENV = "test"; process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32); process.env.TRUST_PROXY = "0";
  writeData("users.json", [member, staff, admin]); writeData("sessions.json", []); writeData("mfa-trusted-browsers.json", []);
  writeData("auth-security.json", emptyMfaState()); writeData("rate-limit.json", {});
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function proof(user = staff, seconds = REMEMBER_SESSION_SECONDS) {
  let code = "";
  const challenge = await startMfaChallenge(user, "/Member", seconds, async (_email, value) => { code = value; });
  const completed = await completeMfaChallenge(challenge.token, code);
  assert.equal(completed.maxAge, seconds);
  return createSession(user.id, completed.maxAge, user.passwordHash, user.email, completed.grant);
}
function context(token?: string, action?: unknown, trust?: string, foreign = false) {
  const values = new Map<string, string>();
  if (token) values.set("__Host-session", token);
  if (trust) values.set("__Host-mfa-browser", trust);
  const request = new Request("https://scharade.jp/api/auth/session", {
    method: action === undefined ? "GET" : "POST",
    headers: { Cookie: [...values].map(([k,v]) => `${k}=${v}`).join("; "), ...(action === undefined ? {} : { Origin: foreign ? "https://evil.invalid" : "https://scharade.jp", "Content-Type": "application/json" }) },
    ...(action === undefined ? {} : { body: JSON.stringify(action) }),
  });
  const set: { name: string; value: string; options: any }[] = [];
  return { request, url: new URL(request.url), clientAddress: "127.0.0.1", locals: {},
    cookies: { get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined, delete: () => {}, set: (name: string, value: string, options: any) => { set.push({ name, value, options }); } }, set } as any;
}
test("all roles retain requested 30-day or eight-hour sessions and MFA preserves the selected duration", async () => {
  for (const user of [member, staff, admin]) {
    const session = user.role === "member" ? await createSession(user.id, REMEMBER_SESSION_SECONDS) : await proof(user);
    assert.equal(Date.parse(session.expiresAt) - Date.parse(session.createdAt), REMEMBER_SESSION_SECONDS * 1000);
    assert.equal(session.remember, true); assert.equal(getUserFromSession(session.token).user?.id, user.id);
  }
  const ordinary = await createSession(member.id, DEFAULT_SESSION_SECONDS);
  assert.equal(ordinary.remember, false);
  const short = await proof(staff, DEFAULT_SESSION_SECONDS);
  assert.equal(short.remember, false); assert.equal(Date.parse(short.expiresAt) - Date.parse(short.createdAt), DEFAULT_SESSION_SECONDS * 1000);
});
test("same verified browser can log in with a password without fresh MFA; trust is account-bound and cannot replace a password", async () => {
  const session = await proof();
  const c = context(undefined, { email: staff.email, password, remember: true }, session.trustedBrowserToken);
  const response = await login(c); assert.equal(response.status, 200); assert.equal((await response.json()).mfaRequired, undefined);
  assert.ok(c.set.some((x: any) => x.name === "__Host-session"));
  assert.ok(trustedMfaBrowser(staff, session.trustedBrowserToken));
  assert.equal(trustedMfaBrowser(admin, session.trustedBrowserToken), undefined);
  assert.equal(trustedMfaBrowser(staff, "x".repeat(43)), undefined);
  await assert.rejects(createSession(staff.id, DEFAULT_SESSION_SECONDS, undefined, undefined, undefined, session.trustedBrowserToken));
  const wrong = context(undefined, { email: staff.email, password: "wrong" }, session.trustedBrowserToken);
  assert.equal((await login(wrong)).status, 400); assert.equal(wrong.set.length, 0);
});
test("background status reads do not refresh seven-day inactivity, while explicit activity does", async () => {
  const session = await proof(), originalNow = Date.now, initial = originalNow();
  try {
    Date.now = () => initial + MFA_IDLE_MS - 1000;
    const before = JSON.stringify(readTrustedBrowsers()), sessionsBefore = JSON.stringify(readSessions());
    assert.equal((await status(context(session.token))).status, 200);
    assert.equal(JSON.stringify(readTrustedBrowsers()), before); assert.equal(JSON.stringify(readSessions()), sessionsBefore);
    assert.equal((await sessionAction(context(session.token, { action: "activity" }, session.trustedBrowserToken))).status, 200);
    assert.equal(readTrustedBrowsers()[0].lastSeenAt, Date.now());
    Date.now = () => initial + MFA_IDLE_MS + 1000;
    assert.equal(getUserFromSession(session.token).user?.id, staff.id);
    assert.ok(trustedMfaBrowser(staff, session.trustedBrowserToken));
  } finally { Date.now = originalNow; }
});
test("seven days without activity expires privileged proof and cannot be revived by renewal or heartbeat", async () => {
  const session = await proof(), originalNow = Date.now, initial = originalNow();
  try {
    Date.now = () => initial + MFA_IDLE_MS;
    assert.equal(getUserFromSession(session.token).user, null); assert.equal(trustedMfaBrowser(staff, session.trustedBrowserToken), undefined);
    const poll = await status(context(session.token)); assert.equal(poll.status, 200); assert.equal((await poll.json()).authenticated, false);
    assert.equal(await renewSession(session.token), null); assert.equal(await touchSession(session, true), null);
    assert.equal((await sessionAction(context(session.token, { action: "renew" }, session.trustedBrowserToken))).status, 401);
  } finally { Date.now = originalNow; }
});
test("renewal uses the original remember choice, updates cookies, and rejects client lifetime overrides or foreign origin", async () => {
  for (const seconds of [DEFAULT_SESSION_SECONDS, REMEMBER_SESSION_SECONDS]) {
    const session = await createSession(member.id, seconds);
    const c = context(session.token, { action: "renew" });
    const response = await sessionAction(c); assert.equal(response.status, 200);
    const body = await response.json(); assert.ok(body.expiresAt - body.serverNow <= seconds * 1000);
    assert.ok(body.expiresAt - body.serverNow > seconds * 1000 - 1000);
    const cookie = c.set.find((x: any) => x.name === "__Host-session"); assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true);
    assert.equal((await sessionAction(context(session.token, { action: "renew", remember: true }))).status, 400);
    assert.equal((await sessionAction(context(session.token, { action: "renew" }, undefined, true))).status, 403);
  }
});
test("expired sessions and sessions revoked by account changes cannot be renewed", async () => {
  const session = await createSession(member.id, 60), all = readSessions();
  all[0].expiresAt = new Date(Date.now() - 1).toISOString(); writeData("sessions.json", all);
  assert.equal(await renewSession(session.token), null);
  const next = await createSession(member.id, 60);
  writeData("users.json", [{ ...member, authVersion: 1 }, staff, admin]);
  assert.equal(await renewSession(next.token), null);
});
test("logout revokes browser trust as well as the session and renewal cannot resurrect it", async () => {
  const session = await proof();
  await deleteSession(session.token, session.trustedBrowserToken);
  assert.equal(getUserFromSession(session.token).user, null); assert.equal(await renewSession(session.token), null);
  assert.equal(trustedMfaBrowser(staff, session.trustedBrowserToken), undefined);
  await assert.rejects(createSession(staff.id, DEFAULT_SESSION_SECONDS, staff.passwordHash, staff.email, undefined, session.trustedBrowserToken));
});
test("password, email, role, approval and auth-version changes invalidate trusted-browser proof", async () => {
  const session = await proof();
  for (const change of [{ passwordHash: "changed" }, { email: "changed@example.invalid" }, { authVersion: 1 }, { role: "member" as const }, { approved: false }, { mustResetPassword: true }]) {
    writeData("users.json", [{ ...staff, ...change }, member, admin]);
    assert.equal(trustedMfaBrowser({ ...staff, ...change }, session.trustedBrowserToken), undefined);
  }
});
test("browser secrets are hashed at rest and their cookies are host-only, HttpOnly and Secure", async () => {
  const session = await proof(), c = context();
  setSessionCookie(c.cookies, c.request, session);
  const cookie = c.set.find((x: any) => x.name === "__Host-mfa-browser");
  assert.equal(cookie.options.maxAge, MFA_IDLE_MS / 1000); assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true);
  assert.equal(cookie.options.path, "/"); assert.equal(cookie.options.sameSite, "lax"); assert.equal(cookie.options.domain, undefined);
  const stored = JSON.stringify(readData("mfa-trusted-browsers.json", []));
  assert.ok(!stored.includes(session.trustedBrowserToken!)); assert.ok(!stored.includes(staff.email)); assert.ok(!stored.includes(passwordHash));
});
test("old email-verified sessions remain usable and renewal does not silently opt them into remember", async () => {
  const now = new Date().toISOString(), token = "a".repeat(43);
  const { securityHash } = await import("../src/lib/mfaState.ts");
  writeData("sessions.json", [{ id: "legacy-email", userId: staff.id, tokenHash: securityHash(token), authVersion: 0, createdAt: now, lastSeenAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), mfaVerifiedAt: now, mfaMethod: "email" }]);
  assert.equal(getUserFromSession(token).user?.id, staff.id);
  const renewed = await renewSession(token); assert.ok(renewed);
  assert.ok(Date.parse(renewed.expiresAt) - Date.now() <= DEFAULT_SESSION_SECONDS * 1000);
  assert.equal(readTrustedBrowsers().length, 0);
});
