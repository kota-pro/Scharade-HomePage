import type { SubmissionContent, WorkDetails } from "./exhibitionTypes.ts";
export const textLimits = { name:80, authorName:80, grade:20, title:80, caption:400, metadata:100, shutterSpeed:40, iso:20, fNumber:20 };
// The bundled Zen Old Mincho Bold 「 has minX=618 / unitsPerEm=1000 at 21pt.
export const titleBracketInsetMm = 618 / 1000 * 21 * 25.4 / 72;
export const titleOriginMm = 8 - titleBracketInsetMm;
export const boardTextLayout = { titleWidth:105 - 8 - titleOriginMm, bodyWidth:89, metadataWidth:51, captionLines:4, authorGap:6.5 };
export const prefectures = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
export const emptyWorkDetails = (): WorkDetails => ({place:"",prefecture:"",region:"",camera:"",lens:"",film:"",shutterSpeed:"",iso:"",fNumber:""});
export function metadataStrings(details: WorkDetails) {
  const join=(values:string[],separator:string)=>values.map(v=>v.trim()).filter(Boolean).join(separator);
  const iso=details.iso.trim().replace(/^ISO\s*/i,""), f=details.fNumber.trim().replace(/^F\s*\/?\s*/i,"");
  return {location:join([details.place,details.prefecture==="海外・その他"?details.region:details.prefecture]," / "),equipment:join([details.camera,details.lens,details.film]," / "),settings:join([details.shutterSpeed,iso?`ISO${iso}`:"",f?`F${f}`:""],", ")};
}
export type TextIssue = { path:string; message:string };
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
export function contentTextIssues(content:SubmissionContent,measure?:TextMeasure):TextIssue[] {
  const issues:TextIssue[]=[];
  const limit=(path:string,label:string,value:string,max:number)=>{if(Array.from(value).length>max)issues.push({path,message:`${label}は${max}文字以内で入力してください。`});};
  for(const [key,label] of [["name","名前"],["authorName","作者名"],["grade","学年"]] as const) limit(key,label,content[key],textLimits[key]);
  for(const key of ["authorName","grade"] as const) if(/[\r\n\t]/.test(content[key])) issues.push({path:key,message:"作者名・学年は改行やタブを含めずに入力してください。"});
  if(measure && measure(content.authorName,14)+boardTextLayout.authorGap+measure(content.grade,10)>boardTextLayout.bodyWidth+.01) issues.push({path:"authorName",message:"作者名と学年がタイトルボードの1行に収まりません。"});
  for(const work of content.works) {
    const prefix=`works.${work.id}.`;
    limit(prefix+"title","作品タイトル",work.title,textLimits.title);limit(prefix+"caption","キャプション",work.caption,textLimits.caption);
    if(/[\r\n\t]/.test(work.title)) issues.push({path:prefix+"title",message:"作品タイトルは改行やタブを含めずに入力してください。"});
    if(measure && measure(`「${work.title}」`,21,true)>boardTextLayout.titleWidth+.01)issues.push({path:prefix+"title",message:"作品タイトルがタイトルボードの1行に収まりません（全角約10文字が目安です）。"});
    if(measure && wrapBoardText(work.caption,10,boardTextLayout.bodyWidth,measure).length>boardTextLayout.captionLines)issues.push({path:prefix+"caption",message:"キャプションがタイトルボードの4行に収まりません（全角約100文字が目安です）。"});
    for(const [key,label] of [["location","撮影場所"],["equipment","使用機材"],["settings","撮影設定"]] as const) if(measure && (/[\r\n\t]/.test(work[key])||measure(work[key],8)>boardTextLayout.metadataWidth+.01))issues.push({path:prefix+key,message:`${label}がタイトルボードの1行に収まりません。`});
    if(work.details) for(const [key,value]of Object.entries(work.details)) limit(prefix+"details."+key,"撮影情報",value,key==="shutterSpeed"?textLimits.shutterSpeed:key==="iso"?textLimits.iso:key==="fNumber"?textLimits.fNumber:textLimits.metadata);
  }
  return issues;
}
