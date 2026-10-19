import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-migration-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
function run(script: string, args: string[], directory: string, key = "ac".repeat(32)) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8", env: { ...process.env, DATA_DIR: directory, MFA_ENCRYPTION_KEY: key } });
}
test("migration preserves unrelated accounts, retires obsolete MFA state, backs up data and applies only once", () => {
  const directory = fs.mkdtempSync(path.join(root, "data-"));
  const users = [{ id: "exposed", email: "exposed@example.invalid", passwordHash: "synthetic-exposed-hash", authVersion: 3 }, { id: "changed", email: "changed@example.invalid", passwordHash: "synthetic-replaced-hash", authVersion: 2 }];
  const state = { version: 1, accounts: { retained: { encrypted: "synthetic-placeholder" } }, challenges: { old: {} }, grants: { old: {} } };
  const put = (name: string, value: unknown) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value));
  put("users.json", users); put("sessions.json", [{ id: "old", userId: "exposed" }]); put("auth-security.json", state); put("password-reset-tokens.json", [{ old: true }]); put("signup-verifications.json", [{ old: true }]);
  const exposed = path.join(directory, "exposed.json"); put("exposed.json", [{ id: "exposed", passwordFingerprint: hash(users[0].passwordHash) }]);
  const arguments_ = [`--exposed=${exposed}`];
  const dry = run("scripts/security-migrate.mjs", arguments_, directory); assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout), { dryRun: true, exposedAccounts: 1, revokedSessions: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "users.json"), "utf8")), users);
  const missingKey = run("scripts/security-migrate.mjs", [...arguments_, "--apply"], directory, ""); assert.notEqual(missingKey.status, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "users.json"), "utf8")), users);
  const applied = run("scripts/security-migrate.mjs", [...arguments_, "--apply"], directory); assert.equal(applied.status, 0, applied.stderr);
  const updated = JSON.parse(fs.readFileSync(path.join(directory, "users.json"), "utf8"));
  assert.equal(updated[0].mustResetPassword, true); assert.equal(updated[0].authVersion, 4); assert.deepEqual(updated[1], users[1]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "sessions.json"), "utf8")), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "password-reset-tokens.json"), "utf8")), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "signup-verifications.json"), "utf8")), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "auth-security.json"), "utf8")), { version: 2, method: "email", challenges: {}, deliveries: {}, grants: {} });
  const backups = fs.readdirSync(directory).filter(name => name.startsWith("security-backup-")); assert.equal(backups.length, 1);
  const backup = path.join(directory, backups[0]); assert.equal(fs.statSync(backup).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backup, "users.json"), "utf8")), users);
  assert.equal(fs.statSync(path.join(backup, "users.json")).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backup, "signup-verifications.json"), "utf8")), [{ old: true }]);
  const repeated = run("scripts/security-migrate.mjs", [...arguments_, "--apply"], directory); assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout), { alreadyApplied: true }); assert.equal(fs.readdirSync(directory).filter(name => name.startsWith("security-backup-")).length, 1);
});
test("environment preparation generates independent secrets without disclosing or replacing them", () => {
  const directory = fs.mkdtempSync(path.join(root, "env-")), file = path.join(directory, ".env"); fs.writeFileSync(file, "SITE_URL=https://example.invalid\n");
  const prepared = run("scripts/security-env.mjs", [file], directory); assert.equal(prepared.status, 0, prepared.stderr);
  const text = fs.readFileSync(file, "utf8"); const mfa = text.match(/^MFA_ENCRYPTION_KEY=([a-f0-9]{64})$/m)![1], gallery = text.match(/^GALLERY_SIGNING_SECRET=([a-f0-9]{64})$/m)![1];
  assert.notEqual(mfa, gallery); assert.ok(!prepared.stdout.includes(mfa)); assert.ok(!prepared.stdout.includes(gallery));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(run("scripts/security-env.mjs", [file], directory).status, 0); assert.equal(fs.readFileSync(file, "utf8"), text);
  const production = run("scripts/security-env.mjs", [file, "--production"], directory); assert.equal(production.status, 0, production.stderr);
  const configured = fs.readFileSync(file, "utf8");
  for (const line of ["SITE_URL=https://scharade.jp", "HOST=127.0.0.1", "PORT=4321", "TRUST_PROXY=1", `MFA_ENCRYPTION_KEY=${mfa}`, `GALLERY_SIGNING_SECRET=${gallery}`]) assert.ok(configured.includes(line));
  assert.equal(run("scripts/security-env.mjs", [file, "--production"], directory).status, 0); assert.equal(fs.readFileSync(file, "utf8"), configured);
  assert.ok(!production.stdout.includes(mfa)); assert.ok(!production.stdout.includes(gallery));
  fs.writeFileSync(file, "MFA_ENCRYPTION_KEY=invalid\n"); assert.notEqual(run("scripts/security-env.mjs", [file], directory).status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), "MFA_ENCRYPTION_KEY=invalid\n");
});
test("deployment preflight requires a rotated server-only CMS key without printing credentials", () => {
  const directory = fs.mkdtempSync(path.join(root, "preflight-"));
  const appDirectory = fs.mkdtempSync(path.join(root, "preflight-app-"));
  // Preflight checks ownership and permissions of cwd/.env. Use a fixture,
  // never the developer's real credentials or a file absent from a fresh clone.
  fs.writeFileSync(path.join(appDirectory, ".env"), "# Synthetic preflight fixture\n", { mode: 0o600 });
  const script = path.resolve("scripts/security-preflight.mjs");
  const env = { ...process.env, DATA_DIR: directory, MFA_ENCRYPTION_KEY: "ad".repeat(32), GALLERY_SIGNING_SECRET: "independent-synthetic-gallery-secret", SIGNUP_REVIEW_SECRET: "synthetic-signup-secret-32-characters", MICROCMS_SERVICE_DOMAIN: "synthetic", MICROCMS_SERVER_API_KEY: "synthetic-rotated-server", MICROCMS_API_KEY: "synthetic-old", GMAIL_PASS: "synthetic-mail", TRUST_PROXY: "1", HOST: "127.0.0.1", SITE_URL: "https://scharade.jp" };
  const runCheck = (changes = {}, args: string[] = []) => spawnSync(process.execPath, ["--experimental-strip-types", script, "--offline", ...args], { cwd: appDirectory, encoding: "utf8", env: { ...env, ...changes } });
  const ready = runCheck(); assert.equal(ready.status, 0, ready.stdout + ready.stderr); assert.equal(JSON.parse(ready.stdout).ready, true);
  const missing = runCheck({ MICROCMS_SERVER_API_KEY: "", MICROCMS_READ_API_KEY: "synthetic-read", MICROCMS_WRITE_API_KEY: "synthetic-write", MICROCMS_MANAGEMENT_API_KEY: "synthetic-management" }); assert.equal(missing.status, 1); assert.ok(JSON.parse(missing.stdout).failures.includes("MICROCMS_SERVER_API_KEY: missing"));
  const old = runCheck({ MICROCMS_SERVER_API_KEY: "synthetic-old" }); assert.equal(old.status, 1);
  const historical = runCheck({ MICROCMS_API_KEY: "" }, [`--old-cms-fingerprint=${hash(env.MICROCMS_SERVER_API_KEY)}`]); assert.equal(historical.status, 1); assert.ok(JSON.parse(historical.stdout).failures.includes("microCMS: historical key fingerprint still matches"));
  const weak = runCheck({ MFA_ENCRYPTION_KEY: "weak" }); assert.equal(weak.status, 1);
  for (const result of [ready, missing, old, historical, weak]) for (const value of [env.MFA_ENCRYPTION_KEY, env.GMAIL_PASS, env.MICROCMS_SERVER_API_KEY, env.MICROCMS_API_KEY]) assert.ok(!result.stdout.includes(value));
});

