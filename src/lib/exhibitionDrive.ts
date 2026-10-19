import {layoutAssetPath} from "./exhibitionLayoutAssets.ts";
import fs from "node:fs";
import crypto from "node:crypto";
import { dataPath } from "./store.ts";
import { exhibitionAssetPath, findExhibition, readExhibitions, updateExhibitionStore } from "./exhibitions.ts";
import { exhibitionGoogleConfigured, postExhibitionGas, exhibitionDriveOwner } from "./exhibitionGoogleGateway.ts";
import type { Exhibition, DriveDelivery, ExhibitionOutput } from "./exhibitionTypes.ts";

const CHUNK_BYTES = 1024 * 1024;
const post = (value: object) => postExhibitionGas(value, 60000, "exhibition-drive");
const yearOf = (e: Exhibition) => e.year ?? new Date(Date.parse(e.createdAt) + 9 * 3600000).getUTCFullYear();
const pending = (): DriveDelivery => ({ status: "pending", attempts: 0, nextAttemptAt: 0 });
export function exhibitionOutputPath(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("output");
  return dataPath(`exhibition-output-${id}.bin`);
}
export async function archiveExhibitionOutput(exhibitionId: string, kind: string, name: string, mimeType: string, bytes: Uint8Array, roomId?: string, sourceKey?: string) {
  if (!bytes.length || bytes.length > 80 * 1024 * 1024) throw new Error("output-size");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return updateExhibitionStore(store => {
    findExhibition(store, exhibitionId);
    store.outputs ??= [];
    const known = store.outputs.find(o => o.exhibitionId === exhibitionId && o.kind === kind && o.roomId === roomId && o.sourceKey === sourceKey && o.sha256 === sha256);
    if (known) return known;
    const id = crypto.randomUUID();
    fs.writeFileSync(exhibitionOutputPath(id), bytes, { mode: 0o600, flag: "wx" });
    const output: ExhibitionOutput = { id, exhibitionId, kind, name: name.slice(0, 180), mimeType, bytes: bytes.length, sha256, createdAt: new Date().toISOString(), drive: pending(), ...(roomId ? { roomId } : {}), ...(sourceKey ? { sourceKey } : {}) };
    store.outputs.push(output);
    return output;
  });
}
export async function ensureExhibitionDriveFolders(exhibitionId: string) {
  const e = findExhibition(readExhibitions(), exhibitionId), year = yearOf(e);
  if (e.driveFolders?.title === e.title && e.driveFolders.year === year && e.driveFolders.yearFolderName === `${year}年`) return e.driveFolders;
  const result = await post({ action: "folders.ensure", exhibitionId, year, exhibitionTitle: e.title });
  if (result.owner !== exhibitionDriveOwner || result.yearFolderName !== `${year}年` || !["folderId", "originalsId", "layoutsId", "outputsId"].every(key => typeof result[key] === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(result[key]))) throw new Error("drive-folders-response");
  return updateExhibitionStore(store => {
    const current = findExhibition(store, exhibitionId);
    if (current.title !== e.title || yearOf(current) !== year) throw new Error("drive-folder-settings-changed");
    current.driveFolders = { folderId: result.folderId, originalsId: result.originalsId, layoutsId: result.layoutsId, outputsId: result.outputsId, title: e.title, year, yearFolderName: result.yearFolderName };
    return current.driveFolders;
  });
}
type FileKind = "asset" | "output" | "layout-asset";
const record = (store: ReturnType<typeof readExhibitions>, kind: FileKind, id: string) => kind === "asset" ? store.assets.find(a => a.id === id) : kind === "layout-asset" ? store.layoutAssets?.find(a=>a.id===id) : store.outputs?.find(o => o.id === id);
export async function deliverExhibitionDriveFile(kind: FileKind, id: string) {
  if (!exhibitionGoogleConfigured("exhibition-drive")) return false;
  const leaseToken = crypto.randomUUID();
  const item = await updateExhibitionStore(store => {
    const item = record(store, kind, id);
    if (!item) return null;
    item.drive ??= pending();
    if (item.drive.status === "delivered") return { done: true as const };
    if (item.drive.nextAttemptAt > Date.now() || (item.drive.leaseUntil ?? 0) > Date.now()) return null;
    item.drive.leaseToken = leaseToken; item.drive.leaseUntil = Date.now() + 150000; item.drive.attempts++;
    return { done: false as const, item: structuredClone(item), exhibition: structuredClone(findExhibition(store, item.exhibitionId)) };
  });
  if (!item) return false;
  if (item.done) return true;
  try {
    await ensureExhibitionDriveFolders(item.item.exhibitionId);
    const bytes = fs.readFileSync(kind === "asset" ? exhibitionAssetPath(id) : kind === "layout-asset" ? layoutAssetPath(id) : exhibitionOutputPath(id));
    if (bytes.length !== item.item.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== item.item.sha256) throw new Error("local-file-checksum");
    const metadata = { exhibitionId: item.item.exhibitionId, year: yearOf(item.exhibition), exhibitionTitle: item.exhibition.title, key: id, name: item.item.name, mimeType: item.item.mimeType, size: bytes.length, sha256: item.item.sha256, category: kind === "layout-asset" ? "layouts" : kind === "asset" ? "originals" : (item.item as ExhibitionOutput).kind === "series-layout" ? "layouts" : "outputs" };
    let result = await post({ action: "file.begin", ...metadata });
    for (let chunks = 0; !result.done; chunks++) {
      const offset = result.offset;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || chunks > Math.ceil(bytes.length / CHUNK_BYTES) + 10) throw new Error("drive-upload-progress");
      const owned = await updateExhibitionStore(store => {
        const state = record(store, kind, id)?.drive;
        if (!state || state.leaseToken !== leaseToken) return false;
        state.offset = offset; state.leaseUntil = Date.now() + 150000; return true;
      });
      if (!owned) throw new Error("lease");
      result = await post({ action: "file.chunk", key: id, sha256: item.item.sha256, offset, data: bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length)).toString("base64") });
    }
    if (typeof result.fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(result.fileId) || typeof result.url !== "string" || !/^https:\/\/drive\.google\.com\//.test(result.url) || result.owner !== exhibitionDriveOwner) throw new Error("drive-upload-response");
    await updateExhibitionStore(store => {
      const state = record(store, kind, id)?.drive;
      if (!state || state.leaseToken !== leaseToken) return;
      Object.assign(state, { status: "delivered", fileId: result.fileId, url: result.url, offset: bytes.length });
      delete state.error; delete state.leaseToken; delete state.leaseUntil; delete state.sessionUrl;
    });
    return true;
  } catch (error) {
    await updateExhibitionStore(store => {
      const state = record(store, kind, id)?.drive;
      if (!state || state.leaseToken !== leaseToken) return;
      state.error = error instanceof Error ? error.message.slice(0, 100) : "drive-upstream";
      state.nextAttemptAt = Date.now() + Math.min(15 * 60000, 30000 * 2 ** Math.min(state.attempts - 1, 5));
      delete state.leaseToken; delete state.leaseUntil;
    });
    return false;
  }
}
export async function drainExhibitionDriveFiles(limit = 20, stopped = () => false) {
  if (!exhibitionGoogleConfigured("exhibition-drive")) return { attempted: 0, delivered: 0 };
  const store = readExhibitions();
  for (const e of store.exhibitions) {
    if (stopped()) break;
    if (e.driveFolders && (e.driveFolders.title !== e.title || e.driveFolders.year !== yearOf(e) || e.driveFolders.yearFolderName !== `${yearOf(e)}年`)) { try { await ensureExhibitionDriveFolders(e.id); } catch { /* Retry a folder rename on the next worker interval. */ } }
  }
  const submitted = new Set(store.submissions.filter(s => !s.inactive).flatMap(s => s.versions.flatMap(v => v.content.works.flatMap(w => w.photos.map(p => p.assetId)))));
  const layoutReferences=new Set(store.exhibitions.flatMap(e=>[e.rooms,...(e.layoutHistory??[]).map(v=>v.rooms)].flatMap(rooms=>rooms.flatMap(r=>(r.annotations??[]).filter(a=>a.kind==="image").map(a=>a.assetId)))));
  const files: { kind: FileKind; id: string; drive?: DriveDelivery }[] = [
    ...store.assets.filter(a => submitted.has(a.id)).map(a => ({ kind: "asset" as const, id: a.id, drive: a.drive })),
    ...(store.layoutAssets??[]).filter(a=>layoutReferences.has(a.id)).map(a=>({kind:"layout-asset" as const,id:a.id,drive:a.drive})),
    ...(store.outputs ?? []).map(o => ({ kind: "output" as const, id: o.id, drive: o.drive })),
  ].filter(f => f.drive?.status !== "delivered" && (f.drive?.nextAttemptAt ?? 0) <= Date.now() && (f.drive?.leaseUntil ?? 0) <= Date.now()).slice(0, limit);
  let attempted = 0, delivered = 0;
  for (const file of files) { if (stopped()) break; attempted++; if (await deliverExhibitionDriveFile(file.kind, file.id)) delivered++; }
  return { attempted, delivered };
}
