import type { TitleBoardSettings, TitleRuby, Work } from './exhibitionTypes.ts';

export const titleTypography = { fontSize:21, topMm:8.5, rubyFontSize:7, rubyBaselineMm:8, leftMm:8, rightMm:97 };
export const photographyMarkFrame = { x:84.2, y:7.8, size:13.7 };
// Preserve the existing optical alignment of the opening bracket.
export const titleBracketInsetMm = 618 / 1000 * 21 * 25.4 / 72;
export const titleOriginMm = 8 - titleBracketInsetMm;
export const titleRubyLimit = 40;
type TitleWork = Pick<Work,'title'|'titleBoard'>;
type Measure = (value:string,size:number,bold?:boolean)=>number;
export const isTitleKanji = (value:string) => /^[\p{Script=Han}々〆〇]$/u.test(value);
export function titleBoardSettings(work:Pick<Work,'titleBoard'>):TitleBoardSettings {
  return work.titleBoard ?? {quoted:true,rubyEnabled:false,ruby:[]};
}
export function titleRightMm(work:Pick<Work,'titleBoard'>) {
  return titleBoardSettings(work).noPhotography ? photographyMarkFrame.x - 2 : titleTypography.rightMm;
}
export function compactTitleBoard(settings:TitleBoardSettings):TitleBoardSettings|undefined {
  const ruby=settings.ruby.filter(entry=>entry.group||entry.reading.trim()).map(entry=>({...entry,reading:entry.reading.trim()})).sort((a,b)=>a.start-b.start||a.end-b.end||Number(!!a.group)-Number(!!b.group));
  if (settings.quoted && !settings.rubyEnabled && !ruby.length && !settings.noPhotography) return undefined;
  return {quoted:settings.quoted,rubyEnabled:settings.rubyEnabled,ruby,...(settings.noPhotography?{noPhotography:true}:{})};
}
export function setTitleBoardSettings(work:Pick<Work,'titleBoard'>,settings:TitleBoardSettings) {
  const value=compactTitleBoard(settings);if(value)work.titleBoard=value;else delete work.titleBoard;
}
/** Structural checks also run for drafts; final submission additionally verifies the selected text. */
export function parseTitleBoardSettings(value:unknown,title:string,final=true):TitleBoardSettings|undefined {
  if(value===undefined)return undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('タイトルボードの表示設定を確認してください。');
  const raw=value as Record<string,unknown>;
  if(typeof raw.quoted!=='boolean'||typeof raw.rubyEnabled!=='boolean'||!Array.isArray(raw.ruby)||raw.ruby.length>160)throw new Error('タイトルボードの表示設定を確認してください。');
  if(raw.noPhotography!==undefined&&typeof raw.noPhotography!=='boolean')throw new Error('作品の撮影可否を確認してください。');
  const chars=Array.from(title),keys=new Set<string>(),groups:TitleRuby[]=[];
  const ruby:TitleRuby[]=raw.ruby.map(input=>{
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('ふりがなの設定を確認してください。');
    const r=input as Record<string,unknown>,{start,end,base,reading}=r,group=r.group===true;
    if(!Number.isInteger(start)||!Number.isInteger(end)||Number(start)<0||Number(end)<=Number(start)||Number(end)>300||typeof base!=='string'||Array.from(base).length!==Number(end)-Number(start)||typeof reading!=='string'||Array.from(reading.trim()).length>titleRubyLimit||/[\x00-\x1f\x7f]/.test(base+reading)||r.group!==undefined&&r.group!==true)throw new Error(`ふりがなの文字・範囲を確認してください（読みは${titleRubyLimit}文字まで）。`);
    if(group?(Number(end)-Number(start)<2||!Array.from(base).some(isTitleKanji)):(Number(end)-Number(start)!==1||!isTitleKanji(base)))throw new Error('通常の読みは漢字1文字に設定し、追加する語句は漢字を含む2文字以上で指定してください。');
    if(final&&chars.slice(Number(start),Number(end)).join('')!==base)throw new Error('タイトルが変更されています。ふりがなの対象箇所を設定し直してください。');
    const key=`${start}:${end}:${group}`;if(keys.has(key))throw new Error('同じ箇所のふりがなが重複しています。');keys.add(key);
    const result:TitleRuby={start:Number(start),end:Number(end),base,reading:reading.trim(),...(group?{group:true}:{})};
    if(group){if(groups.some(other=>other.start<result.end&&result.start<other.end))throw new Error('追加した語句の範囲が重なっています。');groups.push(result);}
    return result;
  });
  return compactTitleBoard({quoted:raw.quoted,rubyEnabled:raw.rubyEnabled,ruby,noPhotography:raw.noPhotography===true});
}
export function titleRubyRows(work:TitleWork) {
  const chars=Array.from(work.title),settings=titleBoardSettings(work);
  const valid=settings.ruby.filter(entry=>chars.slice(entry.start,entry.end).join('')===entry.base);
  const groups=valid.filter(entry=>entry.group);
  const characters=chars.flatMap((base,start)=>isTitleKanji(base)&&!groups.some(group=>group.start<=start&&start<group.end)?[valid.find(entry=>!entry.group&&entry.start===start)??{start,end:start+1,base,reading:''}]:[]);
  return [...characters,...groups].sort((a,b)=>a.start-b.start||a.end-b.end);
}
export const titleRubyPath = (entry:TitleRuby) => `ruby.${entry.start}.${entry.end}.${entry.group?'group':'character'}.reading`;
/** Keep readings for unchanged prefixes/suffixes; never silently attach them to replacement text. */
export function reconcileTitleRuby(work:TitleWork,previousTitle:string,nextTitle:string) {
  if(!work.titleBoard||previousTitle===nextTitle)return;
  const a=Array.from(previousTitle),b=Array.from(nextTitle);let prefix=0,suffix=0;
  if(previousTitle.trim()===nextTitle.trim()) {
    const head=(value:string)=>Array.from(value.match(/^\s*/)?.[0]??'').length,delta=head(nextTitle)-head(previousTitle);
    setTitleBoardSettings(work,{...work.titleBoard,ruby:work.titleBoard.ruby.flatMap(entry=>{const moved={...entry,start:entry.start+delta,end:entry.end+delta};return moved.start>=0&&b.slice(moved.start,moved.end).join('')===moved.base?[moved]:[];})});return;
  }
  while(prefix<Math.min(a.length,b.length)&&a[prefix]===b[prefix])prefix++;
  while(suffix<Math.min(a.length,b.length)-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
  const ruby=work.titleBoard.ruby.flatMap(entry=>{
    const shifted=entry.end<=prefix?entry:entry.start>=a.length-suffix?{...entry,start:entry.start+b.length-a.length,end:entry.end+b.length-a.length}:undefined;
    return shifted&&b.slice(shifted.start,shifted.end).join('')===shifted.base?[shifted]:[];
  });
  setTitleBoardSettings(work,{...work.titleBoard,ruby});
}
export function layoutBoardTitle(work:TitleWork,measure:Measure) {
  const settings=titleBoardSettings(work),x=settings.quoted?titleOriginMm:titleTypography.leftMm;
  const text=settings.quoted?`「${work.title}」`:work.title,width=titleRightMm(work)-x;
  const rawX=x+(settings.quoted?measure('「',21,true):0),chars=Array.from(work.title);
  const ruby=settings.rubyEnabled?titleRubyRows(work).filter(entry=>entry.reading).map(entry=>{
    const baseX=rawX+measure(chars.slice(0,entry.start).join(''),21,true),baseWidth=measure(entry.base,21,true),rubyWidth=measure(entry.reading,7),center=baseX+baseWidth/2;
    return {...entry,x:center-rubyWidth/2,center,width:rubyWidth,baseX,baseWidth,topMm:titleTypography.rubyBaselineMm-7*25.4/72};
  }):[];
  return {text,x,width,rawX,ruby};
}
export function titleBoardIssues(work:TitleWork,measure?:Measure) {
  const issues:{path:string;message:string}[]=[],settings=titleBoardSettings(work),chars=Array.from(work.title);
  if(settings.rubyEnabled)for(const entry of settings.ruby){
    const path=titleRubyPath(entry);
    if(Array.from(entry.reading).length>titleRubyLimit||/[\x00-\x1f\x7f]/.test(entry.reading))issues.push({path,message:`ふりがなは改行を含めず${titleRubyLimit}文字以内で入力してください。`});
    if(chars.slice(entry.start,entry.end).join('')!==entry.base)issues.push({path,message:'タイトルが変わったため、ふりがなの対象箇所を確認してください。'});
    if(entry.group&&!entry.reading)issues.push({path,message:`追加した語句「${entry.base}」のふりがなを入力するか、語句を解除してください。`});
  }
  if(!measure)return issues;
  const layout=layoutBoardTitle(work,measure);
  if(measure(layout.text,21,true)>layout.width+.01)issues.push({path:'title',message:settings.noPhotography?'作品タイトルが撮影NGアイコン横の1行に収まりません。':'作品タイトルがタイトルボードの1行に収まりません（全角約10文字が目安です）。'});
  layout.ruby.forEach((entry,index)=>{
    if(entry.x<8-.01||entry.x+entry.width>titleRightMm(work)+.01)issues.push({path:titleRubyPath(entry),message:`「${entry.base}」のふりがなが印刷枠を超えます。読みを短くするか、語句の範囲を調整してください。`});
    const next=layout.ruby[index+1];if(next&&entry.x+entry.width+.35>next.x)issues.push({path:titleRubyPath(entry),message:`「${entry.base}」と「${next.base}」のふりがなが重なります。語句としてまとめるか、読みを調整してください。`});
  });
  return issues;
}
export function titleRubySummary(work:TitleWork) {
  return titleBoardSettings(work).rubyEnabled?titleRubyRows(work).filter(entry=>entry.reading).map(entry=>`${entry.base}（${entry.reading}）`).join(' ／ '):'';
}
