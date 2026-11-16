import type {APIRoute} from 'astro';
import {isStaff} from '../../../../../lib/auth.ts';
import {readExhibitions,findExhibition} from '../../../../../lib/exhibitions.ts';
import {exhibitionAlbumPhotos} from '../../../../../lib/exhibitionAlbumPhotos.ts';
import {ExhibitionError,exhibitionErrorBody} from '../../../../../lib/exhibitionValidation.ts';
import {json} from '../../../../../lib/http.ts';
export const GET:APIRoute=async({locals,params})=>{
  if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
  try{const data=readExhibitions(),e=findExhibition(data,params.id??'');return json({ok:true,title:e.title,revision:e.revision,albumCreated:!!e.albumCreated,excludedAssetIds:e.albumExcludedAssetIds??[],photos:exhibitionAlbumPhotos(data,e.id)});}
  catch(error){return error instanceof ExhibitionError?json(exhibitionErrorBody(error),error.status):json({ok:false,message:'写真一覧を取得できませんでした。'},503);}
};
