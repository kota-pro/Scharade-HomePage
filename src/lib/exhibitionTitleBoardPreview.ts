import {boardDesignScene,boardDesignSvg} from './exhibitionBoardDesign.ts';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { exhibitionQrPng } from './exhibitionQr.ts';
import { submissionQrTarget } from './exhibitionQrTarget.ts';
import { measureBoardText } from './exhibitionTextMetrics.ts';
import { latestContent, type ExhibitionStore, type Exhibition, type LayoutWork } from './exhibitionTypes.ts';
import type { BoardWork } from './exhibitionOutputs.ts';
import { findExhibition, readExhibitions, tokenSubmission } from './exhibitions.ts';
import { exhibitionMember, ownSubmission } from './exhibitionParticipation.ts';
import { ExhibitionError, id, object, parseContent } from './exhibitionValidation.ts';
import { withImageSlot, ImageBusyError } from './imageSecurity.ts';
import type { SubmissionContent } from './exhibitionTypes.ts';
const cache=new Map<string,Promise<{png:Uint8Array;issues:string[]}>>();
/** Read-only preview of the same physical card used by the print renderer. */
export function titleBoardPreview(board:BoardWork,origin:string,previewContent?:SubmissionContent) {
  const content=previewContent??latestContent(board.submission)!;
  const qrConfirmed=submissionQrTarget(board.submission,origin,content).confirmed;
  const key=createHash('sha256').update(JSON.stringify([content.name,content.authorName,content.grade,board.work,board.qrUrl,qrConfirmed,origin,board.design])).digest('hex');
  const existing=cache.get(key);if(existing)return existing;
  const result=(async()=>{
    const scene=boardDesignScene(content,board.work,measureBoardText,board.design);
    const qr=board.qrUrl?`data:image/png;base64,${Buffer.from(await exhibitionQrPng(board.qrUrl,origin)).toString('base64')}`:'';
    const svg=boardDesignSvg(scene,qr);
    const directory=path.join(process.cwd(),'public/fonts/zen-old-mincho');
    const png=new Resvg(svg,{font:{fontFiles:['Regular','Bold'].map(w=>path.join(directory,`ZenOldMincho-${w}.ttf`)),loadSystemFonts:false},fitTo:{mode:'width',value:840}}).render().asPng();
    const issues=scene.issues.map(i=>i.message);
    if(!board.qrUrl||!qrConfirmed)issues.push('QRコードの宛先は未確定です。');
    return {png,issues};
  })();
  cache.set(key,result);if(cache.size>64)cache.delete(cache.keys().next().value!);result.catch(()=>{if(cache.get(key)===result)cache.delete(key);});return result;
}
/** Render the owner's current form values without saving a draft, version or external file. */
export async function previewOwnTitleBoard(exhibitionId:string,token:string,value:unknown,actorId:string|undefined,origin:string) {
  const user=exhibitionMember(actorId),data=readExhibitions(),exhibition=findExhibition(data,id(exhibitionId));
  const submission=ownSubmission(data,exhibition,user.id,token?tokenSubmission(data,exhibition.id,token):undefined);
  if(!submission)throw new ExhibitionError('先に出展を開始してください。',404);
  const schema=exhibition.schemas.find(s=>s.version===submission.schemaVersion);
  if(!schema)throw new ExhibitionError('フォーム定義が見つかりません。画面を開き直してください。',503);
  const raw=object(value),work=object(raw.work),sectionId=id(work.sectionId);
  // Photograph uploads, layout numbers and extra questions are unrelated to the printed card.
  const content=parseContent({...raw,fields:{},sections:[{sectionId,singles:0,series:0,books:0,seriesPhotoCounts:[],fields:{}}],works:[{...work,photos:[],fields:{}}]},schema,[],false);
  const previous=latestContent(submission),unchanged=previous?.name===content.name&&previous?.portfolioUrl===content.portfolioUrl;
  const previewSubmission=unchanged?submission:{...submission,portfolioId:user.portfolioId||undefined,qrConfirmed:!!user.portfolioId,qrSource:undefined};
  const {url:qrUrl}=submissionQrTarget(previewSubmission,origin,content);
  const selected=content.works[0];
  try {
    const preview=await withImageSlot(()=>titleBoardPreview({submission:previewSubmission,work:selected,qrUrl,design:exhibition.boardDesigns?.[selected.id]},origin,content));
    const required=[['作品タイトル',selected.title],['作者名',content.authorName],['学年',content.grade]].filter(([,v])=>!v).map(([label])=>`${label}を入力してください。`);
    return {ok:true,image:`data:image/png;base64,${Buffer.from(preview.png).toString('base64')}`,title:selected.title,sectionTitle:schema.sections.find(s=>s.id===sectionId)!.title,qrUrl,fontSize:boardDesignScene(content,selected,measureBoardText,exhibition.boardDesigns?.[selected.id]).frames.caption.fontSize,issues:[...required,...preview.issues]};
  } catch(error) {
    if(error instanceof ImageBusyError)throw new ExhibitionError(error.message,error.status);
    throw error;
  }
}
export async function withTitleBoardImages(works:LayoutWork[],data:ExhibitionStore,exhibition:Exhibition,origin:string):Promise<LayoutWork[]> {
  const ids=new Set(exhibition.rooms.flatMap(r=>(r.titleBoards??[]).map(c=>c.workId)));
  return Promise.all(works.map(async work=>{
    if(!ids.has(work.id))return work;
    const submission=data.submissions.find(s=>s.exhibitionId===exhibition.id&&!s.inactive&&latestContent(s)?.works.some(w=>w.id===work.id));
    if(!submission)return work;
    const {url:qrUrl}=submissionQrTarget(submission,origin);
    const preview=await titleBoardPreview({submission,work,qrUrl,design:exhibition.boardDesigns?.[work.id]},origin);
    return {...work,titleBoardImage:`data:image/png;base64,${Buffer.from(preview.png).toString('base64')}`};
  }));
}
