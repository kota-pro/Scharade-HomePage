import { privilegedSession } from "./helpers/auth.ts";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  accountRegistration,
  accountRevision,
  updateAccountRegistration,
  AccountUpdateError,
} from "../src/lib/accountManagement.ts";
import { writeData, readData } from "../src/lib/store.ts";
import {
  readUsers,
  createSession,
  getUserFromSession,
  type User,
} from "../src/lib/auth.ts";
import {
  createPasswordResetToken,
  findPasswordResetToken,
  ResetAccountChangedError,
} from "../src/lib/passwordReset.ts";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-account-edit-"));
process.env.DATA_DIR = dir;
const member: User = {
  id: "member",
  name: "会員",
  email: "member@example.invalid",
  portfolioName: "登録名",
  role: "member",
  approved: true,
  portfolioId: "portfolio",
  providers: {
    credentials: true,
    instagram: { id: "private-id", username: "member" },
  },
  passwordHash: "unchanged-private-hash",
  createdAt: "2026-09-01T00:00:00Z",
  approvalNotifiedAt: "2026-09-02T00:00:00Z",
};
const admin: User = {
  ...member,
  id: "admin",
  email: "admin@example.invalid",
  role: "admin",
  portfolioId: "admin-portfolio",
};
const other: User = {
  ...member,
  id: "other",
  email: "other@example.invalid",
  portfolioId: null,
};
beforeEach(() => {
  writeData("users.json", [admin, member, other]);
  writeData("sessions.json", []);
  writeData("password-reset-tokens.json", []);
  writeData("audit.jsonl", []);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const payload = (user: User, extra = {}) => ({
  ...accountRegistration(user),
  revision: accountRevision(user),
  ...extra,
});
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof AccountUpdateError && e.status === status,
  );

test("name and registration edits preserve credentials, ownership, approval and active sessions", async () => {
  const session = await createSession(member.id, 300);
  await updateAccountRegistration(
    admin.id,
    member.id,
    payload(member, { name: " 新しい会員 ", portfolioName: "登録時の訂正名" }),
  );
  const saved = readUsers().find((u) => u.id === member.id)!;
  assert.deepEqual(saved, {
    ...member,
    name: "新しい会員",
    portfolioName: "登録時の訂正名",
  });
  assert.equal(getUserFromSession(session.token).user?.name, "新しい会員");
  const log = fs.readFileSync(path.join(dir, "audit.jsonl"), "utf8");
  assert.match(log, /account.registration.update/);
  assert.ok(
    !log.includes("新しい会員") &&
      !log.includes("member@example.invalid") &&
      !log.includes("private-hash"),
  );
});

test("email changes revoke that account sessions and reset links and reject stale reset requests", async () => {
  const session = await createSession(member.id, 300);
  const token = await createPasswordResetToken(member.id, member.email);
  const otherToken = await createPasswordResetToken(other.id, other.email);
  const result = await updateAccountRegistration(
    admin.id,
    member.id,
    payload(member, { email: " New.Member@EXAMPLE.invalid " }),
  );
  assert.deepEqual(result, {
    emailChanged: true,
    roleChanged: false,
    reauthenticate: false,
  });
  assert.equal(
    readUsers().find((u) => u.id === member.id)?.email,
    "new.member@example.invalid",
  );
  assert.equal(getUserFromSession(session.token).user, null);
  await assert.rejects(
    createSession(member.id, 300, member.passwordHash, member.email),
  );
  assert.equal(findPasswordResetToken(token), null);
  assert.ok(findPasswordResetToken(otherToken));
  await assert.rejects(
    createPasswordResetToken(member.id, member.email),
    ResetAccountChangedError,
  );
  assert.ok(
    findPasswordResetToken(
      await createPasswordResetToken(member.id, "new.member@example.invalid"),
    ),
  );
  assert.equal(
    readUsers().find((u) => u.id === member.id)?.passwordHash,
    member.passwordHash,
  );
  const self = await updateAccountRegistration(
    admin.id,
    admin.id,
    payload(admin, { email: "admin-new@example.invalid" }),
  );
  assert.equal(self.reauthenticate, true);
});

test("invalid, unknown and protected fields cannot mutate records", async () => {
  for (const changes of [
    { name: "" },
    { name: "a".repeat(81) },
    { name: "bad\nname" },
    { email: "invalid" },
    { portfolioName: "a".repeat(51) },
    { role: "owner" },
    { role: null },
    { approved: false },
    { portfolioId: "other" },
    { passwordHash: "new" },
    { providers: {} },
    { name: { value: "bad" } },
  ])
    await rejects(
      updateAccountRegistration(admin.id, member.id, payload(member, changes)),
      400,
    );
  await rejects(
    updateAccountRegistration(
      admin.id,
      member.id,
      payload(member, { email: " ADMIN@EXAMPLE.INVALID " }),
    ),
    409,
  );
  await rejects(
    updateAccountRegistration(member.id, member.id, payload(member)),
    403,
  );
  await rejects(
    updateAccountRegistration("deleted-admin", member.id, payload(member)),
    403,
  );
  await rejects(
    updateAccountRegistration(admin.id, "missing", payload(member)),
    404,
  );
  assert.deepEqual(readUsers(), [admin, member, other]);
});

test("auth lock and revision prevent lost updates and duplicate email races", async () => {
  const outcomes = await Promise.allSettled([
    updateAccountRegistration(
      admin.id,
      member.id,
      payload(member, { name: "編集A" }),
    ),
    updateAccountRegistration(
      admin.id,
      member.id,
      payload(member, { name: "編集B" }),
    ),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (outcomes.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.status,
    409,
  );
  const current = readUsers().find((u) => u.id === member.id)!;
  const emails = await Promise.allSettled([
    updateAccountRegistration(
      admin.id,
      member.id,
      payload(current, { email: "shared@example.invalid" }),
    ),
    updateAccountRegistration(
      admin.id,
      other.id,
      payload(other, { email: "SHARED@example.invalid" }),
    ),
  ]);
  assert.equal(emails.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    readUsers().filter((u) => u.email === "shared@example.invalid").length,
    1,
  );
});

test("missing legacy registration name is editable and a storage failure leaves the account unchanged", async () => {
  const legacy = { ...member };
  delete legacy.portfolioName;
  writeData("users.json", [admin, legacy]);
  await updateAccountRegistration(
    admin.id,
    legacy.id,
    payload(legacy, { name: "旧会員の訂正" }),
  );
  const current = readUsers().find((u) => u.id === legacy.id)!;
  assert.equal(current.portfolioName, undefined);
  fs.writeFileSync(
    path.join(dir, "password-reset-tokens.json"),
    "invalid-json",
  );
  await assert.rejects(
    updateAccountRegistration(
      admin.id,
      current.id,
      payload(current, { email: "changed@example.invalid" }),
    ),
  );
  assert.deepEqual(readData("users.json", []), [admin, current]);
});

test("role changes revoke sessions and reset links, preserve approval and invalidate stale edits", async () => {
  const session = await createSession(member.id, 300);
  const reset = await createPasswordResetToken(member.id);
  const revision = accountRevision(member);
  const result = await updateAccountRegistration(
    admin.id,
    member.id,
    payload(member, { role: "admin" }),
  );
  assert.deepEqual(result, {
    emailChanged: false,
    roleChanged: true,
    reauthenticate: false,
  });
  const promoted = readUsers().find((u) => u.id === member.id)!;
  assert.deepEqual(promoted, { ...member, role: "admin", authVersion: 1 });
  assert.equal(getUserFromSession(session.token).user, null);
  assert.equal(findPasswordResetToken(reset), null);
  assert.notEqual(accountRevision(promoted), revision);
  await rejects(
    updateAccountRegistration(admin.id, member.id, payload(member)),
    409,
  );
  const newSession = await privilegedSession(member.id, 300);
  assert.equal(getUserFromSession(newSession.token).user?.role, "admin");
  await updateAccountRegistration(
    admin.id,
    member.id,
    payload(promoted, { role: "member" }),
  );
  assert.equal(getUserFromSession(newSession.token).user, null);
  const pending = { ...other, approved: false };
  writeData("users.json", [admin, pending]);
  await updateAccountRegistration(
    admin.id,
    pending.id,
    payload(pending, { role: "admin" }),
  );
  assert.equal(readUsers().find((u) => u.id === other.id)?.approved, false);
  await rejects(
    updateAccountRegistration(other.id, admin.id, payload(admin)),
    403,
  );
  assert.match(
    fs.readFileSync(path.join(dir, "audit.jsonl"), "utf8"),
    /account.role.update/,
  );
});

test("the last approved admin cannot be demoted, including concurrent self-demotions", async () => {
  await rejects(
    updateAccountRegistration(
      admin.id,
      admin.id,
      payload(admin, { role: "member" }),
    ),
    409,
  );
  assert.deepEqual(readUsers(), [admin, member, other]);
  writeData("users.json", [
    admin,
    { ...other, role: "admin", approved: false },
  ]);
  await rejects(
    updateAccountRegistration(
      admin.id,
      admin.id,
      payload(admin, { role: "member" }),
    ),
    409,
  );
  const secondAdmin: User = { ...other, role: "admin" };
  writeData("users.json", [admin, secondAdmin]);
  const outcomes = await Promise.allSettled([
    updateAccountRegistration(
      admin.id,
      admin.id,
      payload(admin, { role: "member" }),
    ),
    updateAccountRegistration(
      other.id,
      other.id,
      payload(secondAdmin, { role: "member" }),
    ),
  ]);
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const completed = outcomes.find(
    (r) => r.status === "fulfilled",
  ) as PromiseFulfilledResult<
    Awaited<ReturnType<typeof updateAccountRegistration>>
  >;
  assert.equal(completed.value.reauthenticate, true);
  assert.equal(
    readUsers().filter((u) => u.approved && u.role === "admin").length,
    1,
  );
  const demoted = readUsers().find((u) => u.role === "member")!;
  await rejects(
    updateAccountRegistration(
      demoted.id,
      demoted.id,
      payload(demoted, { role: "admin" }),
    ),
    403,
  );
});
