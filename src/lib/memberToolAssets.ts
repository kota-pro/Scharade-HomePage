import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import type { User } from "./auth.ts";
import { isStaff } from "./roles.ts";
import { dataPath, withStoreLock, writeData } from "./store.ts";
import {
  readTool,
  findTool,
  toolIds,
  toolId,
  ToolError,
  recipient,
  receptionOpen,
  viewQuestion,
  resultsFor,
  canReadResults,
} from "./memberTools.ts";
import type { MemberTool, ToolAsset } from "./memberToolTypes.ts";
export const toolAssetPath = (id: string) =>
  dataPath(`member-tool-asset-${toolId(id)}.bin`);
const maximum = 20 * 1024 * 1024;
export async function saveToolAsset(
  id: string,
  user: User,
  file: File,
  purpose: "option" | "response",
) {
  if (!file.size || file.size > maximum)
    throw new ToolError("ファイルは1件20 MB以内にしてください。", 413);
  const t = readTool(id);
  if (
    purpose === "option"
      ? !isStaff(user) &&
        !(recipient(t, user) && receptionOpen(t) && t.settings.allowOptions)
      : !(recipient(t, user) && receptionOpen(t) && t.kind === "box")
  )
    throw new ToolError("ファイルを追加できません。", 403);
  let bytes = Buffer.from(await file.arrayBuffer()),
    mime = "",
    name =
      file.name.replace(/[\x00-\x1f\x7f/\\]/g, "_").slice(0, 180) ||
      "添付ファイル";
  const ext = name.split(".").pop()?.toLowerCase();
  if (
    ["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif"].includes(
      ext || "",
    )
  ) {
    try {
      bytes = await sharp(bytes, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 85 })
        .toBuffer();
      mime = "image/webp";
      name = name.replace(/\.[^.]*$/, ".webp");
    } catch {
      throw new ToolError(
        "この画像を読み込めません。JPEG・PNG・WebPなどの画像を選んでください。",
      );
    }
  } else if (purpose === "option")
    throw new ToolError("選択肢には画像を選んでください。");
  else if (ext === "pdf" && bytes.subarray(0, 5).toString() === "%PDF-")
    mime = "application/pdf";
  else if (
    ["docx", "xlsx", "pptx"].includes(ext || "") &&
    bytes.length >= 4 &&
    bytes.readUInt32LE(0) === 0x04034b50 &&
    bytes.includes(Buffer.from("[Content_Types].xml"))
  ) {
    mime = (
      {
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      } as Record<string, string>
    )[ext!];
  } else if (
    ["doc", "xls", "ppt"].includes(ext || "") &&
    bytes.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))
  )
    mime = (
      {
        doc: "application/msword",
        xls: "application/vnd.ms-excel",
        ppt: "application/vnd.ms-powerpoint",
      } as Record<string, string>
    )[ext!];
  else if (
    ["txt", "csv", "tsv", "md"].includes(ext || "") &&
    !bytes.includes(0)
  ) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      mime = "text/plain";
    } catch {
      throw new ToolError("テキストはUTF-8形式で保存してください。");
    }
  }
  if (!mime)
    throw new ToolError(
      "画像、PDF、Word、Excel、PowerPoint、テキストに対応しています。",
    );
  return withStoreLock(`member-tool-${id}`, () => {
    const fresh = readTool(id);
    if (
      purpose === "option"
        ? !isStaff(user) &&
          !(
            recipient(fresh, user) &&
            receptionOpen(fresh) &&
            fresh.settings.allowOptions
          )
        : !(
            recipient(fresh, user) &&
            receptionOpen(fresh) &&
            fresh.kind === "box"
          )
    )
      throw new ToolError("現在はアップロードできません。", 403);
    const mine = fresh.assets.filter((a) => a.ownerId === user.id);
    const referenced = new Set([
      ...fresh.responses.flatMap((r) => r.assetIds),
      ...fresh.options.map((o) => o.imageId),
    ]);
    if (
      mine.filter((a) => !referenced.has(a.id)).length >= 20 ||
      mine.reduce((n, a) => n + a.bytes, 0) + bytes.length > 500 * 1024 * 1024
    )
      throw new ToolError(
        "保存できるファイル数または容量を超えています。不要な添付を削除してからお試しください。",
        413,
      );
    const a: ToolAsset = {
      id: crypto.randomUUID(),
      ownerId: user.id,
      name,
      mime,
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
      purpose,
    };
    fs.writeFileSync(toolAssetPath(a.id), bytes, { mode: 0o600, flag: "wx" });
    fresh.assets.push(a);
    writeData(`member-tool-${id}.json`, fresh);
    return { id: a.id, name: a.name, mime: a.mime };
  });
}
export function authorizedToolAsset(
  t: MemberTool,
  assetId: string,
  user?: User | null,
) {
  const a = t.assets.find((a) => a.id === assetId);
  if (!a) throw new ToolError("ファイルが見つかりません。", 404);
  const option = t.options.some((o) => !o.removed && o.imageId === a.id);
  const mine = user?.approved && a.ownerId === user.id;
  let published = false;
  if (canReadResults(t, user))
    published = resultsFor(t, user).responses.some((r) =>
      r.assetIds.includes(a.id),
    );
  if (!mine && !(option && viewQuestion(t, user)) && !published)
    throw new ToolError("ファイルを表示する権限がありません。", 403);
  return a;
}
export async function cleanUnusedToolAssets(now = Date.now()) {
  for (const id of toolIds())
    await withStoreLock(`member-tool-${id}`, () => {
      const t = findTool(id);
      if (!t) return;
      const refs = new Set([
        ...t.responses.flatMap((r) => r.assetIds),
        ...t.options.filter((o) => !o.removed).map((o) => o.imageId),
      ]);
      const expired = t.assets.filter(
        (a) => !refs.has(a.id) && Date.parse(a.createdAt) < now - 86400000,
      );
      if (!expired.length) return;
      t.assets = t.assets.filter((a) => !expired.includes(a));
      writeData(`member-tool-${id}.json`, t);
      for (const a of expired) fs.rmSync(toolAssetPath(a.id), { force: true });
    });
}
export function toolAssetDTO(t: MemberTool, ids: string[]) {
  return t.assets
    .filter((a) => ids.includes(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      mime: a.mime,
      url: `/api/member/tools/${t.id}/assets/${a.id}`,
    }));
}
