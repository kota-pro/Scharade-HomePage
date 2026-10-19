import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { signedEnvelope } from "../src/lib/signedEnvelope.ts";

// Run from the release with --env-file=.env. Output names/statuses, never values.
const failures = [];
const requireValue = name => { if (!process.env[name]) failures.push(`${name}: missing`); return process.env[name] ?? ""; };
for (const name of ["MICROCMS_SERVICE_DOMAIN", "MICROCMS_SERVER_API_KEY", "GMAIL_PASS", "SIGNUP_REVIEW_SECRET"]) requireValue(name);
if ((process.env.SIGNUP_REVIEW_SECRET ?? "").length < 32) failures.push("SIGNUP_REVIEW_SECRET: too short");
// Hobby has one credential. The application only accepts the explicitly
// configured replacement; legacy variables cannot silently keep it running.
const cms = [process.env.MICROCMS_SERVER_API_KEY];
if (cms[0] && cms[0] === process.env.MICROCMS_API_KEY) failures.push("microCMS: old key still in use");
if (!/^[a-f0-9]{64}$/i.test(requireValue("MFA_ENCRYPTION_KEY"))) failures.push("MFA_ENCRYPTION_KEY: invalid format");
if (requireValue("GALLERY_SIGNING_SECRET").length < 32) failures.push("GALLERY_SIGNING_SECRET: too short");
if ([process.env.MFA_ENCRYPTION_KEY, process.env.ADOBE_CLIENT_SECRET].some(value => value && value === process.env.GALLERY_SIGNING_SECRET)) failures.push("GALLERY_SIGNING_SECRET: must be independent");
if (process.env.TRUST_PROXY !== "1") failures.push("TRUST_PROXY: must be 1 behind the reviewed Nginx configuration");
if (process.env.HOST !== "127.0.0.1") failures.push("HOST: must be loopback");
if (process.env.SITE_URL !== "https://scharade.jp") failures.push("SITE_URL: must be the canonical HTTPS origin");
const data = path.resolve(requireValue("DATA_DIR"));
if (data === process.cwd() || data.startsWith(process.cwd() + path.sep)) failures.push("DATA_DIR: must be outside the application checkout");
for (const [file, expected] of [[".env", 0o600], [data, 0o700]]) {
  try {
    const state = fs.lstatSync(file);
    if (state.isSymbolicLink() || (state.mode & 0o777) !== expected || state.uid !== process.getuid()) failures.push(`${file === data ? "DATA_DIR" : ".env"}: ownership permissions or link require review`);
  } catch { failures.push(`${file === data ? "DATA_DIR" : ".env"}: unavailable`); }
}
const historicalKeyFingerprint = process.argv.find(arg => arg.startsWith("--old-cms-fingerprint="))?.slice(22);
if (historicalKeyFingerprint && (!/^[a-f0-9]{64}$/.test(historicalKeyFingerprint) || cms.some(key => key && crypto.createHash("sha256").update(key).digest("hex") === historicalKeyFingerprint))) failures.push("microCMS: historical key fingerprint still matches");
if (!failures.length && !process.argv.includes("--offline")) {
  for (const name of ["ACCOUNTING_GAS_URL", "EXHIBITION_GAS_URL", "EXHIBITION_DRIVE_GAS_URL"]) {
    const value = process.env[name]; if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.hostname !== "script.google.com" || url.username || url.password || url.search) throw new Error();
      const secret = requireValue(name.replace(/GAS_URL$/, "WEBHOOK_SECRET"));
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(signedEnvelope({ action: "health" }, secret)), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok || result.ok !== true || result.envelopeVersion !== 2) failures.push(`${name}: deployed gateway is not envelope v2`);
    } catch { failures.push(`${name}: health check failed`); }
  }
}
console.log(JSON.stringify({ ready: failures.length === 0, failures }));
if (failures.length) process.exitCode = 1;
