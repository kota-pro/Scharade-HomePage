import crypto from "node:crypto";
import type { APIContext } from "astro";
import { requestIdentity } from "./requestIdentity.ts";
export function photoVisitor(context: Pick<APIContext, "cookies" | "url">, create = true) {
  const view = requestIdentity();
  if (view) return crypto.createHash("sha256").update(`admin-view:${view.key}`).digest("hex");
  const secure = context.url.protocol === "https:", name = secure ? "__Host-photo-visitor" : "photo-visitor";
  let value = context.cookies.get(name)?.value;
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    if (!create) return "";
    value = crypto.randomBytes(32).toString("base64url");
    context.cookies.set(name, value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  }
  return crypto.createHash("sha256").update(value).digest("hex");
}
