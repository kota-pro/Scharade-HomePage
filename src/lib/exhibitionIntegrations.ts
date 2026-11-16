import { exhibitionNotesText } from "./exhibitionNotes.ts";
import crypto from "node:crypto";
import fs from "node:fs";
import { getAdobeAccessToken } from "./adobeAuth.ts";
import { ExhibitionError } from "./exhibitionValidation.ts";
import { env } from "./config.ts";
import { fetchWithTimeout } from "./http.ts";
import { exhibitionAssetPath, findExhibition, readExhibitions, updateExhibitionStore, requireStaff } from "./exhibitions.ts";
import {albumPhotoEligible,albumPhotoExcluded,currentExhibitionPhotos,parseAlbumExclusions} from './exhibitionAlbumPhotos.ts';
import { fieldApplies } from "./exhibitionValidation.ts";
import { currentSchema, type Exhibition, type ExhibitionStore, type FormSchema, type Submission, type SubmissionVersion } from "./exhibitionTypes.ts";
import { workLayoutPng } from "./exhibitionOutputs.ts";
import { layoutDescription } from "./exhibitionGeometry.ts";
import { importTitleBoardRows } from "./exhibitionSheetImport.ts";
import { appendExhibitionNotice } from "./activities.ts";
import { exhibitionGoogleConfigured, postExhibitionGas as postGas, checkExhibitionGoogleConnection } from "./exhibitionGoogleGateway.ts";
import { ensureExhibitionDriveFolders, deliverExhibitionDriveFile, archiveExhibitionOutput, drainExhibitionDriveFiles } from "./exhibitionDrive.ts";

