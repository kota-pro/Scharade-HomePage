const layoutBuckets=new Map<string,{count:number;until:number}>();
import crypto from "node:crypto";
import type { APIContext } from "astro";
import { readData, writeData, withStoreLock } from "./store.ts";
import { env } from "./config.ts";
import { isIP } from "node:net";

type Bucket = { count: number; until: number };
type Context = Pick<APIContext, "request" | "url" | "locals" | "clientAddress">;
function clientIdentity(context: Context) {
  const forwarded = env("TRUST_PROXY") === "1" ? context.request.headers.get("x-real-ip") : null;
  if (forwarded && isIP(forwarded)) return forwarded;
  try { return context.clientAddress; } catch { return "unknown"; }
}
function bucketKey(value: string) { return crypto.createHash("sha256").update(value).digest("hex"); }
function activeBuckets() {
  const buckets = readData<Record<string, Bucket>>("rate-limit.json", {});
  for (const [key, bucket] of Object.entries(buckets)) if (bucket.until <= Date.now()) delete buckets[key];
  return buckets;
}
export async function checkLoginAttempts(context: Context, email: string) {
  return withStoreLock("rate-limit", () => {
    const buckets = activeBuckets();
    const keys = [bucketKey(`auth-account:${email}`), bucketKey(`auth-ip:${clientIdentity(context)}`)];
    if ((buckets[keys[0]]?.count ?? 0) >= 5 || (buckets[keys[1]]?.count ?? 0) >= 20 || Object.keys(buckets).length > 10000) return false;
    for (const key of keys) { const bucket = buckets[key] ?? { count: 0, until: Date.now() + 15 * 60_000 }; bucket.count++; buckets[key] = bucket; }
    writeData("rate-limit.json", buckets); return true;
  });
}
export async function recordLoginAttempt(_context: Context, email: string, success: boolean) {
  return withStoreLock("rate-limit", () => {
    const buckets = activeBuckets(), account = bucketKey(`auth-account:${email}`);
    if (success) delete buckets[account];
    // Failure reservations were already counted atomically before the KDF.
    writeData("rate-limit.json", buckets);
  });
}
export async function checkReauthentication(userId: string) {
  return withStoreLock("rate-limit", () => {
    const buckets = activeBuckets(), key = bucketKey(`mfa-management:${userId}`);
    const bucket = buckets[key] ?? { count: 0, until: Date.now() + 15 * 60_000 };
    if (bucket.count >= 5 || Object.keys(buckets).length > 10000) return false;
    bucket.count++; buckets[key] = bucket; writeData("rate-limit.json", buckets); return true;
  });
}
export async function checkPasswordResetRequest(email: string) {
  return withStoreLock("rate-limit", () => {
    const buckets = activeBuckets(), key = bucketKey(`password-reset:${email}`);
    const bucket = buckets[key] ?? { count: 0, until: Date.now() + 15 * 60_000 };
    if (bucket.count >= 5 || Object.keys(buckets).length >= 10000) return false;
    bucket.count++; buckets[key] = bucket; writeData("rate-limit.json", buckets); return true;
  });
}
export async function checkSignupCodeRequest(email: string) {
  return withStoreLock("rate-limit", () => {
    const buckets = activeBuckets(), key = bucketKey(`signup-email:${email}`);
    const bucket = buckets[key] ?? { count: 0, until: Date.now() + 15 * 60_000 };
    if (bucket.count >= 5 || Object.keys(buckets).length >= 10000) return false;
    bucket.count++; buckets[key] = bucket; writeData("rate-limit.json", buckets); return true;
  });
}
export async function checkRateLimit(
  context: Pick<APIContext, "request" | "url" | "locals" | "clientAddress">,
) {
  // Dynamic IDs cannot create fresh buckets for the same expensive operation.
  const p = context.url.pathname.replace(/\/exhibitions\/[^/]+/g, "/exhibitions/:id").replace(/\/accounts\/[^/]+/g, "/accounts/:id")
    .replace(/^\/api\/member\/gallery\/[^/]+/, "/api/member/gallery/:id")
    .replace(/^\/api\/member\/blog\/articles\/[^/]+/, "/api/member/blog/articles/:id");
  if(/^\/api\/member\/exhibitions\/:id\/layout(?:\/(?:lease|presence))?$/.test(p)) {
    const now=Date.now(),presence=p.endsWith('/presence'),identity=context.locals.user?.id??clientIdentity(context),key=`${p}:${identity}`;
    if(layoutBuckets.size>10000)for(const [k,v] of layoutBuckets)if(v.until<=now)layoutBuckets.delete(k);
    const bucket=layoutBuckets.get(key);const current=!bucket||bucket.until<=now?{count:0,until:now+(presence?1000:60000)}:bucket;
    if(!bucket&&layoutBuckets.size>=10000)return false;current.count++;layoutBuckets.set(key,current);return current.count<=(presence?40:300);
  }
  const sensitive =
    p === "/api/contact" ||
    p === "/api/account-deletion" ||
    p.includes("/signup") ||
    p.includes("/password-reset/");
  // Photo state is a read operation (batched to keep signed references out of URLs).
  // Browsing and hovering a large album must not consume a write-sized allowance.
  const limit = p.endsWith("/login") || p === "/api/member/receipts/upload" ? 20 : sensitive ? 8 : p === "/api/photos/state" ? 600 : p === "/api/member/activities" ? 300 : 100;
  // The VPS reverse proxy must overwrite X-Real-IP before TRUST_PROXY is enabled.
  const address = clientIdentity(context);
  const identity = p.endsWith("/login") ? address : context.locals.user?.id ?? address;
  const key = crypto
    .createHash("sha256")
    .update(`${p}:${identity}`)
    .digest("hex");
  return withStoreLock("rate-limit", () => {
    const now = Date.now();
    const all = readData<Record<string, Bucket>>("rate-limit.json", {});
    for (const [key, bucket] of Object.entries(all))
      if (bucket.until <= now) delete all[key];
    if (!all[key] && Object.keys(all).length >= 10000) return false;
    const bucket = all[key] ?? { count: 0, until: now + 10 * 60 * 1000 };
    bucket.count++;
    all[key] = bucket;
    writeData("rate-limit.json", all);
    return bucket.count <= limit;
  });
}
