import type {APIRoute} from 'astro';
import {isStaff} from '../../../../../../lib/auth.ts';
import {exhibitionUploadForm} from '../../../../../../lib/exhibitions.ts';
import {uploadLayoutAsset} from '../../../../../../lib/exhibitionLayoutAssets.ts';
import {ExhibitionError, exhibitionErrorBody } from '../../../../../../lib/exhibitionValidation.ts';
import {json} from '../../../../../../lib/http.ts';
export const POST:APIRoute=async({locals,params,request})=>{if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);try{const form=await exhibitionUploadForm(request);if([...form.keys()].some(k=>!['assetId','file'].includes(k))||form.getAll('assetId').length!==1||form.getAll('file').length!==1||typeof form.get('assetId')!=='string'||!(form.get('file') instanceof File))throw new ExhibitionError('画像の添付内容を確認してください。');return json(await uploadLayoutAsset(locals.user!.id,params.id??'',form.get('assetId') as string,form.get('file') as File));}catch(error){return json(exhibitionErrorBody(error),error instanceof ExhibitionError?error.status:503);}};
