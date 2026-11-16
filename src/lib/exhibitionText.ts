import { titleBoardIssues } from './exhibitionTitleText.ts';
import { titleOriginMm } from './exhibitionTitleText.ts';
export {titleOriginMm,titleBracketInsetMm} from './exhibitionTitleText.ts';
import type { SubmissionContent, Work, WorkDetails } from "./exhibitionTypes.ts";
export const textLimits = { name:80, authorName:80, grade:20, title:80, caption:400, metadata:100, shutterSpeed:40, iso:20, fNumber:20 };
export const boardTextLayout = { titleWidth:105 - 8 - titleOriginMm, bodyWidth:89, metadataWidth:51, captionLines:4, authorGap:6.5 };
export const captionTypography = { maxFontSize:10, minFontSize:8, topMm:32.3, lineHeightMm:4.23, heightMm:boardTextLayout.captionLines*4.23 };
export const metadataTypography = { fontSize:8, topMm:50, lineHeightMm:6.17, maxLines:3, labelX:8, valueX:25.4 };
export const boardMetadataFields = [["location","撮影場所"],["equipment","使用機材"],["settings","撮影設定"]] as const;
export const prefectures = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
export const emptyWorkDetails = (): WorkDetails => ({place:"",prefecture:"",region:"",camera:"",lens:"",film:"",shutterSpeed:"",iso:"",fNumber:""});
/** Keep boundary newlines: Enter after a camera name must survive a draft save. */
export function normalizeMetadataInput(value:string) {
  return value.trim() ? value.replace(/\r\n?/g,"\n").split("\n").map(line=>line.trim()).join("\n") : "";
}
export function metadataStrings(details: WorkDetails) {
  const join=(values:string[],separator:string)=>values.map(normalizeMetadataInput).filter(v=>v.trim()).reduce((result,value)=>{
    if(!result)return value;
    const tail=result.match(/\n+$/)?.[0]??"",head=value.match(/^\n+/)?.[0]??"";
    return tail||head ? result.slice(0,result.length-tail.length)+separator.trimEnd()+tail+head+value.slice(head.length) : result+separator+value;
  },"").trim();
  const prefixed=(input:string,pattern:RegExp,prefix:string)=>{
    const value=normalizeMetadataInput(input),head=value.match(/^\n*/)?.[0]??"",body=value.slice(head.length).replace(pattern,"");
    return body.trim()?head+prefix+body:"";
  };
  const iso=prefixed(details.iso,/^ISO[^\S\n]*/i,"ISO"),f=prefixed(details.fNumber,/^F[^\S\n]*\/?[^\S\n]*/i,"F");
  return {location:join([details.place,details.prefecture==="海外・その他"?details.region:details.prefecture]," / "),equipment:join([details.camera,details.lens,details.film]," / "),settings:join([details.shutterSpeed,iso,f],", ")};
}
export type TextIssue = { path:string; message:string; layout?:true };
export type TextMeasure = (text:string,size:number,bold?:boolean)=>number;
export function wrapBoardText(value:string,size:number,width:number,measure:TextMeasure,bold=false) {
  const lines:string[]=[];
  for(const source of value.replace(/\r/g,"").split("\n")) {
    let line="";
    for(const char of Array.from(source)) { if(line && measure(line+char,size,bold)>width) {lines.push(line);line=char;} else line+=char; }
    lines.push(line);
  }
  return lines;
}
/** Prefer word boundaries, retaining explicit breaks and never starting a line with a separator. */
export function wrapBoardMetadata(value:string,measure:TextMeasure,width=boardTextLayout.metadataWidth,size=metadataTypography.fontSize) {
  const lines:string[]=[];
  for(const source of normalizeMetadataInput(value).trim().split("\n")) {
    let rest=source;
    if(!rest){lines.push("");continue;}
    while(rest) {
      const chars=Array.from(rest);let count=0;
      while(count<chars.length && measure(chars.slice(0,count+1).join(""),size)<=width+.001)count++;
      if(count===chars.length){lines.push(rest);break;}
      count=Math.max(1,count);
      for(let i=count;i>0;i--) {
        if(/\s/.test(chars[i-1]) && !/^[\/,](?:\s|$)/.test(chars.slice(i).join("").trimStart())){count=i;break;}
      }
      if(count>1 && /^\s*[\/,]\s*$/.test(chars.slice(count).join(""))) {
        do{count--;}while(count>1&&/\s/.test(chars[count-1]));
      }
      lines.push(chars.slice(0,count).join("").trimEnd());rest=chars.slice(count).join("").trimStart();
    }
  }
  return lines;
}
export function layoutBoardMetadata(work:Pick<Work,"location"|"equipment"|"settings">,measure:TextMeasure) {
  let lineCount=0;
  const items=boardMetadataFields.filter(([key])=>work[key].trim()).map(([key,label])=>{
    const lines=wrapBoardMetadata(work[key],measure),startRow=lineCount;lineCount+=lines.length;
    return {key,label,lines,startRow};
  });
  const rows=items.flatMap(item=>item.lines.map((text,index)=>({key:item.key,label:index===0?item.label:"",text,topMm:metadataTypography.topMm+(item.startRow+index)*metadataTypography.lineHeightMm})));
  return {items,rows,lineCount,fits:lineCount<=metadataTypography.maxLines && rows.every(row=>measure(row.text,metadataTypography.fontSize)<=boardTextLayout.metadataWidth+.001)};
}
/** Keep the caption inside its physical print area, choosing the largest tenth of a point that fits. */
export function fitBoardCaption(value:string,measure:TextMeasure) {
  const atSize=(tenths:number)=>{
    const fontSize=tenths/10, lineHeightMm=captionTypography.lineHeightMm*fontSize/captionTypography.maxFontSize;
    const lines=wrapBoardText(value,fontSize,boardTextLayout.bodyWidth,measure);
    const heightMm=(lines.length-1)*lineHeightMm+fontSize*25.4/72;
    return {fontSize,lineHeightMm,lines,fits:heightMm<=captionTypography.heightMm+.001 && lines.every(line=>measure(line,fontSize)<=boardTextLayout.bodyWidth+.001)};
  };
  const largest=atSize(captionTypography.maxFontSize*10);
  if(largest.fits)return largest;
  let low=captionTypography.minFontSize*10, high=captionTypography.maxFontSize*10-1, best=atSize(low);
  if(!best.fits)return best;
  while(low<high) {
    const mid=Math.ceil((low+high)/2), candidate=atSize(mid);
    if(candidate.fits){low=mid;best=candidate;}else high=mid-1;
  }
  return best;
}
export function contentTextIssues(content:SubmissionContent,measure?:TextMeasure):TextIssue[] {
  const issues:TextIssue[]=[];
  const limit=(path:string,label:string,value:string,max:number)=>{if(Array.from(value).length>max)issues.push({path,layout:true,message:`${label}の標準レイアウトの目安は${max}文字です。`});};
  for(const [key,label] of [["name","名前"],["authorName","作者名"],["grade","学年"]] as const) limit(key,label,content[key],textLimits[key]);
  for(const key of ["authorName","grade"] as const) if(/[\r\n\t]/.test(content[key])) issues.push({path:key,message:"作者名・学年は改行やタブを含めずに入力してください。"});
  if(measure && measure(content.authorName,14)+boardTextLayout.authorGap+measure(content.grade,10)>boardTextLayout.bodyWidth+.01) issues.push({path:"authorName",layout:true,message:"作者名と学年がタイトルボードの1行に収まりません。"});
  for(const work of content.works) {
    const prefix=`works.${work.id}.`;
    limit(prefix+"title","作品タイトル",work.title,textLimits.title);limit(prefix+"caption","キャプション",work.caption,textLimits.caption);
    if(/[\r\n\t]/.test(work.title)) issues.push({path:prefix+"title",message:"作品タイトルは改行やタブを含めずに入力してください。"});
    const structural=titleBoardIssues(work);
    issues.push(...titleBoardIssues(work,measure).map(issue=>({path:prefix+(issue.path==="title"?"title":"titleBoard."+issue.path),message:issue.message,...(!structural.some(s=>s.path===issue.path&&s.message===issue.message)?{layout:true as const}:{})})));
    if(measure && !fitBoardCaption(work.caption,measure).fits)issues.push({path:prefix+"caption",layout:true,message:"キャプションが標準の8ptの枠に収まりません。運営による配置調整が必要です。"});
    for(const [key,label] of boardMetadataFields) if(/\t/.test(work[key]))issues.push({path:prefix+key,message:`${label}にはタブを含めずに入力してください。`});
    if(measure) {
      const metadata=layoutBoardMetadata(work,measure);
      if(!metadata.fits) {
        const long=metadata.items.filter(item=>item.lines.length>1);
        for(const item of long.length?long:metadata.items)issues.push({path:prefix+item.key,layout:true,message:`撮影情報の標準は3項目で合計3行です（現在${metadata.lineCount}行）。${item.label}の配置調整が必要です。`});
      }
    }
    if(work.details) for(const [key,value]of Object.entries(work.details)) limit(prefix+"details."+key,"撮影情報",value,key==="shutterSpeed"?textLimits.shutterSpeed:key==="iso"?textLimits.iso:key==="fNumber"?textLimits.fNumber:textLimits.metadata);
  }
  return issues;
}
