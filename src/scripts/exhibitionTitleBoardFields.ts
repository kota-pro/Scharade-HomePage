import {titleBoardSettings,setTitleBoardSettings,titleRubyRows,titleRubyPath,reconcileTitleRuby} from '../lib/exhibitionTitleText.ts';
import type { Work,TitleRuby } from '../lib/exhibitionTypes.ts';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function rowsHtml(work:Work) {
  const rows=titleRubyRows(work);
  return `<div class="title-ruby-heading"><span>対象の漢字・語句</span><span>ふりがな</span></div>${rows.map(entry=>`<div class="title-ruby-row"><span><strong>${escape(entry.base)}</strong><small>${entry.start+1}${entry.end>entry.start+1?'〜'+entry.end:''}文字目${entry.group?'・語句':''}</small></span><label><span class="se-sr">${escape(entry.base)}（${entry.start+1}文字目）のふりがな</span><input type="text" data-work-id="${work.id}" data-titleboard-path="${titleRubyPath(entry)}" data-title-ruby-reading data-ruby-start="${entry.start}" data-ruby-end="${entry.end}" data-ruby-group="${!!entry.group}" maxlength="160" value="${escape(entry.reading)}"/></label>${entry.group?`<button type="button" class="secondary title-ruby-remove" data-title-ruby-remove="${entry.start}:${entry.end}" aria-label="${escape(entry.base)}の語句設定を解除">解除</button>`:'<span></span>'}</div>`).join('')||'<p class="exhibition-muted">タイトルに漢字を入力すると、漢字ごとの入力欄が表示されます。</p>'}`;
}
export function photographyChoiceHtml(workId:string, noPhotography = false) {
  const name = `photography-${escape(workId)}`;
  return `<fieldset class="titleboard-photography"><legend>展示作品の撮影可否</legend>
    <label class="exhibition-check"><input type="radio" name="${name}" data-photography-choice value="ok" ${noPhotography?'':'checked'}/>撮影OK</label>
    <label class="exhibition-check"><input type="radio" name="${name}" data-photography-choice value="ng" ${noPhotography?'checked':''}/>撮影NG</label>
    <p class="exhibition-muted">撮影NGを選ぶと、タイトルボードの右上に撮影禁止マークが表示されます。</p>
  </fieldset>`;
}
export function titleBoardFieldsHtml(work:Work) {
  const settings=titleBoardSettings(work);
  return `<fieldset class="titleboard-settings" data-titleboard-work="${work.id}"><legend>タイトルボードの表示</legend>${photographyChoiceHtml(work.id,settings.noPhotography)}<label class="exhibition-check"><input type="checkbox" data-work-id="${work.id}" data-titleboard-quoted data-titleboard-path="quoted" ${settings.quoted?'checked':''}/>タイトルを「」で囲む</label><label class="exhibition-check"><input type="checkbox" data-work-id="${work.id}" data-titleboard-enabled data-titleboard-path="rubyEnabled" ${settings.rubyEnabled?'checked':''}/>タイトルにふりがなを付ける</label><div data-titleboard-ruby-pane ${settings.rubyEnabled?'':'hidden'}><p class="exhibition-muted">通常は漢字1文字ごとに読みを入力します（7pt）。熟語や特別な読みは、下の「語句を追加」からまとめて指定できます。</p><div data-title-ruby-rows>${rowsHtml(work)}</div><div class="title-ruby-add"><label>対象の語句<input type="text" data-title-ruby-target placeholder="例：永遠" maxlength="300"/></label><label data-title-ruby-occurrence-label hidden>対象箇所<select data-title-ruby-occurrence></select></label><button type="button" class="secondary" data-title-ruby-add disabled>語句を追加</button></div><p class="exhibition-muted">追加した語句の読みは、その語句全体の中央に配置します。読みを付けない漢字の欄は空欄で構いません。</p><p data-title-ruby-message role="status" class="exhibition-text-warning" hidden></p></div><p data-titleboard-errors="${work.id}" class="exhibition-text-warning" aria-live="polite" hidden></p></fieldset>`;
}
export function bindTitleBoardFields(root:HTMLElement,options:{work:(id:string)=>Work|undefined;change:()=>void;disabled?:()=>boolean}) {
  for(const panel of root.querySelectorAll<HTMLElement>('[data-titleboard-work]')) {
    const work=options.work(panel.dataset.titleboardWork!);if(!work)continue;
    const pane=panel.querySelector<HTMLElement>('[data-titleboard-ruby-pane]')!,rows=panel.querySelector<HTMLElement>('[data-title-ruby-rows]')!,target=panel.querySelector<HTMLInputElement>('[data-title-ruby-target]')!,occurrence=panel.querySelector<HTMLSelectElement>('[data-title-ruby-occurrence]')!,occurrenceLabel=panel.querySelector<HTMLElement>('[data-title-ruby-occurrence-label]')!,add=panel.querySelector<HTMLButtonElement>('[data-title-ruby-add]')!,message=panel.querySelector<HTMLElement>('[data-title-ruby-message]')!;
    const update=(action:(value:ReturnType<typeof titleBoardSettings>)=>void)=>{if(options.disabled?.())return;const value=structuredClone(titleBoardSettings(work));action(value);setTitleBoardSettings(work,value);options.change();};
    const notify=(text='')=>{message.textContent=text;message.hidden=!text;};
    function matches() {
      const chars=Array.from(work!.title),base=Array.from(target.value.trim()),groups=titleBoardSettings(work!).ruby.filter(entry=>entry.group);
      if(base.length<2)return [];
      return chars.flatMap((_,start)=>chars.slice(start,start+base.length).join('')===base.join('')&&!groups.some(group=>group.start<start+base.length&&start<group.end)?[start]:[]);
    }
    function refreshTarget() {
      const starts=matches(),previous=occurrence.value;
      occurrence.innerHTML=starts.map(start=>`<option value="${start}">${start+1}〜${start+Array.from(target.value.trim()).length}文字目</option>`).join('');
      if(previous!==''&&starts.includes(Number(previous)))occurrence.value=previous;
      occurrenceLabel.hidden=starts.length<2;add.disabled=!starts.length||!!options.disabled?.();
    }
    function refreshRows() {rows.innerHTML=rowsHtml(work!);refreshTarget();}
    panel.addEventListener('change',event=>{
      const input=event.target;
      if(input instanceof HTMLInputElement && input.matches('[data-photography-choice]') && input.checked) {
        update(value=>{value.noPhotography=input.value==='ng';});
      }
    });
    panel.querySelector<HTMLInputElement>('[data-titleboard-quoted]')!.addEventListener('change',event=>update(value=>{value.quoted=(event.target as HTMLInputElement).checked;}));
    panel.querySelector<HTMLInputElement>('[data-titleboard-enabled]')!.addEventListener('change',event=>{update(value=>{value.rubyEnabled=(event.target as HTMLInputElement).checked;});pane.hidden=!titleBoardSettings(work!).rubyEnabled;});
    panel.addEventListener('input',event=>{
      const input=event.target as HTMLInputElement;
      if(!input.matches('[data-title-ruby-reading]'))return;
      const start=Number(input.dataset.rubyStart),end=Number(input.dataset.rubyEnd),group=input.dataset.rubyGroup==='true';
      update(value=>{const next:TitleRuby={start,end,base:Array.from(work!.title).slice(start,end).join(''),reading:input.value,...(group?{group:true}:{})};value.ruby=value.ruby.filter(entry=>!(entry.start===start&&entry.end===end&&!!entry.group===group)).concat(next);});
    });
    panel.addEventListener('click',event=>{
      const button=(event.target as Element).closest<HTMLElement>('[data-title-ruby-remove]');if(!button)return;
      const [start,end]=button.dataset.titleRubyRemove!.split(':').map(Number);update(value=>{value.ruby=value.ruby.filter(entry=>!entry.group||entry.start!==start||entry.end!==end);});refreshRows();options.change();
    });
    target.addEventListener('input',()=>{notify();refreshTarget();});
    add.addEventListener('click',()=>{
      if(options.disabled?.())return;
      const start=Number(occurrence.value),base=target.value.trim();
      if(!matches().includes(start)){notify('タイトル中の、漢字を含む2文字以上の語句を入力してください。');return;}
      if(!Array.from(base).some(c=>/[\p{Script=Han}々〆〇]/u.test(c))){notify('漢字を含む語句を指定してください。');return;}
      const end=start+Array.from(base).length;
      update(value=>{value.ruby.push({start,end,base,reading:'',group:true});});refreshRows();target.value='';refreshTarget();notify();
      panel.querySelector<HTMLInputElement>(`[data-title-ruby-reading][data-ruby-start="${start}"][data-ruby-end="${end}"][data-ruby-group="true"]`)?.focus({preventScroll:true});options.change();
    });
    const title=root.querySelector<HTMLInputElement>(`[data-work-id="${work.id}"][data-work-key="title"]`);
    if(title){let previous=work.title;const changed=()=>{if(options.disabled?.())return;reconcileTitleRuby(work!,previous,title.value);work!.title=title.value;previous=title.value;refreshRows();notify();options.change();};title.addEventListener('input',event=>{if(!(event as InputEvent).isComposing)changed();});title.addEventListener('compositionend',changed);}
    refreshTarget();
  }
}
