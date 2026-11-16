import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isStaff, isExecutive, isAdmin, canManageAccount } from "../src/lib/roles.ts";
import { accountRegistration, accountRevision, updateAccountRegistration } from "../src/lib/accountManagement.ts";
import { deleteAccount, accountDeletionRevision } from "../src/lib/accountDeletion.ts";
import { readUsers, type User } from "../src/lib/auth.ts";
import { writeData } from "../src/lib/store.ts";
import { privilegedSession } from "./helpers/auth.ts";
import { getUserFromSession } from "../src/lib/auth.ts";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-executive-"));
process.env.DATA_DIR = directory;
const accounts: User[] = ["member", "staff", "executive", "admin"].map(role => ({ id: role, name: role, email: `${role}@example.invalid`, approved: true, role: role as User["role"], passwordHash: "fixture", createdAt: new Date().toISOString(), providers: { credentials: true } }));
const payload = (user: User, changes = {}) => ({ ...accountRegistration(user), revision: accountRevision(user), ...changes });
beforeEach(() => { fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory); writeData("users.json", accounts); });
after(() => fs.rmSync(directory, { recursive: true, force: true }));
test("roles inherit in order and unapproved accounts receive no privileged access", () => {
  for (const [index, user] of accounts.entries()) {
    assert.equal(isStaff(user), index >= 1); assert.equal(isExecutive(user), index >= 2); assert.equal(isAdmin(user), index === 3);
    assert.equal(isStaff({ ...user, approved: false }), false);
  }
  for (const target of accounts) assert.equal(canManageAccount(accounts[2], target), ["member", "staff"].includes(target.role!));
});
test("executives edit lower roles and cannot promote, edit or delete peers and administrators", async () => {
  await updateAccountRegistration("executive", "member", payload(accounts[0], { name: "更新した会員", role: "staff" }));
  assert.equal(readUsers().find(user => user.id === "member")!.role, "staff");
  for (const role of ["executive", "admin"]) await assert.rejects(updateAccountRegistration("executive", "staff", payload(accounts[1], { role })), (error: any) => error.status === 403);
  for (const user of accounts.slice(2)) {
    await assert.rejects(updateAccountRegistration("executive", user.id, payload(user, { email: "changed@example.invalid" })), (error: any) => error.status === 403);
    await assert.rejects(deleteAccount("executive", user.id, { revision: accountDeletionRevision(user), confirmationEmail: user.email }), (error: any) => error.status === 403);
  }
  await deleteAccount("executive", "staff", { revision: accountDeletionRevision(accounts[1]), confirmationEmail: accounts[1].email });
  assert.equal(readUsers().some(user => user.id === "staff"), false);
});
test("administrators assign executive and executive role changes revoke sessions", async () => {
  const session = await privilegedSession("executive");
  assert.equal(getUserFromSession(session.token).user?.role, "executive");
  await updateAccountRegistration("admin", "executive", payload(accounts[2], { role: "staff" }));
  assert.equal(getUserFromSession(session.token).user, null);
  await updateAccountRegistration("admin", "member", payload(accounts[0], { role: "executive" }));
  assert.equal(readUsers().find(user => user.id === "member")!.role, "executive");
});