const LR_BASE = "https://lr.adobe.io";
const lrClientId = () => env("ADOBE_CLIENT_ID");
const lrCatalogId = () => env("LIGHTROOM_CATALOG_ID");
export { exhibitionGoogleConfigured, checkExhibitionGoogleConnection } from "./exhibitionGoogleGateway.ts";
export function exhibitionLightroomConfigured() { return Boolean(lrClientId() && lrCatalogId() && env("ADOBE_CLIENT_SECRET") && env("ADOBE_REFRESH_TOKEN")); }
function formFields(schema: FormSchema) {
  const fixed = [
    ["submissionId", "提出ID"], ["version", "提出版"], ["workId", "作品ID"], ["deliveryKey", "送信識別子"], ["section", "展示セクション"], ["name", "名前"], ["grade", "学年"], ["authorName", "作者名"], ["portfolioUrl", "外部Portfolio URL"], ["singles", "単写真枚数"], ["series", "組写真作品数"], ["books", "ブック冊数"],
    ["kind", "作品種別"], ["title", "作品タイトル"], ["titleBoard", "タイトルボード表示設定"], ["caption", schema.captionLabel], ["location", "撮影場所"], ["equipment", "使用機材"], ["settings", "撮影設定"], ["place","地名"], ["prefecture","都道府県名"], ["region","国・地域"], ["camera","カメラ"], ["lens","レンズ"], ["film","フィルム"], ["shutterSpeed","シャッタースピード"], ["iso","ISO感度"], ["fNumber","F値"], ["layout", "レイアウト（サイズ・向き）"], ["layoutImage", "組写真レイアウト画像"], ["assets", "作品データ（Google Drive・Lightroom）"],
  ].map(([id, title]) => ({ id, title, paragraph: ["titleBoard", "caption", "location", "equipment", "settings", "place", "region", "camera", "lens", "film", "shutterSpeed", "iso", "fNumber", "layout", "assets"].includes(id), required: ["name", "grade", "authorName"].includes(id) }));
  return [...fixed, ...schema.fields.map(field => ({ id: `field:${field.id}`, title: `${field.label} [${field.scope}]`, paragraph: field.type === "paragraph", required: false })), { id: "notes", title: "その他ご意見、ご要望など", paragraph: true, required: false }];
}
async function answerRows(exhibition: Exhibition, submission: Submission, version: SubmissionVersion) {
  const schema = exhibition.schemas.find(s => s.version === version.schemaVersion)!;
  const content = version.content;
  const assets = new Map(readExhibitions().assets.filter(asset => asset.exhibitionId === exhibition.id).map(asset => [asset.id, asset]));
  return Promise.all(content.works.map(async work => {
    let layoutImage = "";
    if (work.kind === "series" && work.photos.length) {
      const output = await archiveExhibitionOutput(exhibition.id, "series-layout", `${work.title || "組写真"}-v${version.version}-配置.png`, "image/png", workLayoutPng(work), undefined, `${submission.id}:${version.version}:${work.id}`);
      if (!await deliverExhibitionDriveFile("output", output.id)) throw new Error("drive-layout-pending");
      layoutImage = readExhibitions().outputs?.find(o => o.id === output.id)?.drive.url ?? "";
    }
    const section = schema.sections.find(s => s.id === work.sectionId)?.title ?? "";
    const counts = content.sections.find(s => s.sectionId === work.sectionId);
    const answers: Record<string, string> = {
      submissionId: submission.id, version: String(version.version), workId: work.id, deliveryKey: `${submission.id}:${version.version}:${work.id}`, section, name: content.name, grade: content.grade, authorName: content.authorName, portfolioUrl: content.portfolioUrl, singles: String(counts?.singles ?? 0), series: String(counts?.series ?? 0), books: String(counts?.books ?? 0), kind: { single: "単写真", series: "組写真", book: "ブック" }[work.kind],
      title: work.title, titleBoard: work.titleBoard ? JSON.stringify(work.titleBoard) : "", caption: work.caption, location: work.location, equipment: work.equipment, settings: work.settings,
      ...(work.details ?? {}),
      ...(exhibitionNotesText(content) ? { notes: exhibitionNotesText(content) } : {}),
      layout: work.kind === "series" ? `${layoutDescription(work.photos)}\n${work.photos.map(p => `${p.width.toFixed(1)}×${p.height.toFixed(1)}mm @ ${p.x.toFixed(1)},${p.y.toFixed(1)} / ${p.rotation.toFixed(1)}°`).join("; ")}` : work.photos[0] ? `${work.photos[0].width.toFixed(1)}×${work.photos[0].height.toFixed(1)}mm / ${work.photos[0].rotation.toFixed(1)}°` : "",
      layoutImage,
      assets: work.photos.length ? [...(exhibition.albumCreated ? [`LightroomアルバムID: ${exhibition.albumId}`] : []), ...work.photos.map(photo => {
        const asset = assets.get(photo.assetId);
        return `${asset?.name ?? "写真"} / Google Drive: ${asset?.drive?.url ?? "保存待ち"} / 保存ID: ${photo.assetId}${asset?.albumAdded ? ` / Lightroom Asset ID: ${asset.lightroomId}` : ""}`;
      })].join("\n") : "",
    };
    for (const field of schema.fields) {
      if (!fieldApplies(field, field.scope, work.sectionId, work.kind)) continue;
      const value = field.scope === "common" ? content.fields[field.id] : field.scope === "section" ? content.sections.find(s => s.sectionId === work.sectionId)?.fields[field.id] : work.fields[field.id];
      answers[`field:${field.id}`] = Array.isArray(value) ? value.join("、") : value === undefined ? "" : String(value);
    }
    return { idempotencyKey: `${submission.id}:${version.version}:${work.id}`, answers, fieldLabels: Object.fromEntries(formFields(schema).map(f=>[f.id,f.title])) };
  }));
}
async function leaseIntegration(exhibitionId: string, key: "googleSync" | "albumSync", change?:(data:ExhibitionStore,e:Exhibition)=>void) {
  const token = crypto.randomUUID();
  return updateExhibitionStore(data => {
    const e = findExhibition(data, exhibitionId);
    if ((e[key]?.leaseUntil ?? 0) > Date.now()) throw new ExhibitionError("外部連携の設定を更新中です。少し待ってから確認してください。",409);
    change?.(data,e);
    e[key] = { ...e[key], pending: true, nextAttemptAt: 0, leaseToken: token, leaseUntil: Date.now()+180000 };
    return { exhibition: structuredClone(e), token };
  });
}
async function finishIntegration(exhibitionId: string,key: "googleSync" | "albumSync",token: string,error?: unknown) {
  await updateExhibitionStore(data => {
    const sync = data.exhibitions.find(e=>e.id===exhibitionId)?.[key];
    if (!sync || sync.leaseToken !== token) return;
    delete sync.leaseToken; delete sync.leaseUntil;
    if (error) { sync.pending=true; sync.nextAttemptAt=Date.now()+30000; sync.error=error instanceof Error?error.message.slice(0,150):"外部連携の更新を再試行しています。"; }
  });
}
export async function createExhibitionGoogleForm(exhibitionId: string) {
  const {exhibition,token} = await leaseIntegration(exhibitionId,"googleSync"), schema=currentSchema(exhibition);
  const known=exhibition.googleForms.at(-1), connection=known?.connectionId ?? (known ? "legacy" : "exhibition-drive");
  try {
    await checkExhibitionGoogleConnection(connection);
    if (connection === "exhibition-drive") await ensureExhibitionDriveFolders(exhibition.id);
    const result=await postGas({action:"form.create",title:`${exhibition.title} 出展受付`,exhibitionId:exhibition.id,
      ...(connection === "exhibition-drive" ? {exhibitionTitle:exhibition.title,year:exhibition.year ?? Number(new Date(Date.parse(exhibition.createdAt)+9*3600000).getUTCFullYear())} : {}),
      schemaVersion:schema.version,fields:formFields(schema),...(known?{formId:known.formId,spreadsheetId:known.spreadsheetId}:{})},60000,connection);
    if (typeof result.formId!=="string" || typeof result.spreadsheetId!=="string" || !result.itemIds || typeof result.itemIds!=="object" || (known && (result.formId!==known.formId || result.spreadsheetId!==known.spreadsheetId))) throw new Error("invalid-response");
    const form=await updateExhibitionStore(data=>{
      const e=findExhibition(data,exhibitionId);
      const value={connectionId:connection,schemaVersion:schema.version,formId:result.formId,spreadsheetId:result.spreadsheetId,itemIds:result.itemIds as Record<string,number>};
      e.googleForms=e.googleForms.filter(f=>f.schemaVersion!==schema.version);e.googleForms.push(value);e.googleForms.sort((a,b)=>a.schemaVersion-b.schemaVersion);
      e.spreadsheetId=result.spreadsheetId;
      if (e.googleSync?.leaseToken===token) {e.googleSync.pending=currentSchema(e).version!==schema.version || e.title!==exhibition.title || e.year!==exhibition.year;delete e.googleSync.error;}
      e.revision++;e.updatedAt=new Date().toISOString();return value;
    });
    await finishIntegration(exhibitionId,"googleSync",token);return form;
  } catch(error) {await finishIntegration(exhibitionId,"googleSync",token,error);throw error;}
}
export async function importExistingExhibitionSheet(exhibitionId: string, sourceSpreadsheetId: string) {
  if (!exhibitionGoogleConfigured()) throw new Error("configuration");
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(sourceSpreadsheetId)) throw new Error("spreadsheet");
  findExhibition(readExhibitions(), exhibitionId);
  const result = await postGas({ action: "sheet.read", sourceSpreadsheetId });
  if (!Array.isArray(result.values) || typeof result.sheetName !== "string") throw new Error("invalid-response");
  return importTitleBoardRows(exhibitionId, sourceSpreadsheetId, result.sheetName, result.values);
}
async function lrRequest(url: string, options: RequestInit, timeout = 30000) {
  const token = await getAdobeAccessToken();
  const response = await fetchWithTimeout(url, { ...options, headers: { Authorization: `Bearer ${token}`, "X-API-Key": lrClientId(), ...(options.headers ?? {}) } }, timeout);
  const collision = options.method === "PUT" && new Headers(options.headers).get("If-None-Match") === "*" && [409,412].includes(response.status);
  if (!response.ok && !collision && !(options.method === "GET" && response.status === 404)) throw new Error(`lightroom-${response.status}`);
  return response;
}
async function lrJson(response: Response) {
  return JSON.parse((await response.text()).replace(/^while\s*\(1\)\s*\{\}\s*/, ""));
}
export async function createExhibitionAlbum(exhibitionId: string, origin: string, selection?:{actorId:string;revision:unknown;excludedAssetIds:unknown}) {
  if (!exhibitionLightroomConfigured()) throw new Error("configuration");
  const {exhibition,token}=await leaseIntegration(exhibitionId,"albumSync",selection?(data,e)=>{
    requireStaff(selection.actorId);
    if(e.revision!==selection.revision)throw new ExhibitionError('別の画面で変更されています。一覧と保存済みの設定を読み直してください。',409);
    e.albumExcludedAssetIds=parseAlbumExclusions(selection.excludedAssetIds,data,e);
    e.revision++;e.updatedAt=new Date().toISOString();
  }:undefined);
  const url=`${LR_BASE}/v2/catalogs/${encodeURIComponent(lrCatalogId())}/albums/${exhibition.albumId}`;
  try {
    const now=new Date().toISOString();
    const updateExisting=async(response: Response)=>{
      if(response.status===404)throw new Error("Lightroomアルバムが見つかりません。");
      const body=await lrJson(response),album=body.resource??body;
      if(album.serviceId!==lrClientId() || album.payload?.publishInfo?.remoteId!==exhibition.id) throw new Error("Lightroomアルバムの紐付けを確認できません。");
      await lrRequest(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload:{name:exhibition.title,userUpdated:now}})});
    };
    if (!exhibition.albumCreated) {
      const existing=await lrRequest(url,{method:"GET"});
      if(existing.status!==404)await updateExisting(existing);
      else {
        const response=await lrRequest(url,{method:"PUT",headers:{"Content-Type":"application/json","If-None-Match":"*"},body:JSON.stringify({subtype:"project",serviceId:lrClientId(),payload:{userCreated:now,userUpdated:now,name:exhibition.title,publishInfo:{version:3,created:now,updated:now,remoteId:exhibition.id,remoteLinks:{edit:{href:`${origin.replace(/\/$/,"")}/Member/manage/exhibitions/${exhibition.id}`}}}}})});
        if ([409,412].includes(response.status)) await updateExisting(await lrRequest(url,{method:"GET"}));
      }
    } else await lrRequest(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payload:{name:exhibition.title,userUpdated:now}})});
    await updateExhibitionStore(data=>{const e=findExhibition(data,exhibitionId);e.albumCreated=true;if(e.albumSync?.leaseToken===token){e.albumSync.pending=e.title!==exhibition.title;delete e.albumSync.error;}e.revision++;e.updatedAt=new Date().toISOString();});
    await finishIntegration(exhibitionId,"albumSync",token);return exhibition.albumId;
  }catch(error){await finishIntegration(exhibitionId,"albumSync",token,error);throw error;}
}
export async function deleteExhibitionAlbum(albumId: string, expectedExhibitionId: string, wasCreated: boolean) {
  if (!wasCreated) return;
  if (!exhibitionLightroomConfigured()) {if(wasCreated)throw new Error("Lightroom接続が未設定です。");return;}
  if (!/^[a-f0-9]{32}$/.test(albumId)) throw new Error("album-id");
  const url=`${LR_BASE}/v2/catalogs/${encodeURIComponent(lrCatalogId())}/albums/${albumId}`, token=await getAdobeAccessToken();
  const headers={Authorization:`Bearer ${token}`,"X-API-Key":lrClientId()};
  const response=await fetchWithTimeout(url,{headers},30000);
  if (response.status===404) return;
  if (!response.ok) throw new Error(`lightroom-${response.status}`);
  const data=await lrJson(response), album=data.resource??data;
  if(album.payload?.publishInfo?.remoteId!==expectedExhibitionId || album.serviceId!==lrClientId()) throw new Error("Lightroomアルバムの紐付けを確認できません。");
  const removed=await fetchWithTimeout(url,{method:"DELETE",headers},30000);
  if (![200,202,204,404].includes(removed.status)) throw new Error(`lightroom-${removed.status}`);
}
export async function uploadExhibitionAssetToLightroom(exhibitionId: string, assetId: string, origin: string) {
  if (!exhibitionLightroomConfigured()) throw new Error("configuration");
  const data = readExhibitions(), exhibition = findExhibition(data, exhibitionId), asset = data.assets.find(a => a.id === assetId && a.exhibitionId === exhibitionId);
  if (!asset) throw new Error("asset");
  const stillEligible = () => {
    const current = readExhibitions();
    const e = current.exhibitions.find(e => e.id === exhibitionId);
    return !!e && albumPhotoEligible(current, e, asset);
  };
  if (!albumPhotoEligible(data, exhibition, asset)) return;
  if (!exhibition.albumCreated || exhibition.albumSync?.pending) await createExhibitionAlbum(exhibitionId, origin);
  if (!stillEligible()) return;
  if (!asset.uploaded) {
    const bytes = fs.readFileSync(exhibitionAssetPath(asset.id));
    const base = `${LR_BASE}/v2/catalogs/${encodeURIComponent(lrCatalogId())}/assets/${asset.lightroomId}`;
    const now = new Date().toISOString();
    await lrRequest(base, { method: "PUT", headers: { "Content-Type": "application/json", "If-None-Match": "*" }, body: JSON.stringify({ subtype: "image", payload: { importSource: { fileName: asset.name, importedOnDevice: lrClientId(), importTimestamp: now } } }) });
    await lrRequest(`${base}/master`, { method: "PUT", headers: { "Content-Type": asset.mimeType, "Content-Length": String(bytes.length), "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes }, 60000);
    await updateExhibitionStore(store => { const a = store.assets.find(a => a.id === asset.id)!; a.uploaded = true; return a; });
  }
  const current = readExhibitions(), currentExhibition = current.exhibitions.find(e => e.id === exhibitionId);
  const refreshed = current.assets.find(a => a.id === asset.id);
  if (refreshed && !refreshed.albumAdded && currentExhibition && albumPhotoEligible(current, currentExhibition, refreshed)) {
    await lrRequest(`${LR_BASE}/v2/catalogs/${encodeURIComponent(lrCatalogId())}/albums/${exhibition.albumId}/assets`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resources: [{ id: refreshed.lightroomId, payload: {
        order: refreshed.createdAt.replace(/[^0-9]/g, "").slice(0, 18),
        publishInfo: { remoteId: refreshed.id, servicePayload: JSON.stringify({ submissionId: refreshed.submissionId }).slice(0, 1000) },
      } }] }),
    });
    await updateExhibitionStore(store => { const a = store.assets.find(a => a.id === asset.id)!; a.albumAdded = true; return a; });
  }
}
async function leaseVersion(exhibitionId: string, submissionId: string, versionNumber: number) {
  const leaseToken = crypto.randomUUID();
  return updateExhibitionStore(data => {
    const exhibition = findExhibition(data, exhibitionId), submission = data.submissions.find(s => s.id === submissionId && s.exhibitionId === exhibitionId), version = submission?.versions.find(v => v.version === versionNumber);
    if (!submission || !version || version.delivery !== "pending" || version.nextAttemptAt > Date.now() || (version.leaseUntil ?? 0) > Date.now()) return null;
    const form = exhibition.googleForms.find(f => f.schemaVersion === version.schemaVersion);
    if (exhibition.googleSync?.pending || (exhibition.googleSync?.leaseUntil ?? 0)>Date.now()) return null;
    if (!form) return null;
    version.leaseToken = leaseToken; version.leaseUntil = Date.now() + 600000; version.attempts++;
    return { exhibition: structuredClone(exhibition), submission: structuredClone(submission), version: structuredClone(version), form, leaseToken };
  });
}
async function finishVersion(exhibitionId: string, submissionId: string, versionNumber: number, leaseToken: string, delivered: boolean, error?: string) {
  return updateExhibitionStore(data => {
    const submission = data.submissions.find(s => s.id === submissionId && s.exhibitionId === exhibitionId), version = submission?.versions.find(v => v.version === versionNumber);
    if (!version || version.leaseToken !== leaseToken) return;
    delete version.leaseToken; delete version.leaseUntil;
    if (delivered) { version.delivery = "delivered"; version.deliveredAt = new Date().toISOString(); delete version.error; }
    else { version.error = error ?? "upstream"; version.nextAttemptAt = Date.now() + Math.min(15 * 60000, 30000 * 2 ** Math.min(version.attempts - 1, 5)); }
  });
}
export async function deliverExhibitionVersion(exhibitionId: string, submissionId: string, versionNumber: number) {
  const leased = await leaseVersion(exhibitionId, submissionId, versionNumber);
  if (!leased) return false;
  try {
    if (!exhibitionGoogleConfigured(leased.form.connectionId ?? "legacy")) throw new Error("configuration");
    const assetIds = new Set(leased.version.content.works.flatMap(w => w.photos.map(p => p.assetId)));
    for (const assetId of assetIds) if (!await deliverExhibitionDriveFile("asset", assetId)) throw new Error("drive-original-pending");
    const rows = await answerRows(leased.exhibition, leased.submission, leased.version);
    const delivered: string[] = [];
    // Keep signed Apps Script envelopes comfortably below the web-app payload limit.
    for (let index = 0; index < rows.length;) {
      const owned = await updateExhibitionStore(data => {
        const version = data.submissions.find(s => s.id === submissionId && s.exhibitionId === exhibitionId)?.versions.find(v => v.version === versionNumber);
        if (!version || version.leaseToken !== leased.leaseToken) return false;
        version.leaseUntil = Date.now() + 150000; return true;
      });
      if (!owned) throw new Error("lease");
      const batch = rows.slice(index, index + 8);
      while (batch.length > 1 && Buffer.byteLength(JSON.stringify({ action: "response.submit", formId: leased.form.formId, itemIds: leased.form.itemIds, rows: batch })) > 900000) batch.pop();
      if (Buffer.byteLength(JSON.stringify(batch)) > 900000) throw new Error("payload-size");
      const result = await postGas({ action: "response.submit", formId: leased.form.formId, itemIds: leased.form.itemIds, rows: batch }, 60000, leased.form.connectionId ?? "legacy");
      if (!Array.isArray(result.delivered) || result.delivered.length !== batch.length || !result.delivered.every((key: unknown) => typeof key === "string" && batch.some(row => row.idempotencyKey === key))) throw new Error("invalid-response");
      delivered.push(...result.delivered);
      index += batch.length;
    }
    if (delivered.length !== rows.length) throw new Error("invalid-response");
    await finishVersion(exhibitionId, submissionId, versionNumber, leased.leaseToken, true); return true;
  } catch (error) { await finishVersion(exhibitionId, submissionId, versionNumber, leased.leaseToken, false, error instanceof Error ? error.message.slice(0, 100) : "upstream"); return false; }
}
export async function drainExhibitionQueues(origin: string, limit = 20, stopped = () => false) {
  const {drainExhibitionDeletions}=await import("./exhibitionDeletion.ts");
  await drainExhibitionDeletions(limit,stopped);
  for (const e of readExhibitions().exhibitions) {
    if(stopped()) break;
    for(const [key,operation] of [["googleSync",()=>createExhibitionGoogleForm(e.id)],["albumSync",()=>createExhibitionAlbum(e.id,origin)]] as const) {
      if(e[key]?.pending && e[key]!.nextAttemptAt<=Date.now() && (e[key]!.leaseUntil??0)<=Date.now()) {try{await operation();}catch{/* Persisted sync state is retried on the next worker interval. */}}
    }
  }
  const { drainShiftDeliveries } = await import("./exhibitionShiftDelivery.ts");
  await drainShiftDeliveries(limit, stopped);
  const data = readExhibitions();
  const submittedAssets = new Set(data.exhibitions.filter(e => e.albumCreated).flatMap(e =>
    currentExhibitionPhotos(data, e.id).filter(({ asset }) => !albumPhotoExcluded(e, asset.id)).map(({ asset }) => asset.id)));
  let uploads = 0, delivered = 0, attempted = 0;
  for (const exhibition of data.exhibitions) for (const notice of exhibition.notices ?? []) {
    if (notice.deliveredAt || stopped()) continue;
    attempted++;
    try {
      await appendExhibitionNotice(notice);
      await updateExhibitionStore(store => {
        const e = findExhibition(store, exhibition.id), queued = e.notices?.find(n => n.id === notice.id);
        if (!queued) return;
        queued.deliveredAt = new Date().toISOString(); delete queued.error;
        if (e.participation?.noticeId === notice.id && e.participation.state === "publishing") { e.participation.state = "published"; e.participation.publishedAt = queued.deliveredAt; }
      });
    } catch { await updateExhibitionStore(store => { const queued = store.exhibitions.find(e=>e.id===exhibition.id)?.notices?.find(n => n.id === notice.id); if (queued) queued.error = "通知の保存を再試行しています。"; }); }
  }
  if (exhibitionLightroomConfigured()) for (const asset of data.assets.filter(a => !a.albumAdded && submittedAssets.has(a.id)).slice(0, limit)) { if (stopped()) break; attempted++; try { await uploadExhibitionAssetToLightroom(asset.exhibitionId, asset.id, origin); uploads++; } catch { /* Retry on the next interval. */ } }
  const drive = await drainExhibitionDriveFiles(limit, stopped);
  uploads += drive.delivered; attempted += drive.attempted;
  if (exhibitionGoogleConfigured() || exhibitionGoogleConfigured("exhibition-drive")) for (const submission of data.submissions) for (const version of submission.versions.filter(v => v.delivery === "pending" && v.nextAttemptAt <= Date.now() && (v.leaseUntil ?? 0) <= Date.now())) {
    if (delivered >= limit || stopped()) return { attempted, uploads, delivered }; attempted++;
    try { if (await deliverExhibitionVersion(submission.exhibitionId, submission.id, version.version)) delivered++; } catch { /* An exhibition may be deleted after the queue snapshot. */ }
  }
  return { attempted, uploads, delivered };
}
