import fs from 'node:fs';
import type {APIRoute} from 'astro';
import {isStaff} from '../../../../../../lib/auth.ts';
import {authorizeLayoutAsset,layoutAssetPath} from '../../../../../../lib/exhibitionLayoutAssets.ts';
import {ExhibitionError} from '../../../../../../lib/exhibitionValidation.ts';
import {json} from '../../../../../../lib/http.ts';
export const GET:APIRoute=({locals,params,url})=>{if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);try{const asset=authorizeLayoutAsset(locals.user!.id,params.id??'',params.assetId??''),preview=url.searchParams.get('preview')==='1',bytes=fs.readFileSync(layoutAssetPath(asset.id,preview));return new Response(bytes,{headers:{'Content-Type':preview?'image/png':asset.mimeType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return json({ok:false,message:error instanceof ExhibitionError?error.message:'配置用画像を読み込めません。'},error instanceof ExhibitionError?error.status:503);}};
