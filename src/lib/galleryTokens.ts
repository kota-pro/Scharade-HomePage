import crypto from "node:crypto";
import { env } from "./config.ts";

type Claim = {
  kind: "cursor" | "photo";
  album: string;
  id?: string;
  url?: string;
  staffPreview?: true;
  exp?: number;
};
function signature(body: string) {
  const secret = env("GALLERY_SIGNING_SECRET");
  if (secret.length < 32) throw new Error("Gallery signing is not configured");
  return crypto
    .createHmac("sha256", secret)
    .update(`scharade-gallery-v1:${body}`)
    .digest();
}
/** Issued only for IDs read from the album-assets endpoint: proves membership. */
export function signGalleryValue(value: Claim) {
  const body = Buffer.from(
    JSON.stringify({ ...value, exp: Date.now() + 3_600_000 }),
  ).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
export function verifyGalleryValue(token: string, kind: Claim["kind"]): Claim {
  if (token.length > 4096) throw new Error("Invalid gallery token");
  const [body, mac, extra] = token.split(".");
  const actual = Buffer.from(mac || "", "base64url");
  const expected = signature(body || "");
  if (
    extra ||
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  )
    throw new Error("Invalid gallery token");
  const value = JSON.parse(
    Buffer.from(body, "base64url").toString("utf8"),
  ) as Claim;
  if (value.kind !== kind || !value.exp || value.exp < Date.now())
    throw new Error("Expired gallery token");
  return value;
}
export function photoLinks<T extends { id: string; name: string }>(album: string, photo: T, staffPreview?: true) {
  const proof = encodeURIComponent(
    signGalleryValue({ kind: "photo", album, id: photo.id, staffPreview }),
  );
  return {
    ...photo,
    src: `/api/images/${photo.id}?proof=${proof}`,
    full: `/api/images/full/${photo.id}?proof=${proof}`,
  };
}
