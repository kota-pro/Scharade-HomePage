import type { APIRoute } from 'astro';
import { isStaff } from '../../../../../lib/auth.ts';
import { exhibitionAction,findExhibition,readExhibitions } from '../../../../../lib/exhibitions.ts';
import { ExhibitionError,exhibitionErrorBody } from '../../../../../lib/exhibitionValidation.ts';
import { boundedBody,HttpInputError,isSameOrigin,json } from '../../../../../lib/http.ts';
import { titleBoardWorks } from '../../../../../lib/exhibitionOutputs.ts';
import { boardDesignScene,boardDesignSvg,parseBoardDesign,boardElementLabels } from '../../../../../lib/exhibitionBoardDesign.ts';
import { measureBoardText } from '../../../../../lib/exhibitionTextMetrics.ts';
import { latestContent } from '../../../../../lib/exhibitionTypes.ts';
import { siteOrigin } from '../../../../../lib/config.ts';
import { exhibitionQrPng } from '../../../../../lib/exhibitionQr.ts';
import { submissionQrTarget } from '../../../../../lib/exhibitionQrTarget.ts';

const handler:APIRoute=async({locals,params,request,url})=>{
  if(!isStaff(locals.user))return json({ok:false,message:'運営以上の権限が必要です。'},locals.user?403:401);
  try {
    if(request.method!=='GET'&&!isSameOrigin(request))return json({ok:false,message:'画面を再読み込みしてください。'},403);
    const data=readExhibitions(),exhibition=findExhibition(data,params.id??''),origin=siteOrigin(request),works=titleBoardWorks(data,exhibition,origin);
    const body=request.method==='GET'?{}:JSON.parse((await boundedBody(request,64*1024)).toString('utf8'));
    if(!body||typeof body!=='object'||Array.isArray(body))throw new ExhibitionError('入力形式を確認してください。');
    if(body.action==='save')return json(await exhibitionAction(locals.user!.id,{action:'boards.design',exhibitionId:exhibition.id,revision:body.revision,workId:body.workId,submissionRevision:body.submissionRevision,design:body.design}));
    const workId=request.method==='GET'?url.searchParams.get('workId'):body.workId;
    const issueList=(board:typeof works[number],scene:ReturnType<typeof boardDesignScene>)=>[...scene.issues.map(i=>({...i,label:boardElementLabels[i.element]})),...(!submissionQrTarget(board.submission,origin).confirmed?[{element:'qr',label:'QRコード',message:'宛先を「QR・タイトルボード」から確定してください。'}]:[])];
    if(!workId&&request.method==='GET')return json({ok:true,revision:exhibition.revision,title:exhibition.title,works:works.map(board=>{
      const content=latestContent(board.submission)!,scene=boardDesignScene(content,board.work,measureBoardText,board.design);
      return {id:board.work.id,title:board.work.title,author:content.authorName,name:content.name,submissionRevision:board.submission.revision,issues:issueList(board,scene)};
    })});
    const board=works.find(b=>b.work.id===workId);if(!board)return json({ok:false,message:'作品が見つかりません。'},404);
    if(request.method!=='GET'&&body.action!=='preview')return json({ok:false,message:'操作を確認してください。'},400);
    let design=board.design;
    if(request.method!=='GET'){try{design=body.design===null?{}:parseBoardDesign(body.design);}catch(error){throw new ExhibitionError(error instanceof Error?error.message:'配置を確認してください。');}}
    const scene=boardDesignScene(latestContent(board.submission)!,board.work,measureBoardText,design);
    const qr=board.qrUrl?`data:image/png;base64,${Buffer.from(await exhibitionQrPng(board.qrUrl,origin)).toString('base64')}`:'';
    return json({ok:true,revision:exhibition.revision,submissionRevision:board.submission.revision,workId:board.work.id,design:design??{},scene,issues:issueList(board,scene),svg:boardDesignSvg(scene,qr)});
  }catch(error){if(error instanceof ExhibitionError||error instanceof HttpInputError)return json(error instanceof ExhibitionError?exhibitionErrorBody(error):{ok:false,message:error.message},error.status);if(error instanceof SyntaxError)return json({ok:false,message:'入力形式を確認してください。'},400);console.error('[exhibition-boards] request failed');return json({ok:false,message:'タイトルボードを読み込めませんでした。'},503);}
};
export const GET=handler;
export const POST=handler;
