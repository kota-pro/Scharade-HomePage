import "./require-secure-runtime.mjs";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { readUsers, updateUsers } from "../src/lib/auth.ts";
import { hashPassword, validNewPassword } from "../src/lib/passwords.ts";
import { PASSWORD_REQUIREMENTS, PASSWORD_POLICY_ERROR } from "../src/lib/passwordPolicy.ts";
import { audit } from "../src/lib/audit.ts";

if (!process.stdin.isTTY)
  throw new Error("対話可能なVPSターミナルで実行してください。");
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) process.stdout.write(chunk);
    done();
  },
});
const rl = readline.createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
try {
  const mode = process.argv.includes("--password") ? "password" : "create";
  const email = (await rl.question("管理用メールアドレス: "))
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("メールアドレスを確認してください。");
  const existing = readUsers().find((u) => u.email.toLowerCase() === email);
  if (mode === "create" && existing)
    throw new Error(
      "登録済みメールです。個人会員を昇格せず、専用メールで作成してください。",
    );
  if (mode === "password" && existing?.role !== "admin")
    throw new Error("管理アカウントが見つかりません。");
  const name =
    mode === "create"
      ? (await rl.question("ログイン表示名（例: サイト管理）: ")).trim()
      : existing.name;
  if (!name || name.length > 80)
    throw new Error("表示名は1〜80文字で指定してください。");
  process.stdout.write(`${PASSWORD_REQUIREMENTS}\nパスワード（非表示）: `);
  muted = true;
  const password = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  process.stdout.write("パスワードを再入力: ");
  muted = true;
  const confirmation = await rl.question("");
  muted = false;
  process.stdout.write("\n");
  if (password !== confirmation) throw new Error("パスワードが一致しません。");
  if (!validNewPassword(password)) throw new Error(PASSWORD_POLICY_ERROR);
  if (mode === "password") {
    await updateUsers((users) => {
      const user = users.find((u) => u.id === existing.id);
      if (!user || user.role !== "admin")
        throw new Error("アカウントを確認してください。");
      user.passwordHash = hashPassword(password);
      delete user.mustResetPassword;
      user.authVersion = (user.authVersion ?? 0) + 1;
    });
    await audit(existing.id, "admin.password.rotate", existing.id);
    console.log("パスワードを更新し、既存セッションを無効にしました。");
  } else {
    const domain = process.env.MICROCMS_SERVICE_DOMAIN,
      key = process.env.MICROCMS_SERVER_API_KEY,
      endpoint = process.env.MICROCMS_PORTFOLIO_ENDPOINT || "portfolio";
    if (!domain || !key) throw new Error("microCMS環境変数が不足しています。");
    const supplied = (
      await rl.question("既存の専用Portfolio ID（空欄なら作成）: ")
    ).trim();
    if (supplied && !/^[a-zA-Z0-9_-]{1,128}$/.test(supplied))
      throw new Error("IDの形式を確認してください。");
    if (supplied && readUsers().some((u) => u.portfolioId === supplied))
      throw new Error("他のアカウントが使っているPortfolioです。");
    let portfolioId = supplied;
    const url = `https://${domain}.microcms.io/api/v1/${endpoint}${supplied ? `/${supplied}` : ""}`;
    const response = await fetch(url, {
      method: supplied ? "GET" : "POST",
      headers: {
        "X-MICROCMS-API-KEY": key,
        "Content-Type": "application/json",
      },
      ...(supplied
        ? {}
        : {
            body: JSON.stringify({
              name,
              pictures: [],
              hashtags: [],
              self_introduction: "サイト管理用Portfolio",
            }),
          }),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Portfolioの準備に失敗しました（${response.status}）。microCMSの権限と必須フィールドを確認してください。`,
      );
    if (!supplied) {
      const created = await response.json();
      if (typeof created.id !== "string" || !created.id)
        throw new Error("作成したPortfolioのIDを確認できませんでした。");
      portfolioId = created.id;
    }
    console.log(
      `専用Portfolio ID: ${portfolioId}（後続保存が失敗した場合はこのIDで再実行できます）`,
    );
    const id = crypto.randomUUID();
    await updateUsers((users) => {
      if (
        users.some(
          (u) =>
            u.email.toLowerCase() === email || u.portfolioId === portfolioId,
        )
      )
        throw new Error("同じメールまたはPortfolioが使用されています。");
      users.push({
        id,
        name,
        email,
        passwordHash: hashPassword(password),
        approved: true,
        role: "admin",
        siteManagement: true,
        portfolioId,
        portfolioName: name,
        authVersion: 0,
        providers: { credentials: true },
        createdAt: new Date().toISOString(),
      });
    });
    await audit(id, "admin.bootstrap", portfolioId);
    console.log(
      "専用管理アカウントを作成しました。サイトの /Login からログインしてください。",
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  muted = false;
  rl.close();
}
