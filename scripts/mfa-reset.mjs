import readline from "node:readline/promises";
import { readUsers, readSessions } from "../src/lib/auth.ts";
import { writeData, withStoreLock } from "../src/lib/store.ts";
import { readMfaState, writeMfaState } from "../src/lib/mfaState.ts";
import { revokeUserPasswordResetTokens } from "../src/lib/passwordReset.ts";
import { audit } from "../src/lib/audit.ts";

if (!process.stdin.isTTY) throw new Error("本人確認を実施したVPS担当者が対話端末で実行してください。");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  const email = (await rl.question("本人確認済みの登録メールアドレス: ")).trim().toLowerCase();
  const reference = (await rl.question("本人確認記録の番号（個人情報を含めない）: ")).trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(reference)) throw new Error("記録番号を確認してください。");
  const user = readUsers().find(u => u.email.toLowerCase() === email && u.approved && ["admin", "staff"].includes(u.role));
  if (!user) throw new Error("対象の運営アカウントがありません。");
  console.log("このアカウントの認証中のコードと全セッションを失効し、パスワード再設定とメール確認を必須にします。");
  if (await rl.question("本人確認済みである場合に RESET と入力: ") !== "RESET") throw new Error("中止しました。");
  await withStoreLock("auth", () => {
    const users = readUsers(), current = users.find(u => u.id === user.id);
    if (!current || current.email !== user.email || current.role !== user.role) throw new Error("登録内容が変更されています。");
    current.mustResetPassword = true; current.authVersion = (current.authVersion ?? 0) + 1; writeData("users.json", users);
    writeData("sessions.json", readSessions().filter(s => s.userId !== user.id)); revokeUserPasswordResetTokens(user.id);
    const state = readMfaState(); delete state.deliveries[user.id];
    for (const [key, value] of Object.entries(state.challenges)) if (value.userId === user.id) delete state.challenges[key];
    for (const [key, value] of Object.entries(state.grants)) if (value.userId === user.id) delete state.grants[key];
    writeMfaState(state);
  });
  await audit("vps-verified-operator", `auth.mfa.offline-reset:${reference}`, user.id);
  console.log("失効しました。登録メールでパスワードを再設定し、次のログイン時にメールの確認コードを入力してください。");
} finally { rl.close(); }
