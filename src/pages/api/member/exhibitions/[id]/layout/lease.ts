import type { APIRoute } from 'astro';
import { isStaff } from '../../../../../../lib/auth.ts';
import { json } from '../../../../../../lib/http.ts';
import { ExhibitionError } from '../../../../../../lib/exhibitionValidation.ts';
import { acquireLayoutLeases } from '../../../../../../lib/exhibitionCollaboration.ts';
export const POST:APIRoute=async({locals,params,request})=>{
 if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
 try{return json(acquireLayoutLeases(locals.user!.id,params.id??'',await request.json()));}
 catch(error){return json({ok:false,message:error instanceof ExhibitionError?error.message:'操作ロックを確認してください。'},error instanceof ExhibitionError?error.status:503);}
};
