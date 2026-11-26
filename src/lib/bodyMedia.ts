import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import sanitizeHtml from "sanitize-html";
import { bodyMediaId, bodyMediaKinds, type BodyMediaScope } from "../types/bodyMedia.ts";
import { ContentManagementError } from "./contentManagement.ts";
import { dataPath, readData, writeData } from "./store.ts";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const stagedLifetime = 24 * 60 * 60_000;

export type BodyAsset = {
  id: string; scope: BodyMediaScope; uploader: string; createdAt: number;
  kind: "image" | "file"; mime: string; name: string;
};

export function parseBodyMediaScope(input: unknown): BodyMediaScope {
  const value = input as Partial<BodyMediaScope> | null;
  if (!value || typeof value.id !== "string" || !uuid.test(value.id) ||
      !bodyMediaKinds.includes(value.kind as BodyMediaScope["kind"]))
    throw new ContentManagementError("添付先を確認してください。");
  return { kind: value.kind!, id: value.id };
}

function assetFile(id: string, ext: "json" | "bin") {
  if (!uuid.test(id)) throw new ContentManagementError("添付ファイルが見つかりません。", 404);
  return `body-media-${id}.${ext}`;
}

export function readBodyAsset(id: string) {
  return readData<BodyAsset | null>(assetFile(id, "json"), null);
}

export function bodyAssetBytes(asset: BodyAsset) {
  return readFileSync(dataPath(assetFile(asset.id, "bin")));
}

export function stageBodyAsset(scope: BodyMediaScope, uploader: string, file: File, kind: BodyAsset["kind"], bytes: Buffer) {
  const id = randomUUID();
  const asset: BodyAsset = { id, scope, uploader, createdAt: Date.now(), kind, mime: file.type, name: file.name };
  const path = dataPath(assetFile(id, "bin"));
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, bytes, { mode: 0o600, flag: "wx", flush: true });
    writeData(assetFile(id, "json"), asset);
    return `/api/member/body-media/${id}`;
  } catch (error) {
    rmSync(path, { force: true });
    throw error;
  }
}

export function bodyAssetReferences(html?: string) {
  const result = new Map<string, "image" | "file">();
  if (!html) return result;
  const ref = (value: string, kind: "image" | "file") => {
    const id = bodyMediaId(value);
    if (id) {
      // An image must be a validated raster upload, even when the same ID
      // also appears in a download link.
      if (!result.has(id) || kind === "image") result.set(id, kind);
    }
  };
  sanitizeHtml(html, {
    allowedTags: ["a", "img"], allowedAttributes: {},
    transformTags: {
      a: (tagName, attribs) => { ref(attribs.href ?? "", "file"); return { tagName, attribs }; },
      img: (tagName, attribs) => { ref(attribs.src ?? "", "image"); return { tagName, attribs }; },
    },
  });
  return result;
}

export function stagedForUser(asset: BodyAsset, userId?: string) {
  return !!userId && asset.uploader === userId && Date.now() - asset.createdAt < stagedLifetime;
}

export function checkBodyAssets(html: string, scope: BodyMediaScope, uploader: string, existing: (string | undefined)[] = []) {
  const refs = bodyAssetReferences(html);
  if (!refs.size) return true;
  const previous = new Set(existing.flatMap(value => [...bodyAssetReferences(value).keys()]));
  for (const [id, kind] of refs) {
    const asset = readBodyAsset(id);
    if (!asset || kind === "image" && asset.kind !== "image") return false;
    if (previous.has(id)) continue;
    if (asset.scope.kind !== scope.kind || asset.scope.id !== scope.id || !stagedForUser(asset, uploader)) return false;
  }
  return true;
}
