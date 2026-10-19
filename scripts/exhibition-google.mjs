import fs from "node:fs";
import crypto from "node:crypto";
import { parseEnv } from "node:util";

const file = ".env", [command = "check", url] = process.argv.slice(2);
const drive = command.endsWith("-drive"), mode = command.replace(/-drive$/, "");
const secretName = drive ? "EXHIBITION_DRIVE_WEBHOOK_SECRET" : "EXHIBITION_WEBHOOK_SECRET";
const urlName = drive ? "EXHIBITION_DRIVE_GAS_URL" : "EXHIBITION_GAS_URL";
let source = fs.readFileSync(file, "utf8");
Object.assign(process.env, parseEnv(source));
function save(name, value) {
  const next = source.split(/\r?\n/).filter(line => !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line)).join("\n").replace(/\n*$/, "\n") + `${name}=${value}\n`;
  const temp = `${file}.exhibition-${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, next, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
  source = next; process.env[name] = value;
}
try {
  if (mode === "prepare") {
    if (!process.env[secretName] || process.env[secretName].length < 32) save(secretName, crypto.randomBytes(32).toString("hex"));
    console.log("共有秘密鍵を準備しました。値は表示していません。");
  } else if (mode === "secret") {
    if ((process.env[secretName]?.length ?? 0) < 32) throw new Error("先に prepare を実行してください。");
    // Run this interactively only when copying into Apps Script properties.
    process.stdout.write(process.env[secretName]);
  } else if (mode === "connect" || mode === "check") {
    if (mode === "connect") {
      if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new Error("/exec で終わるWebアプリURLを指定してください。");
      process.env[urlName] = url;
    }
    const { checkExhibitionGoogleConnection, exhibitionGoogleConfigured } = await import("../src/lib/exhibitionIntegrations.ts");
    if (!exhibitionGoogleConfigured(drive ? "exhibition-drive" : "legacy")) throw new Error("WebアプリURLと共有秘密鍵が未設定です。prepare と connect を完了してください。");
    const result = await checkExhibitionGoogleConnection(drive ? "exhibition-drive" : "legacy");
    if (result.gatewayVersion !== (drive ? 3 : 2) || result.formsApi !== true) throw new Error("Apps Scriptを最新のコードで再デプロイしてください。");
    if (mode === "connect") save(urlName, url);
    console.log("Google連携の署名認証とForms APIを確認しました。");
  } else throw new Error("prepare / secret / connect URL / check を指定してください。");
} catch (error) {
  console.error(`Google連携設定：${error instanceof Error ? error.message : "失敗しました。"}`);
  process.exitCode = 1;
}
