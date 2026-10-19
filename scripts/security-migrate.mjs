import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readUsers, readSessions } from "../src/lib/auth.ts";
import { dataPath, readData, writeData, withStoreLock } from "../src/lib/store.ts";
import { readMfaState, writeMfaState, securityHash } from "../src/lib/mfaState.ts";
import { audit } from "../src/lib/audit.ts";

const migration = "security-2026-10-v1";
const source = process.argv.find(arg => arg.startsWith("--exposed="))?.slice(10);
if (!source) throw new Error("--exposed=/private/path/security-exposed-hashes.json を指定してください。");
const entries = JSON.parse(fs.readFileSync(source, "utf8"));
if (!Array.isArray(entries) || entries.some(e => typeof e.id !== "string" || !/^[a-f0-9]{64}$/.test(e.passwordFingerprint))) throw new Error("露出履歴の形式を確認してください。");
const fingerprints = new Set(entries.map(e => e.passwordFingerprint));
const dryRun = !process.argv.includes("--apply");
const result = await withStoreLock("auth", () => {
  const history = readData("security-migrations.json", []);
  if (history.some(record => record.id === migration)) return { alreadyApplied: true };
  const users = readUsers(), affected = users.filter(u => u.passwordHash && fingerprints.has(securityHash(u.passwordHash)));
  const result = { dryRun, exposedAccounts: affected.length, revokedSessions: readSessions().length };
  if (dryRun) return result;
  if (!/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY ?? "")) throw new Error("MFA_ENCRYPTION_KEY を先に設定してください。");
  const parent = path.dirname(dataPath("users.json")), backup = path.join(parent, `security-backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
  fs.mkdirSync(backup, { mode: 0o700 });
  for (const name of ["users.json", "sessions.json", "password-reset-tokens.json", "signup-verifications.json", "auth-security.json", "security-migrations.json"]) {
    const file = dataPath(name); if (!fs.existsSync(file)) continue;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("データファイルのリンクを確認してください。");
    fs.copyFileSync(file, path.join(backup, name), fs.constants.COPYFILE_EXCL); fs.chmodSync(path.join(backup, name), 0o600);
  }
  for (const user of affected) { user.mustResetPassword = true; user.authVersion = (user.authVersion ?? 0) + 1; }
  // Account versions enforce revocation even if the process stops before session cleanup.
  writeData("users.json", users); writeData("sessions.json", []); writeData("password-reset-tokens.json", []); writeData("signup-verifications.json", []);
  const state = readMfaState(); state.challenges = {}; state.grants = {}; writeMfaState(state);
  history.push({ id: migration, at: new Date().toISOString(), ...result }); writeData("security-migrations.json", history);
  return result;
});
if (!dryRun && !result.alreadyApplied) await audit("vps-security-operator", "auth.security.migrate", migration);
console.log(JSON.stringify(result));
