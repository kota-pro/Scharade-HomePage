import fs from "node:fs";
import path from "node:path";
import { readUsers, readSessions, isStaff } from "../src/lib/auth.ts";
import { dataPath, readData, writeData, withStoreLock } from "../src/lib/store.ts";
import { emptyMfaState, writeMfaState } from "../src/lib/mfaState.ts";
import { audit } from "../src/lib/audit.ts";

const migration = "email-mfa-2026-10-v2", dryRun = !process.argv.includes("--apply");
const result = await withStoreLock("auth", () => {
  const history = readData("security-migrations.json", []);
  if (history.some(record => record.id === migration)) return { alreadyApplied: true };
  const users = readUsers(), privileged = new Set(users.filter(isStaff).map(user => user.id)), sessions = readSessions();
  const old = readData("auth-security.json", {});
  const result = { dryRun, privilegedAccounts: privileged.size, revokedPrivilegedSessions: sessions.filter(session => privileged.has(session.userId)).length,
    preservedMemberSessions: sessions.filter(session => !privileged.has(session.userId)).length, retiredAppEnrollments: Object.keys(old.accounts ?? {}).length };
  if (dryRun) return result;
  if (!/^[a-f0-9]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY ?? "")) throw new Error("MFA_ENCRYPTION_KEY を先に設定してください。");
  const backup = process.argv.find(arg => arg.startsWith("--backup="))?.slice(9) ?? path.join(path.dirname(path.dirname(dataPath("users.json"))), `email-mfa-backup-${Date.now()}`);
  const data = path.dirname(dataPath("users.json"));
  if (!path.isAbsolute(backup) || path.resolve(backup) === data || path.resolve(backup).startsWith(data + path.sep)) throw new Error("バックアップは会員データの外に保存してください。");
  fs.mkdirSync(backup, { mode: 0o700 });
  for (const name of ["users.json", "sessions.json", "auth-security.json", "security-migrations.json"]) {
    const file = dataPath(name); if (!fs.existsSync(file)) continue;
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error("データファイルのリンクを確認してください。");
    fs.copyFileSync(file, path.join(backup, name), fs.constants.COPYFILE_EXCL); fs.chmodSync(path.join(backup, name), 0o600);
  }
  // The new session method also rejects old privileged sessions if cleanup is interrupted.
  writeMfaState(emptyMfaState()); writeData("sessions.json", sessions.filter(session => !privileged.has(session.userId)));
  history.push({ id: migration, at: new Date().toISOString(), ...result }); writeData("security-migrations.json", history);
  return { ...result, backup };
});
if (!dryRun && !result.alreadyApplied) await audit("vps-security-operator", "auth.mfa.email.migrate", migration);
console.log(JSON.stringify(result));