test("email MFA migration backs up app secrets, preserves members and users byte-for-byte, and revokes staff sessions once", () => {
  const directory = fs.mkdtempSync(path.join(root, "email-data-")), backup = path.join(root, "email-backup");
  const users = [{ id: "member", email: "member@example.invalid", approved: true, role: "member" }, { id: "staff", email: "staff@example.invalid", approved: true, role: "staff" }, { id: "admin", email: "admin@example.invalid", approved: true, role: "admin" }];
  const sessions = [{ id: "member-session", userId: "member" }, { id: "staff-session", userId: "staff" }, { id: "admin-session", userId: "admin" }];
  const state = { version: 1, accounts: { staff: { secret: "synthetic-encrypted" } }, challenges: { old: {} }, grants: { old: {} } };
  for (const [name, data] of [["users", users], ["sessions", sessions], ["auth-security", state], ["security-migrations", [{ id: "previous" }]]]) fs.writeFileSync(path.join(directory, `${name}.json`), JSON.stringify(data));
  const originalUsers = fs.readFileSync(path.join(directory, "users.json"), "utf8");
  const dry = run("scripts/email-mfa-migrate.mjs", [], directory); assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(JSON.parse(dry.stdout), { dryRun: true, privilegedAccounts: 2, revokedPrivilegedSessions: 2, preservedMemberSessions: 1, retiredAppEnrollments: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "sessions.json"), "utf8")), sessions);
  const missing = run("scripts/email-mfa-migrate.mjs", ["--apply", `--backup=${backup}`], directory, ""); assert.notEqual(missing.status, 0); assert.equal(fs.existsSync(backup), false);
  const applied = run("scripts/email-mfa-migrate.mjs", ["--apply", `--backup=${backup}`], directory); assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(path.join(directory, "users.json"), "utf8"), originalUsers);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "sessions.json"), "utf8")), [sessions[0]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "auth-security.json"), "utf8")), { version: 2, method: "email", challenges: {}, deliveries: {}, grants: {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backup, "auth-security.json"), "utf8")), state);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(backup, "auth-security.json")).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(directory, "sessions.json"), JSON.stringify(sessions));
  const repeated = run("scripts/email-mfa-migrate.mjs", ["--apply", `--backup=${backup}`], directory); assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(JSON.parse(repeated.stdout), { alreadyApplied: true }); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "sessions.json"), "utf8")), sessions);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "security-migrations.json"), "utf8"))[0].id, "previous");
});
