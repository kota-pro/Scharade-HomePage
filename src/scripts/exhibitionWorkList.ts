import { createWorkTagMenu } from './exhibitionWorkTags.ts';
import { layoutEscape as esc } from '../lib/exhibitionLayoutScene.ts';
import { visibleLayoutWorks, workListColors, type WorkListColor, type WorkLocation } from '../lib/exhibitionWorkList.ts';
import type { LayoutWork } from '../lib/exhibitionTypes.ts';

type Options = {
  works: () => LayoutWork[]; placed: () => Set<string>; floor: () => boolean;
  selected: () => string | undefined; label: (work: LayoutWork) => string;
  choose: (work: LayoutWork) => void;
  locations: (id:string) => WorkLocation[]; locate: (location:WorkLocation) => void;
  tag: (id: string, color: WorkListColor | null, before: WorkListColor | null) => Promise<void>;
  message: (text: string, error?: boolean) => void;
  idle?: () => void;
};

export function createLayoutWorkList(options: Options) {
  let query = '', filter='all', panel: HTMLElement | undefined;
  let events: AbortController | undefined;
  const tagMenu = createWorkTagMenu({work: id => options.works().find(work => work.id === id), parent: () => panel!, focus: id => panel?.querySelector<HTMLButtonElement>(`[data-layout-work-tag="${id}"]`)?.focus({preventScroll: true}), redraw: () => redraw(), tag: options.tag, message: options.message, idle: options.idle});
  const available = (placed:Set<string>) => options.works().filter(work => filter==='all'||(filter==='placed')===placed.has(work.id));
  function entries() {
    const placedIds=options.placed(),all = available(placedIds), filtered = visibleLayoutWorks(all, query);
    return `<p class="layout-work-count" role="status">${filtered.length} / ${all.length}作品</p><div class="layout-work-list">${filtered.map(work => {
      const locations=options.locations(work.id),placed=placedIds.has(work.id),color = workListColors.find(color => color.id === work.listTag), disabled = !placed&&(options.floor() ? work.kind !== 'book' : work.kind === 'book');
      return `<div class="layout-work-entry" data-layout-work-entry="${work.id}"${color ? ` style="--work-tag:${color.color};--work-tag-background:${color.background}" data-work-tag="${color.id}"` : ''}><button type="button" class="secondary layout-work-choice" ${placed?`data-layout-work-locate="${work.id}"`:`data-layout-work-add="${work.id}"`} aria-pressed="${options.selected() === work.id}" ${disabled ? 'disabled' : ''}>${esc(options.label(work))}<small>${placed?`配置済み：${esc(locations.map(p=>p.label).join(" / "))} · 配置を表示`:'未配置'}</small></button><button type="button" class="layout-work-tag-button" data-layout-work-tag="${work.id}" aria-label="${esc(work.title)}の色タグ：${color?.label ?? '無色'}" title="色タグ：${color?.label ?? '無色'}" aria-haspopup="menu" ${tagMenu.isSaving(work.id) ? 'disabled' : ''}><span aria-hidden="true">${color ? '●' : '⋯'}</span></button></div>`;
    }).join('') || `<p class="exhibition-muted">${all.length ? '検索に一致する作品はありません。' : '未配置の作品はありません。'}</p>`}</div>`;
  }
  function html() {
    return `<label class="layout-work-search">作品を検索<input type="search" data-layout-work-search placeholder="作品名・作者名・LINE名" aria-label="作品名・作者名・LINE名で検索" value="${esc(query)}"/></label><label class="layout-work-filter">配置状況<select data-layout-work-filter>${[["all","すべての作品"],["unplaced","未配置"],["placed","配置済み"]].map(([value,label])=>`<option value="${value}" ${filter===value?"selected":""}>${label}</option>`).join("")}</select></label><p class="layout-panel-hint">配置済みの作品を押すと、その展示室・壁面へ移動します。右クリック、または右端のボタンから色タグを設定できます。色順に並び替わります。色タグは図面・書き出しには反映されません。</p><div data-layout-work-results>${entries()}</div>`;
  }
  const redraw = () => { const target = panel?.querySelector('[data-layout-work-results]'); if (target) target.innerHTML = entries(); };
  function bind(target: HTMLElement) {
    events?.abort(); tagMenu.close(); panel = target;
    const controller = new AbortController(); events = controller;
    panel.querySelector<HTMLInputElement>('[data-layout-work-search]')?.addEventListener('input', event => { query = (event.target as HTMLInputElement).value; redraw(); }, { signal: controller.signal });
    panel.querySelector<HTMLSelectElement>('[data-layout-work-filter]')?.addEventListener('change',event=>{filter=(event.target as HTMLSelectElement).value;redraw();},{signal:controller.signal});
    panel.addEventListener('click', event => {
      const target = event.target as Element, tag = target.closest<HTMLElement>('[data-layout-work-tag]');
      if (tag && !tag.hasAttribute('disabled')) { const r = tag.getBoundingClientRect(); tagMenu.open(tag.dataset.layoutWorkTag!, r.right, r.bottom); return; }
      const locate=target.closest<HTMLButtonElement>('[data-layout-work-locate]');
      if(locate){const location=options.locations(locate.dataset.layoutWorkLocate!)[0];if(location)options.locate(location);else options.message('配置先が変更されています。一覧を確認してください。',true);return;}
      const button = target.closest<HTMLButtonElement>('[data-layout-work-add]');
      if (button && !button.disabled) { const work = options.works().find(work => work.id === button.dataset.layoutWorkAdd); if (work && !options.placed().has(work.id)) options.choose(work); }
    }, { signal: controller.signal });
    panel.addEventListener('contextmenu', event => {
      const entry = (event.target as Element).closest<HTMLElement>('[data-layout-work-entry]');
      if (entry) { event.preventDefault(); tagMenu.open(entry.dataset.layoutWorkEntry!, event.clientX, event.clientY); }
    }, { signal: controller.signal });
    panel.addEventListener('keydown', event => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      const entry = (event.target as Element).closest<HTMLElement>('[data-layout-work-entry]');
      if (entry) { event.preventDefault(); const r = entry.getBoundingClientRect(); tagMenu.open(entry.dataset.layoutWorkEntry!, r.left, r.bottom); }
    }, { signal: controller.signal });
  }
  return { html, bind, close: () => { events?.abort(); tagMenu.close(); }, isMenuOpen: tagMenu.isOpen };
}
