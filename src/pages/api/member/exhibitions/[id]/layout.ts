import type { APIRoute } from 'astro';
import { isStaff } from '../../../../../lib/auth.ts';
import { json } from '../../../../../lib/http.ts';
import { ExhibitionError } from '../../../../../lib/exhibitionValidation.ts';
import { joinLayout, readLayoutSnapshot, commitLayoutOperation, readLayoutHistory, restoreLayoutVersion } from '../../../../../lib/exhibitionCollaboration.ts';
export const GET:APIRoute=({locals,params,url})=>{
  if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
  try{return json(url.searchParams.has('history')?readLayoutHistory(locals.user!.id,params.id??'',url.searchParams.get('version')??undefined):readLayoutSnapshot(locals.user!.id,params.id??''));}
  catch(error){return json({ok:false,message:error instanceof ExhibitionError?error.message:'レイアウトを読み込めませんでした。'},error instanceof ExhibitionError?error.status:503);}
};
export const POST:APIRoute=async({locals,params,request})=>{
  if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
  try{const raw=await request.json();if(raw?.action==='join')return json(await joinLayout(locals.user!.id,params.id??'',raw.clientId));if(raw?.action==='restore')return json(await restoreLayoutVersion(locals.user!.id,params.id??'',raw));if(raw?.action!=='commit')throw new ExhibitionError('レイアウトの操作を確認してください。');return json(await commitLayoutOperation(locals.user!.id,params.id??'',raw));}
  catch(error){return json({ok:false,message:error instanceof ExhibitionError?error.message:'保存結果を確認できませんでした。未送信の変更は保持しています。'},error instanceof ExhibitionError?error.status:503);}
};
