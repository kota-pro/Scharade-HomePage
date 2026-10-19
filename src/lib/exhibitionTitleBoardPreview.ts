import path from 'node:path';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { exhibitionQrPng } from './exhibitionQr.ts';
import { measureBoardText, validateBoardText } from './exhibitionTextMetrics.ts';
import { titleOriginMm, boardTextLayout, wrapBoardText } from './exhibitionText.ts';
import { latestContent, type ExhibitionStore, type Exhibition, type LayoutWork } from './exhibitionTypes.ts';
import type { BoardWork } from './exhibitionOutputs.ts';
const escape=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const cache=new Map<string,Promise<{png:Uint8Array;issues:string[]}>>();
/** Read-only preview of the same physical card used by the print renderer. */
export function titleBoardPreview(board:BoardWork,origin:string) {
  const content=latestContent(board.submission)!;
  const key=createHash('sha256').update(JSON.stringify([content.authorName,content.grade,board.work,board.qrUrl,!!board.submission.qrConfirmed,origin])).digest('hex');
  const existing=cache.get(key);if(existing)return existing;
  const result=(async()=>{
    const text=(value:string,x:number,top:number,size:number,bold=false)=>`<text x="${x}" y="${top+size*25.4/72}" font-size="${size*25.4/72}" font-weight="${bold?700:400}">${escape(value)}</text>`;
    const title=wrapBoardText(`「${board.work.title}」`,21,boardTextLayout.titleWidth,measureBoardText,true).map((line,i)=>text(line,titleOriginMm,8.5+i*8.2,21,true)).join('');
    const caption=wrapBoardText(board.work.caption,10,89,measureBoardText).map((line,i)=>text(line,8,32.3+i*4.23,10)).join('');
    const metadata=[['撮影場所',board.work.location],['使用機材',board.work.equipment],['撮影設定',board.work.settings]].filter(([,value])=>value).map(([label,value],i)=>text(label,8,50+i*6.17,8,true)+text(value,25.4,50+i*6.17,8)).join('');
    const qr=board.qrUrl?`<image x="79" y="49.25" width="18" height="18" href="data:image/png;base64,${Buffer.from(await exhibitionQrPng(board.qrUrl,origin)).toString('base64')}"/>`:'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="105mm" height="74.25mm" viewBox="0 0 105 74.25"><rect width="105" height="74.25" fill="white"/><g font-family="Zen Old Mincho" fill="#211c1a">${title}${text(content.authorName,8,23,14)}${text(content.grade,8+measureBoardText(content.authorName,14)+6.5,24.1,10)}${caption}${metadata}</g>${qr}</svg>`;
    const directory=path.join(process.cwd(),'public/fonts/zen-old-mincho');
    const png=new Resvg(svg,{font:{fontFiles:['Regular','Bold'].map(w=>path.join(directory,`ZenOldMincho-${w}.ttf`)),loadSystemFonts:false},fitTo:{mode:'width',value:840}}).render().asPng();
    const issues=validateBoardText({...content,works:[board.work]}).map(i=>i.message);
    if(!board.qrUrl||!board.submission.qrConfirmed)issues.push('QRコードの宛先は未確定です。');
    return {png,issues};
  })();
  cache.set(key,result);if(cache.size>64)cache.delete(cache.keys().next().value!);result.catch(()=>{if(cache.get(key)===result)cache.delete(key);});return result;
}
export async function withTitleBoardImages(works:LayoutWork[],data:ExhibitionStore,exhibition:Exhibition,origin:string):Promise<LayoutWork[]> {
  const ids=new Set(exhibition.rooms.flatMap(r=>(r.titleBoards??[]).map(c=>c.workId)));
  return Promise.all(works.map(async work=>{
    if(!ids.has(work.id))return work;
    const submission=data.submissions.find(s=>s.exhibitionId===exhibition.id&&!s.inactive&&latestContent(s)?.works.some(w=>w.id===work.id));
    if(!submission)return work;
    const content=latestContent(submission)!,qrUrl=submission.portfolioId?`${origin.replace(/\/$/,'')}/Portfolio/${encodeURIComponent(submission.portfolioId)}`:content.portfolioUrl;
    const preview=await titleBoardPreview({submission,work,qrUrl},origin);
    return {...work,titleBoardImage:`data:image/png;base64,${Buffer.from(preview.png).toString('base64')}`};
  }));
}
