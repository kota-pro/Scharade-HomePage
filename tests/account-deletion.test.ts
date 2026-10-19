import { test, beforeEach, afterEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  deleteAccount,
  accountDeletionRevision,
} from "../src/lib/accountDeletion.ts";
import { AccountUpdateError } from "../src/lib/accountManagement.ts";
import {
  readUsers,
  createSession,
  getUserFromSession,
  readSessions,
  type User,
} from "../src/lib/auth.ts";
import {
  createPasswordResetToken,
  findPasswordResetToken,
} from "../src/lib/passwordReset.ts";
import { writeData, readData } from "../src/lib/store.ts";
import { applyAccountReview } from "../src/lib/accountReview.ts";
import { cached, invalidateCache } from "../src/lib/cache.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-delete-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  MICROCMS_SERVICE_DOMAIN: "fixture",
  MICROCMS_SERVER_API_KEY: "fixture",
});
const user: User = {
  id: "member",
  name: "削除対象",
  email: "member@example.invalid",
  approved: true,
  role: "member",
  portfolioId: "portfolio",
  createdAt: "2026-09-01T00:00:00Z",
  providers: { credentials: true },
  passwordHash: "private",
};
const admin: User = {
  ...user,
  id: "admin",
  name: "管理者",
  email: "admin@example.invalid",
  role: "admin",
  portfolioId: "admin-portfolio",
};
const other: User = {
  ...user,
  id: "other",
  email: "other@example.invalid",
  portfolioId: "other-portfolio",
};
let mode = "ok",
  calls: string[] = [],
  deleted = false;
const confirmation = (u = user) => ({
  revision: accountDeletionRevision(u),
  confirmationEmail: u.email,
});
const reject = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof AccountUpdateError && e.status === status,
  );
beforeEach(() => {
  mode = "ok";
  calls = [];
  deleted = false;
  invalidateCache();
  writeData("users.json", [admin, user, other]);
  writeData("sessions.json", []);
  writeData("password-reset-tokens.json", []);
  mock.method(
    globalThis,
    "fetch",
    async (input: string, options: RequestInit = {}) => {
      const url = new URL(input);
      calls.push(`${options.method || "GET"} ${url.pathname}`);
      if (url.hostname === "fixture.microcms-management.io") {
        if (mode === "unverifiable") return new Response("{}", { status: 403 });
        return Response.json(
          {},
          {
            status:
              url.pathname === "/api/v1/contents/portfolio"
                ? 200
                : deleted || mode === "missing"
                  ? 404
                  : 200,
          },
        );
      }
      assert.equal(url.hostname, "fixture.microcms.io");
      assert.equal(options.method, "DELETE");
      assert.equal(url.pathname, "/api/v1/portfolio/portfolio");
      if (mode === "timeout") throw new Error("fixture timeout");
      if (mode === "fail") return new Response("{}", { status: 503 });
      if (["missing", "hidden", "unverifiable"].includes(mode) || deleted)
        return new Response("{}", { status: 400 });
      deleted = true;
      return new Response("Accepted", { status: 202 });
    },
  );
});
afterEach(() => mock.restoreAll());
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("deletes the linked Portfolio and account, revokes sessions/reset links and approval, preserves other users", async () => {
  const session = await createSession(user.id, 300);
  const otherSession = await createSession(other.id, 300);
  const token = await createPasswordResetToken(user.id);
  const otherToken = await createPasswordResetToken(other.id);
  await cached("cms:fixture", async () => "before");
  await deleteAccount(admin.id, user.id, confirmation());
  assert.equal(deleted, true);
  assert.deepEqual(readUsers(), [admin, other]);
  assert.equal(getUserFromSession(session.token).user, null);
  assert.equal(
    readSessions().some((s) => s.userId === user.id),
    false,
  );
  assert.equal(getUserFromSession(otherSession.token).user?.id, other.id);
  assert.equal(findPasswordResetToken(token), null);
  assert.ok(findPasswordResetToken(otherToken));
  assert.equal(await cached("cms:fixture", async () => "after"), "after");
  let sent = 0;
  assert.equal(
    await applyAccountReview(user.id, "approve", async () => {
      sent++;
    }),
    "invalid",
  );
  assert.equal(sent, 0);
  await assert.rejects(createSession(user.id, 300));
  await assert.rejects(createPasswordResetToken(user.id));
  const log = fs.readFileSync(path.join(dir, "audit.jsonl"), "utf8");
  assert.match(log, /account.delete.with-portfolio/);
  assert.ok(!log.includes(user.email));
});

