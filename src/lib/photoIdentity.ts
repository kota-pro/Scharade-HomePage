import crypto from "node:crypto";
import { safeMediaUrl } from "./contentSecurity.ts";
import type { PhotoRef } from "../types/photos.ts";
export function cmsPhotoId(url: string) {
  const safe = safeMediaUrl(url);
  if (!safe) throw new Error("写真のURLを確認してください。");
  const source = new URL(safe); source.search = ""; source.hash = "";
  return crypto.createHash("sha256").update(source.href).digest("hex");
}
export const photoRefKey = (ref: PhotoRef) => `${ref.source}:${ref.containerId}:${ref.imageId}`;
export function parsePhotoRef(input: unknown): PhotoRef {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("写真を選択してください。");
  const ref = input as PhotoRef;
  if (!["portfolio", "blog", "gallery"].includes(ref.source) || typeof ref.containerId !== "string" || typeof ref.imageId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.containerId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(ref.imageId) || (ref.proof !== undefined && (typeof ref.proof !== "string" || ref.proof.length > 4096))) throw new Error("写真の識別情報を確認してください。");
  return { source: ref.source, containerId: ref.containerId, imageId: ref.imageId, ...(ref.proof ? { proof: ref.proof } : {}) };
}
