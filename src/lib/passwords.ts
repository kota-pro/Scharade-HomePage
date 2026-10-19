import crypto from "node:crypto";

const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export { MIN_PASSWORD_LENGTH, validNewPassword } from "./passwordPolicy.ts";
function encode(salt: Buffer, hash: Buffer) {
  return `scrypt-v2$32768$8$3$${salt.toString("base64")}$${hash.toString("base64")}`;
}
/** Synchronous helper for offline CLI/fixtures only. HTTP handlers use the async helpers. */
export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  return encode(salt, crypto.scryptSync(password, salt, 32, parameters));
}
function derive(password: string, salt: Buffer, options?: typeof parameters) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 32, options ?? {}, (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function hashPasswordAsync(password: string) {
  const salt = crypto.randomBytes(16);
  return encode(salt, await derive(password, salt, parameters));
}
function parse(stored: string) {
  const parts = stored.split("$");
  const modern = parts.length === 6 && parts.slice(0, 4).join("$") === "scrypt-v2$32768$8$3";
  if (!modern && !(parts.length === 3 && parts[0] === "scrypt")) return null;
  const salt = Buffer.from(parts[modern ? 4 : 1], "base64");
  const expected = Buffer.from(parts[modern ? 5 : 2], "base64");
  return salt.length === 16 && expected.length === 32 ? { salt, expected, modern } : null;
}
export function needsPasswordRehash(stored: string) { return !parse(stored)?.modern; }
export function verifyPassword(password: string, stored: string) {
  if (password.length > 1024) return false;
  try {
    const value = parse(stored);
    return !!value && crypto.timingSafeEqual(crypto.scryptSync(password, value.salt, 32, value.modern ? parameters : {}), value.expected);
  } catch { return false; }
}
// Fixed non-account hash: failed account lookups still perform a password KDF.
const dummyHash = hashPassword("non-account-password-verification");
export async function verifyPasswordAsync(password: string, stored = dummyHash) {
  if (password.length > 1024) return false;
  try {
    const value = parse(stored);
    if (!value) { await derive(password, Buffer.alloc(16), parameters); return false; }
    return crypto.timingSafeEqual(await derive(password, value.salt, value.modern ? parameters : undefined), value.expected);
  } catch { return false; }
}
