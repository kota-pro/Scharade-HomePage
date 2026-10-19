import type {APIRoute} from 'astro';
import {isStaff} from '../../../lib/auth.ts';
import {json,boundedBody,HttpInputError,isSameOrigin} from '../../../lib/http.ts';
import {parseLayoutAnnotation,ExhibitionError} from '../../../lib/exhibitionValidation.ts';
import {outlinedAnnotationText,measureVectorText,vectorTextIssues} from '../../../lib/exhibitionVectorText.ts';
import {richTextLayout,annotationRuns} from '../../../lib/exhibitionRichText.ts';
/** Read-only font preview. No exhibition, file archive, or external integration is changed. */
export const POST:APIRoute=async({locals,request})=>{
  if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
  if(!isSameOrigin(request))return json({ok:false,message:'画面を再読み込みしてください。'},403);
  try{const bytes=await boundedBody(request,128*1024);let raw:unknown;try{raw=JSON.parse(bytes.toString('utf8'));}catch{throw new ExhibitionError('文字の入力形式を確認してください。');}
    const annotation=parseLayoutAnnotation(raw);if(annotation.kind!=='text')throw new ExhibitionError('文字を選択してください。');
    const b=richTextLayout(annotationRuns(annotation),annotation.fontSize,measureVectorText);
    return json({ok:true,svg:outlinedAnnotationText(annotation),issues:vectorTextIssues(annotation),width:b.width*(annotation.textScaleX??1),height:b.height*(annotation.textScaleY??1)});
  }catch(error){if(error instanceof ExhibitionError||error instanceof HttpInputError)return json({ok:false,message:error.message},error.status);console.error('[exhibition-text-preview] failed');return json({ok:false,message:'文字のプレビューを生成できませんでした。'},503);}
};
