import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSession, getAuthenticationFromRequest, getUserFromRequest, readSessions, readUsers, actorUser, type User } from "../src/lib/auth.ts";
import { previewRoles } from "../src/lib/adminViewPolicy.ts";
import { changeAdminView } from "../src/lib/adminViewActions.ts";
import { withRequestIdentity, requestIdentity } from "../src/lib/requestIdentity.ts";
import { isMemberAccount, isSiteManagement } from "../src/lib/accountVisibility.ts";
import { startMfaChallenge, completeMfaChallenge } from "../src/lib/mfa.ts";
import { emptyMfaState } from "../src/lib/mfaState.ts";
import { MFA_IDLE_MS } from "../src/lib/sessionPolicy.ts";
import { writeData } from "../src/lib/store.ts";
import { POST as control } from "../src/pages/api/auth/admin-view.ts";
import { GET as sessionStatus } from "../src/pages/api/auth/session.ts";
import { POST as logout } from "../src/pages/api/auth/logout.ts";
import { audit } from "../src/lib/audit.ts";
import { activityAction, readActivities } from "../src/lib/activities.ts";
import { exhibitionAction, readExhibitions, updateExhibitionStore } from "../src/lib/exhibitions.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-admin-view-test-"));
const member: User = { id: "member", name: "会員", email: "member@example.invalid", approved: true, role: "member", createdAt: new Date().toISOString(), providers: { credentials: true }, portfolioId: "member-portfolio" };
const admin: User = { ...member, id: "admin", role: "admin", email: "admin@example.invalid" };
const site: User = { ...admin, id: "site", siteManagement: true, email: "site@example.invalid" };
const staff: User = { ...member, id: "staff", role: "staff", email: "staff@example.invalid" };
const executive: User = { ...member, id: "executive", role: "executive", email: "executive@example.invalid" };
beforeEach(() => {
  process.env.DATA_DIR = directory; process.env.NODE_ENV = "test"; process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32); process.env.TRUST_PROXY = "0";
  writeData("users.json", [admin, member, site, staff, executive]); writeData("sessions.json", []); writeData("mfa-trusted-browsers.json", []);
  writeData("auth-security.json", emptyMfaState()); writeData("rate-limit.json", {});
  for (const name of ["audit.jsonl", "member-activities.json"]) fs.rmSync(path.join(directory, name), { force: true });
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
async function login(user = admin) {
  if (user.role === "member") return createSession(user.id, 86400);
  let code = "";
  const challenge = await startMfaChallenge(user, "/Admin", 86400 * 30, async (_email, value) => { code = value; });
  const completed = await completeMfaChallenge(challenge.token, code);
  return createSession(user.id, completed.maxAge, undefined, user.email, completed.grant);
}
function request(token?: string, input?: unknown, origin = "https://scharade.jp") {
  return new Request("https://scharade.jp/api/auth/admin-view", { method: input === undefined ? "GET" : "POST", headers: { Cookie: token ? `__Host-session=${token}` : "", Origin: origin, "Content-Type": "application/json" }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
function context(req: Request) {
  return { request: req, url: new URL(req.url), locals: {}, cookies: { get: () => undefined, delete: () => {}, set: () => {} } } as any;
}
test("unauthenticated users, members and staff cannot proxy an account", async () => {
  for (const user of [undefined, member, staff]) {
    const session = user ? await login(user) : undefined;
    const response = await control(context(request(session?.token, { action: "account", userId: member.id })));
    assert.equal(response.status, user ? 403 : 401);
    assert.ok(readSessions().every(session => !session.adminView));
  }
  const session = await login();
  assert.equal((await control(context(request(session.token, { action: "role", role: "admin" })))).status, 400);
  assert.equal((await control(context(request(session.token, { action: "role", role: "member" }, "https://foreign.invalid")))).status, 403);
  assert.equal((await control(context(request(session.token, { action: "account", userId: "missing" })))).status, 404);
});
test("proxy keeps original authentication, uses target permissions, and changes neither account nor other sessions", async () => {
  const original = await login(), otherBrowser = await login(), users = JSON.stringify(readUsers());
  await changeAdminView(request(original.token), { action: "account", userId: member.id });
  const effective = getUserFromRequest(request(original.token));
  assert.equal(effective.user?.id, member.id); assert.equal(effective.user?.role, "member");
  assert.equal(effective.actor?.id, admin.id); assert.equal(effective.adminView?.readOnly, false);
  assert.equal(getAuthenticationFromRequest(request(original.token)).user?.id, admin.id);
  assert.equal(getUserFromRequest(request(otherBrowser.token)).user?.id, admin.id);
  assert.equal(readSessions().length, 2); assert.equal(JSON.stringify(readUsers()), users);
  await changeAdminView(request(original.token), { action: "stop" });
  assert.equal(getUserFromRequest(request(original.token)).user?.id, admin.id);
  assert.equal(getUserFromRequest(request(original.token)).adminView, null);
});
test("revoked, changed, reset-required or deleted target fails closed and can return to the administrator", async () => {
  const session = await login();
  for (const change of [{ approved: false }, { authVersion: 1 }, { mustResetPassword: true }, null]) {
    writeData("users.json", [admin, member]);
    await changeAdminView(request(session.token), { action: "account", userId: member.id });
    writeData("users.json", [admin, ...(change ? [{ ...member, ...change }] : [])]);
    const result = getUserFromRequest(request(session.token));
    assert.equal(result.user, null); assert.equal(result.adminView?.unavailable, true); assert.equal(result.adminView?.readOnly, true);
    await changeAdminView(request(session.token), { action: "stop" });
    assert.equal(getUserFromRequest(request(session.token)).user?.id, admin.id);
  }
});
test("a switch during an in-flight API request never resolves to the newly selected account", async () => {
  const session = await login();
  const save = new Request("https://scharade.jp/api/portfolio/update", { method: "POST", headers: { Cookie: `__Host-session=${session.token}` } });
  assert.equal(getUserFromRequest(save).user?.id, admin.id);
  await changeAdminView(request(session.token), { action: "account", userId: member.id });
  assert.equal(getUserFromRequest(save).user, null);
  const key = getUserFromRequest(request(session.token)).adminView!.key;
  const proxySave = new Request(save, { headers: { Cookie: `__Host-session=${session.token}`, "X-Admin-View": key } });
  assert.equal(getUserFromRequest(proxySave).user?.id, member.id);
  await changeAdminView(request(session.token), { action: "account", userId: staff.id });
  assert.equal(getUserFromRequest(proxySave).user, null);
  await changeAdminView(request(session.token), { action: "stop" });
  assert.equal(getUserFromRequest(proxySave).user, null);
});
test("all four previews use synthetic read-only identities while session status preserves the original login", async () => {
  const session = await login(), users = JSON.stringify(readUsers());
  for (const role of ["executive", "staff", "member", "guest"]) {
    await changeAdminView(request(session.token), { action: "role", role });
    const result = getUserFromRequest(request(session.token));
    assert.equal(result.user?.role ?? "guest", role); assert.equal(result.adminView?.readOnly, true);
    if (result.user) {
      assert.ok(!readUsers().some(user => user.id === result.user!.id));
      const identity = { actorId: admin.id, user: result.user, mode: "role" as const, key: result.adminView!.key };
      await withRequestIdentity(identity, async () => { await Promise.resolve(); assert.equal(actorUser(result.user!.id), result.user); });
      assert.equal(actorUser(result.user.id), undefined);
    }
    const status = await sessionStatus(context(request(session.token)));
    assert.equal((await status.json()).authenticated, true);
  }
  assert.equal(JSON.stringify(readUsers()), users);
  await logout(context(request(session.token, {})));
  assert.equal(getUserFromRequest(request(session.token)).user?.id, admin.id);
});
test("original administrator revocation or expired MFA cannot be bypassed by proxy or preview", async () => {
  const session = await login(), req = request(session.token);
  await changeAdminView(req, { action: "account", userId: member.id });
  writeData("users.json", [{ ...admin, authVersion: 1 }, member]);
  assert.equal(getUserFromRequest(req).user, null);
  await assert.rejects(changeAdminView(req, { action: "stop" }), { status: 401 });
  writeData("users.json", [admin, member]);
  const now = Date.now;
  try {
    Date.now = () => now() + MFA_IDLE_MS + 1000;
    assert.equal(getUserFromRequest(req).user, null);
    await assert.rejects(changeAdminView(req, { action: "role", role: "member" }), { status: 401 });
  } finally { Date.now = now; }
});
test("request identities are isolated and proxy audits retain the real administrator", async () => {
  const first = { actorId: admin.id, user: member, mode: "account" as const, key: "first" };
  const second = { actorId: site.id, user: staff, mode: "account" as const, key: "second" };
  await Promise.all([first, second].map(identity => withRequestIdentity(identity, async () => {
    await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(requestIdentity(), identity);
    await audit(identity.user.id, "test.proxy.edit", "synthetic");
  })));
  assert.equal(requestIdentity(), undefined);
  const records = fs.readFileSync(path.join(directory, "audit.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  for (const identity of [first, second]) assert.ok(records.some(item => item.actorId === identity.actorId && item.actingAsUserId === identity.user.id && item.viewKey === identity.key));
});
test("only dedicated site accounts are excluded; personal administrators and same-name accounts remain members", () => {
  assert.equal(isSiteManagement(site), true);
  assert.equal(isSiteManagement({ ...member, portfolioId: "w_rozcjvv" }), true);
  const sameName: User = { ...admin, name: "サイト管理" };
  assert.equal(isMemberAccount(sameName), true);
  assert.equal(isMemberAccount(member), true); assert.equal(isMemberAccount(site), false);
  assert.equal(isMemberAccount({ ...member, approved: false }), false);
});
test("notification submissions discard dedicated recipients while allowing a site administrator to operate", async () => {
  writeData("push-devices.json", { version: 1, devices: [site, member].map(user => ({ id: `device-${user.id}`, userId: user.id, authVersion: 0, sessionId: "synthetic", token: "synthetic", secretHash: "a".repeat(64), generation: "test", enabled: true, remindersEnabled: true, platform: "ios", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) });
  await activityAction(site.id, { action: "notification.send", id: "12345678-1234-1234-1234-123456789012", title: "テスト", body: "架空通知", recipientIds: [site.id, member.id, admin.id] });
  const data = readActivities();
  assert.deepEqual(data.notifications[0].recipientIds, [member.id, admin.id]);
  assert.deepEqual(data.push?.jobs.map(job => job.deviceId), [`device-${member.id}`]);
  await assert.rejects(activityAction(admin.id, { action: "notification.send", id: "12345678-1234-1234-1234-123456789013", title: "テスト", body: "架空通知", recipientIds: [site.id] }));
});
test("previous exhibition selections can omit the dedicated account without blocking edits or new notices", async () => {
  const e = (await exhibitionAction(admin.id, { action: "create", title: "架空写真展" })).exhibition;
  const current = () => readExhibitions().exhibitions.find(item => item.id === e.id)!;
  assert.ok(!current().participation!.recipientIds.includes(site.id));
  const iso = (delta: number) => new Date(Date.now() + delta).toISOString();
  const settings = { action: "settings", exhibitionId: e.id, title: e.title, status: "open", gallery: "staff", voteOpensAt: iso(-60000), voteClosesAt: iso(3600000), opensAt: iso(-60000), closesAt: iso(7200000) };
  await exhibitionAction(admin.id, { ...settings, revision: current().revision, recipientIds: [member.id, site.id] });
  assert.deepEqual(current().participation!.recipientIds, [member.id]);
  // Emulate data saved before the dedicated-account exclusion existed.
  await updateExhibitionStore(data => { data.exhibitions.find(item => item.id === e.id)!.participation!.recipientIds.push(site.id); });
  await exhibitionAction(admin.id, { action: "participation.publish", exhibitionId: e.id, revision: current().revision });
  assert.deepEqual(current().participation!.recipientIds, [member.id]);
  assert.deepEqual(current().notices!.at(-1)!.recipientIds, [member.id]);
  await updateExhibitionStore(data => { const p = data.exhibitions.find(item => item.id === e.id)!.participation!; p.state = "published"; p.recipientIds.push(site.id); });
  await exhibitionAction(admin.id, { ...settings, revision: current().revision, recipientIds: [member.id] });
  assert.deepEqual(current().participation!.recipientIds, [member.id]);
  await assert.rejects(exhibitionAction(admin.id, { ...settings, revision: current().revision, recipientIds: [] }), /解除できません/);
});


test("proxy and preview privileges are based on the original actor with a strict role matrix", async () => {
  for (const actor of [member, staff, executive, admin]) {
    const session = await login(actor);
    for (const role of ["executive", "staff", "member", "guest"] as const) {
      const allowed = previewRoles(actor).includes(role);
      const response = await control(context(request(session.token, { action: "role", role })));
      assert.equal(response.status, allowed ? 200 : 403, `${actor.role} -> ${role}`);
      if (allowed) {
        const view = getUserFromRequest(request(session.token));
        assert.equal(view.actor?.id, actor.id);
        assert.equal(view.user?.role ?? "guest", role);
        assert.equal(view.adminView?.readOnly, true);
        assert.equal((await changeAdminView(request(session.token), { action: "stop" })).href, actor.role === "staff" ? "/Management/view" : "/Admin/view");
      }
    }
    for (const target of [member, staff, executive, admin, site]) {
      const allowed = actor.role === "admin" || actor.role === "executive";
      const response = await control(context(request(session.token, { action: "account", userId: target.id })));
      assert.equal(response.status, allowed ? 200 : 403, `${actor.role} proxy ${target.role}`);
      if (allowed) {
        const view = getUserFromRequest(request(session.token));
        assert.equal(view.user?.id, target.id); assert.equal(view.actor?.id, actor.id); assert.equal(view.adminView?.readOnly, false);
        if (actor.role === "executive" && target.role === "admin")
          assert.equal((await control(context(request(session.token, { action: "role", role: "executive" })))).status, 403);
        await changeAdminView(request(session.token), { action: "stop" });
      }
    }
  }
});
test("original actor demotion closes an active account or disallowed role view, with a safe exit", async () => {
  for (const mode of ["account", "role"] as const) {
    writeData("users.json", [admin, member, staff, executive]);
    const session = await login(executive);
    await changeAdminView(request(session.token), mode === "account" ? { action: "account", userId: admin.id } : { action: "role", role: "staff" });
    // Even a direct role correction without an auth-version bump is rechecked.
    writeData("users.json", [admin, member, staff, { ...executive, role: "staff" }]);
    const effective = getUserFromRequest(request(session.token));
    assert.equal(effective.user, null); assert.equal(effective.adminView?.unavailable, true); assert.equal(effective.adminView?.readOnly, true);
    const response = await logout(context(request(session.token, {})));
    assert.equal(response.status, 200); assert.equal((await response.json()).href, "/Management/view");
    assert.equal(getUserFromRequest(request(session.token)).user?.role, "staff");
  }
});
test("executive and staff previews preserve MFA, original audit identity and other browsers", async () => {
  for (const actor of [executive, staff]) {
    const session = await login(actor), other = await login(actor);
    await changeAdminView(request(session.token), { action: "role", role: "guest" });
    assert.equal(getUserFromRequest(request(other.token)).user?.id, actor.id);
    assert.equal((await (await sessionStatus(context(request(session.token)))).json()).authenticated, true);
    const records = fs.readFileSync(path.join(directory, "audit.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(records.some(record => record.actorId === actor.id && record.action === "admin.view.role.start"));
    const now = Date.now;
    try {
      Date.now = () => now() + MFA_IDLE_MS + 1000;
      assert.equal(getUserFromRequest(request(session.token)).user, null);
      await assert.rejects(changeAdminView(request(session.token), { action: "role", role: "member" }), { status: 401 });
    } finally { Date.now = now; }
  }
});
