import { createSeriesEditor } from './exhibitionSeriesEditor';
import { paperSizes, paperSizeId } from '../lib/exhibitionEditing.ts';
import { layoutBounds, layoutDescription } from '../lib/exhibitionGeometry.ts';
import type { Work } from '../lib/exhibitionTypes.ts';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type Options = Parameters<typeof createSeriesEditor>[0] & { closed?: () => void; fixedPhotos?: boolean };

/** Keep the dialog outside the form so autosave/redraw never closes the editor. */
export function createSeriesDialog(options: Options) {
  let dialog: HTMLDialogElement | undefined, owner: HTMLElement | undefined;
  let workId = '', opener: HTMLElement | undefined;
  let restoreOverflow = '', pageX = 0, pageY = 0;
  const editor = createSeriesEditor({
    ...options,
    width: () => dialog?.querySelector<HTMLElement>('[data-series-dialog-body]')?.clientWidth || options.width(),
    change: () => { options.change(); paint(); },
  });
  const close = () => dialog?.close();
  const changed = (reset = false) => {
    if (reset) editor.reset(workId);
    options.change(); paint();
  };
  function html(work: Work, label = '組写真ツールを開く') {
    if (work.kind !== 'series') return '';
    return `<div class="series-launcher"><p class="exhibition-muted">${work.photos.length ? `全体：${escape(layoutDescription(work.photos))}` : '写真を追加して配置してください。'}</p><button type="button" class="exhibition-button secondary" data-series-open="${work.id}" aria-haspopup="dialog">${escape(label)}</button></div>`;
  }
  function photoFields(work: Work) {
    return `<section class="series-photo-properties"><h3>写真のサイズ・位置</h3>${work.photos.map((p, i) => `<details data-series-dimensions="${i}"><summary>写真 ${i + 1}（${p.width} × ${p.height} mm）</summary><div class="exhibition-grid"><label>写真サイズ<select data-series-paper="${i}"><option value="custom">自由入力</option>${paperSizes.map(s => `<option value="${s.id}" ${paperSizeId(p) === s.id ? 'selected' : ''}>${'label' in s ? s.label : s.id}（${s.width}×${s.height}mm）</option>`).join('')}</select></label><label>紙の向き<select data-series-orientation="${i}"><option value="portrait" ${p.width <= p.height ? 'selected' : ''}>縦</option><option value="landscape" ${p.width > p.height ? 'selected' : ''}>横</option></select></label>${(['width', 'height', 'x', 'y', 'rotation'] as const).map((key, n) => `<label>${['幅 mm', '高さ mm', 'X mm', 'Y mm', '回転 °'][n]}<input type="number" step=".1" min="${n < 2 ? '.1' : key === 'rotation' ? '-360' : '-100000'}" max="${key === 'rotation' ? '360' : '100000'}" data-series-photo-key="${key}" data-series-index="${i}" value="${p[key]}"/></label>`).join('')}</div><button type="button" class="secondary" data-series-remove-photo="${i}" aria-label="写真 ${i + 1}を削除">この写真を削除</button></details>`).join('')}<div class="exhibition-actions"><span>${work.photos.length}枚 / 100枚まで</span><button type="button" class="secondary" data-series-add-photo ${work.photos.length >= 100 ? 'disabled' : ''}>＋ 写真を追加</button></div></section>`;
  }
  function paint() {
    if (!dialog?.open) return;
    const work = options.getWork(workId); if (!work) { close(); return; }
    const body = dialog.querySelector<HTMLElement>('[data-series-dialog-body]')!;
    const active = document.activeElement as HTMLElement | null;
    const focus = body.contains(active) ? active?.dataset.seriesFocus : undefined;
    const top = body.scrollTop, left = body.scrollLeft;
    const expanded = [...body.querySelectorAll<HTMLDetailsElement>('details[open][data-series-dimensions]')].map(d => d.dataset.seriesDimensions);
    body.querySelectorAll('[data-series-editor]').forEach(el => el.dispatchEvent(new Event('series:dispose')));
    body.innerHTML = `${editor.html(work) || '<p class="exhibition-muted">写真を追加すると、配置ツールが表示されます。</p>'}${photoFields(work)}`;
    if (options.fixedPhotos) body.querySelectorAll('[data-series-add-photo],[data-series-remove-photo]').forEach(el => el.remove());
    body.querySelectorAll<HTMLElement>('input,select,button,figure').forEach((el, i) => { el.dataset.seriesFocus = String(i); });
    for (const index of expanded) body.querySelector<HTMLDetailsElement>(`[data-series-dimensions="${index}"]`)?.setAttribute('open', '');
    editor.bind(body);
    const editable = () => !options.busy() && options.getWork(workId) === work;
    body.querySelectorAll<HTMLInputElement>('[data-series-photo-key]').forEach(input => input.addEventListener('change', () => {
      if (!editable()) return;
      const p = work.photos[Number(input.dataset.seriesIndex)], key = input.dataset.seriesPhotoKey as 'width' | 'height' | 'x' | 'y' | 'rotation';
      if (!p || !input.checkValidity() || input.value === '') { input.reportValidity(); return; }
      p[key] = Number(input.value); changed();
    }));
    body.querySelectorAll<HTMLSelectElement>('[data-series-paper],[data-series-orientation]').forEach(input => input.addEventListener('change', () => {
      if (!editable()) return;
      const p = work.photos[Number(input.dataset.seriesPaper ?? input.dataset.seriesOrientation)]; if (!p) return;
      if (input.dataset.seriesPaper !== undefined) {
        const size = paperSizes.find(s => s.id === input.value);
        if (size) { const landscape = p.width > p.height; p.width = landscape ? size.height : size.width; p.height = landscape ? size.width : size.height; }
      } else { const w = Math.min(p.width, p.height), h = Math.max(p.width, p.height); p.width = input.value === 'landscape' ? h : w; p.height = input.value === 'landscape' ? w : h; }
      changed();
    }));
    body.querySelector('[data-series-add-photo]')?.addEventListener('click', () => {
      if (!editable() || work.photos.length >= 100) return;
      const bounds = layoutBounds(work.photos);
      work.photos.push({ assetId: '', x: work.photos.length ? bounds.x + bounds.width + 10 : 0, y: bounds.y, width: 120, height: 80, rotation: 0 });
      changed(true); body.querySelector<HTMLElement>('[data-series-add-photo]')?.focus({ preventScroll: true });
    });
    body.querySelectorAll<HTMLButtonElement>('[data-series-remove-photo]').forEach(button => button.addEventListener('click', () => {
      if (!editable()) return;
      work.photos.splice(Number(button.dataset.seriesRemovePhoto), 1);
      changed(true); body.querySelector<HTMLElement>('[data-series-add-photo]')?.focus({ preventScroll: true });
    }));
    if (options.busy()) body.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select').forEach(el => { el.disabled = true; });
    if (focus !== undefined) body.querySelector<HTMLElement>(`[data-series-focus="${focus}"]`)?.focus({ preventScroll: true });
    body.scrollTop = top; body.scrollLeft = left;
  }
  function open(id: string, trigger?: HTMLElement) {
    if (options.busy() || options.getWork(id)?.kind !== 'series') return;
    if (dialog) { close(); return; }
    workId = id; opener = trigger; pageX = window.scrollX; pageY = window.scrollY;
    dialog = document.createElement('dialog');
    dialog.className = 'exhibition-confirm-dialog exhibition-page series-editor-dialog';
    dialog.setAttribute('aria-label', '組写真の配置・サイズ編集');
    dialog.innerHTML = `<header class="exhibition-confirm-header"><div><h2>組写真の配置</h2><p>${escape(options.getWork(id)?.title || '無題')}</p></div><button type="button" class="layout-close" data-series-dialog-close aria-label="組写真ツールを閉じる"><span></span><span></span></button></header><div class="series-dialog-body" data-series-dialog-body></div><div class="series-dialog-footer"><p>変更した配置はフォームに反映されます。閉じると入力画面に戻ります。</p><button type="button" data-series-dialog-close>配置を反映して閉じる</button></div>`;
    document.body.append(dialog); restoreOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const resize = () => { if (!dialog?.querySelector('[data-dragging="true"]')) paint(); };
    window.addEventListener('resize', resize);
    dialog.querySelectorAll('[data-series-dialog-close]').forEach(b => b.addEventListener('click', close));
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopPropagation();
      if (dialog?.querySelector('figure.selected,.series-gap-pick')) dialog.querySelectorAll('[data-series-editor]').forEach(el => el.dispatchEvent(new Event('series:clear-selection')));
      else close();
    }, true);
    dialog.addEventListener('close', () => {
      dialog?.querySelectorAll('[data-series-editor]').forEach(el => el.dispatchEvent(new Event('series:clear-selection')));
      window.removeEventListener('resize', resize); document.body.style.overflow = restoreOverflow;
      dialog?.remove(); dialog = undefined; options.closed?.();
      (opener?.isConnected ? opener : owner?.querySelector<HTMLElement>(`[data-series-open="${id}"]`))?.focus({ preventScroll: true });
      window.scrollTo({ left: pageX, top: pageY, behavior: 'instant' });
    }, { once: true });
    dialog.showModal(); paint();
  }
  function bind(root: HTMLElement) {
    owner = root;
    root.querySelectorAll<HTMLButtonElement>('[data-series-open]').forEach(button => button.addEventListener('click', () => open(button.dataset.seriesOpen!, button)));
  }
  return { html, bind, open, close, reset: (id: string) => editor.reset(id) };
}
