import crypto from 'node:crypto';
import {roomSurfaces} from "../../../../../lib/exhibitionSurface.ts";
import {layoutImageDataUrl} from '../../../../../lib/exhibitionLayoutAssets.ts';
import type { APIRoute } from "astro";
import { findExhibition, readExhibitions } from "../../../../../lib/exhibitions.ts";
import { ExhibitionError } from "../../../../../lib/exhibitionValidation.ts";
import { isStaff } from "../../../../../lib/auth.ts";
import { allWorks, titleBoardWorks, layoutOutputViews,layoutOutputPages,exhibitionLayoutPdf, exhibitionLayoutPng, exhibitionLayoutSvgFiles,layoutSvgFilesZip, generateTitleBoards } from "../../../../../lib/exhibitionOutputs.ts";
import { titleBoardPreview, withTitleBoardImages } from "../../../../../lib/exhibitionTitleBoardPreview.ts";
import { siteOrigin } from "../../../../../lib/config.ts";
import { archiveExhibitionOutput } from "../../../../../lib/exhibitionDrive.ts";
import { json } from "../../../../../lib/http.ts";
const file = (data: Uint8Array, type: string, name: string,headers:Record<string,string>={}) => new Response(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store",...headers } });
const output: APIRoute = async ({ locals, params, request, url }) => {
  if (!isStaff(locals.user)) return json({ ok: false, message: "運営以上の権限が必要です。" }, locals.user ? 403 : 401);
  try {
    const data = readExhibitions(), exhibition = findExhibition(data, params.id ?? ""), kind = url.searchParams.get("kind");
    if (kind === "board-preview") {
      if(request.method!=="GET")return json({ok:false,message:"プレビューは閲覧専用です。"},405);
      const board=titleBoardWorks(data,exhibition,siteOrigin(request)).find(w=>w.work.id===url.searchParams.get("workId"));
      if(!board)return json({ok:false,message:"作品が見つかりません。"},404);
      const preview=await titleBoardPreview(board,siteOrigin(request));
      if(url.searchParams.get("status")==="1")return json({ok:true,issues:preview.issues});
      return file(preview.png,"image/png",`${board.work.title}-preview.png`);
    }
    const deliver = async (bytes: Uint8Array, type: string, name: string, roomId?: string,headers:Record<string,string>={}) => {
      if (request.method === "POST") await archiveExhibitionOutput(exhibition.id, kind ?? "", name, type, bytes, roomId);
      return file(bytes, type, name,headers);
    };
    if (kind === "boards") {
      const result = await generateTitleBoards(data, exhibition, siteOrigin(request));
      if (!result.pdf) return json({ ok: false, message: "修正が必要なタイトルボードがあります。", issues: result.issues }, 422);
      return deliver(result.pdf, "application/pdf", `${exhibition.title}-タイトルボード.pdf`);
    }
    if(kind==='layout-preview-info'){if(request.method!=='GET')return json({ok:false,message:'プレビューは閲覧専用です。'},405);const room=exhibition.rooms.find(r=>r.id===url.searchParams.get('room'));if(!room)return json({ok:false,message:'展示室を選択してください。'},400);const works=allWorks(data,exhibition.id);return json({ok:true,views:layoutOutputViews(room).map(v=>({...v,pages:layoutOutputPages(room,works,v.key).length}))});}
    const works=await withTitleBoardImages(allWorks(data,exhibition.id),data,exhibition,siteOrigin(request));
    const knownImages=new Set((data.layoutAssets??[]).filter(a=>a.exhibitionId===exhibition.id).map(a=>a.id));const images=new Map<string,string>();for(const r of exhibition.rooms)for(const a of r.annotations??[])if(a.kind==='image'&&a.assetId&&knownImages.has(a.assetId)&&!images.has(a.assetId))images.set(a.assetId,layoutImageDataUrl(a.assetId));
    const options={imageUrl:(id:string)=>images.get(id)??'',view:url.searchParams.get('view')??'floor',...(url.searchParams.has('page')?{page:Number(url.searchParams.get('page'))}:{} )};
    const room = exhibition.rooms.find(r => r.id === url.searchParams.get("room"));
    if (kind === "layout-pdf") {
      if (!exhibition.rooms.length) return json({ ok: false, message: "展示室を1つ以上設定してください。" }, 422);
      return deliver(await exhibitionLayoutPdf(exhibition.rooms, works,options), "application/pdf", `${exhibition.title}-展示配置図.pdf`);
    }
    if(kind!=='layout-svg'&&room&&options.view!=='floor'&&!layoutOutputViews(room).some(s=>s.key===options.view))return json({ok:false,message:'出力する図面を選択してください。'},400);
    if (!room) return json({ ok: false, message: "展示室を選択してください。" }, 400);
    if(kind==='layout-png'){const count=layoutOutputPages(room,works,options.view,options).length;if(options.page!==undefined&&(!Number.isInteger(options.page)||options.page<0||options.page>=count))return json({ok:false,message:`選択した図の一覧は${count}ページです。1〜${count}を選んでください。`},400);}
    const viewLabel=roomSurfaces(room).find(s=>s.key===options.view)?.label??'平面図',pageLabel=(options.page??0)>0?`-一覧${(options.page??0)+1}`:'';
    if (kind === "layout-png"){const bytes=exhibitionLayoutPng(room,works,options),sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(request.method==='POST'){const body=await request.json();if(body.expectedSha256!==undefined){if(typeof body.expectedSha256!=='string'||! /^[a-f0-9]{64}$/.test(body.expectedSha256))return json({ok:false,message:'プレビューを開き直してください。'},400);if(body.expectedSha256!==sha256)return json({ok:false,message:'配置が変更されました。最新のプレビューを確認してください。'},409);}}return deliver(bytes,'image/png',`${room.name}-${viewLabel}${pageLabel}-展示配置図.png`,room.id,{'X-Layout-Preview-SHA256':sha256});}
    if (kind === "layout-svg") {
      const files=exhibitionLayoutSvgFiles(room,works,options);
      // The existing signed Drive gateway accepts SVG, so archive each artboard in its native format.
      if(request.method==='POST')for(const entry of files)await archiveExhibitionOutput(exhibition.id,'layout-svg',`${room.name}-${entry.name}`,'image/svg+xml',entry.bytes,room.id,`${room.id}:${entry.name}`);
      return file(layoutSvgFilesZip(files),'application/zip',`${room.name}-展示配置図-SVG.zip`);
    }
    return json({ ok: false, message: "出力形式を確認してください。" }, 400);
  } catch (error) {
    if (error instanceof ExhibitionError) return json({ ok: false, message: error.message }, error.status);
    console.error("[exhibition-output] request failed");
    return json({ ok: false, message: "出力を生成できませんでした。" }, 503);
  }
};

export const GET = output;
export const POST = output;
