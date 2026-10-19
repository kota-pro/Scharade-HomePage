import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const file = path.resolve(process.argv[2] ?? ".env");
if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) throw new Error("実ファイルの .env を指定してください。");
let text = fs.readFileSync(file, "utf8");
const added = [];
const configured = [];
for (const name of ["MFA_ENCRYPTION_KEY", "GALLERY_SIGNING_SECRET"]) {
  const found = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = found?.[1].trim().replace(/^(['"])(.*)\1$/, "$2") ?? "";
  if (value) { if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`${name} の形式を確認してください。既存の鍵は上書きしません。`); continue; }
  const line = `${name}=${crypto.randomBytes(32).toString("hex")}`;
  text = found ? text.replace(new RegExp(`^${name}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  added.push(name);
}
if (process.argv.includes("--production")) {
  for (const [name, value] of Object.entries({ SITE_URL: "https://scharade.jp", HOST: "127.0.0.1", PORT: "4321", TRUST_PROXY: "1" })) {
    const found = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    if (found?.[1].trim() === value) continue;
    text = found ? text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
    configured.push(name);
  }
}
if (added.length || configured.length) {
  const backup = `${file}.before-security-${Date.now()}`;
  fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL); fs.chmodSync(backup, 0o600);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, text, { mode: 0o600, flag: "wx" }); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
fs.chmodSync(file, 0o600);
console.log(JSON.stringify({ created: added, configured, valuesPrinted: false }));