test("self deletion, non-admin, stale state, wrong confirmation and shared Portfolio are rejected before CMS access", async () => {
  await reject(deleteAccount(admin.id, admin.id, confirmation(admin)), 403);
  await reject(deleteAccount(user.id, other.id, confirmation(other)), 403);
  await reject(deleteAccount("removed-admin", user.id, confirmation()), 403);
  await reject(deleteAccount(admin.id, "missing", confirmation()), 404);
  await reject(
    deleteAccount(admin.id, user.id, {
      ...confirmation(),
      confirmationEmail: "wrong@example.invalid",
    }),
    400,
  );
  await reject(
    deleteAccount(admin.id, user.id, {
      ...confirmation(),
      portfolioId: "admin-portfolio",
    }),
    400,
  );
  await reject(
    deleteAccount(admin.id, user.id, { ...confirmation(), revision: "old" }),
    409,
  );
  writeData("users.json", [admin, { ...user, approved: false }, other]);
  await reject(deleteAccount(admin.id, user.id, confirmation()), 409);
  writeData("users.json", [
    admin,
    user,
    { ...other, portfolioId: user.portfolioId },
  ]);
  await reject(deleteAccount(admin.id, user.id, confirmation()), 409);
  assert.deepEqual(calls, []);
});

test("remote failures and unverifiable missing/unpublished content keep accounts and credentials intact", async () => {
  const token = await createPasswordResetToken(user.id);
  const session = await createSession(user.id, 300);
  for (const failure of ["fail", "timeout", "hidden", "unverifiable"]) {
    mode = failure;
    await reject(deleteAccount(admin.id, user.id, confirmation()), 502);
    assert.deepEqual(readUsers(), [admin, user, other]);
    assert.ok(findPasswordResetToken(token));
    assert.equal(getUserFromSession(session.token).user?.id, user.id);
  }
  mode = "missing";
  await deleteAccount(admin.id, user.id, confirmation());
  assert.ok(!readUsers().some((u) => u.id === user.id));
});

test("a local failure after Portfolio deletion keeps the account and a retry finishes safely", async () => {
  const rename = fs.renameSync;
  const failure = mock.method(
    fs,
    "renameSync",
    (from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === path.join(dir, "users.json"))
        throw new Error("fixture disk failure");
      return rename(from, to);
    },
  );
  await assert.rejects(
    deleteAccount(admin.id, user.id, confirmation()),
    (e: unknown) =>
      e instanceof AccountUpdateError &&
      e.status === 503 &&
      e.message.includes("Portfolioの削除は完了"),
  );
  assert.equal(deleted, true);
  assert.ok(readUsers().some((u) => u.id === user.id));
  failure.mock.restore();
  await deleteAccount(admin.id, user.id, confirmation());
  assert.ok(!readUsers().some((u) => u.id === user.id));
  assert.ok(
    calls.some((call) => call.includes("/contents/portfolio/portfolio")),
  );
});

test("unlinked legacy accounts delete locally and concurrent deletion cannot remove both administrators", async () => {
  const legacy = { ...user, portfolioId: null };
  writeData("users.json", [admin, legacy]);
  await deleteAccount(admin.id, legacy.id, confirmation(legacy));
  assert.deepEqual(calls, []);
  assert.deepEqual(readUsers(), [admin]);
  const a = { ...admin, portfolioId: null },
    b = { ...a, id: "admin2", email: "admin2@example.invalid" };
  writeData("users.json", [a, b]);
  const outcomes = await Promise.allSettled([
    deleteAccount(a.id, b.id, confirmation(b)),
    deleteAccount(b.id, a.id, confirmation(a)),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    readUsers().filter((u) => u.role === "admin" && u.approved).length,
    1,
  );
  assert.deepEqual(readData("sessions.json", []), []);
});
