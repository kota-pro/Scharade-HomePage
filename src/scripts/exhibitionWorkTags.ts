import { workListColors, type WorkListColor } from '../lib/exhibitionWorkList.ts';
import type { LayoutWork } from '../lib/exhibitionTypes.ts';

export type WorkTagSaver = (id: string, color: WorkListColor | null, before: WorkListColor | null) => Promise<void>;
/** Both staff views edit the same per-work tag without changing submitted content. */
export function createWorkTagMenu(options: {
  work: (id: string) => Pick<LayoutWork, 'id' | 'title' | 'listTag'> | undefined;
  parent: () => HTMLElement; focus: (id: string) => void; redraw: () => void;
  tag: WorkTagSaver; message: (text: string, error?: boolean) => void; idle?: () => void;
}) {
  let menu: HTMLElement | undefined, menuEvents: AbortController | undefined;
  const saving = new Set<string>();
  function closeMenu(restoreFocus = false) {
    const wasOpen = !!menu;
    const workId = menu?.dataset.workId;
    menuEvents?.abort(); menuEvents = undefined; menu?.remove(); menu = undefined;
    if (restoreFocus && workId) options.focus(workId);
    if (wasOpen) options.idle?.();
  }
  function openMenu(workId: string, x: number, y: number) {
    const work = options.work(workId);
    if (!work || saving.has(workId)) return;
    closeMenu();
    const before = work.listTag ?? null, popup = document.createElement('div');
    menu = popup; popup.className = 'layout-work-tag-menu'; popup.dataset.workId = workId;
    popup.setAttribute('popover', 'manual');
    popup.setAttribute('role', 'menu'); popup.setAttribute('aria-label', `${work.title}の色タグ`);
    popup.innerHTML = `<p>色タグ</p>${[...workListColors, { id: '', label: '無色', color: 'transparent' }].map(color => `<button type="button" role="menuitemradio" aria-checked="${(before ?? '') === color.id}" data-work-color="${color.id}"><span class="layout-work-swatch" style="--work-tag:${color.color}" aria-hidden="true"></span>${color.label}<span class="layout-work-tag-check" aria-hidden="true">${(before ?? '') === color.id ? '✓' : ''}</span></button>`).join('')}`;
    (options.parent().closest('dialog') ?? options.parent()).append(popup);
    try { popup.showPopover?.(); } catch { /* Fixed-position fallback for older browsers. */ }
    const position = () => {
      const rect = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    };
    position();
    popup.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus({ preventScroll: true });
    const controller = new AbortController(); menuEvents = controller;
    popup.addEventListener('click', async event => {
      const button = (event.target as Element).closest<HTMLElement>('[data-work-color]');
      if (!button) return;
      const color = (button.dataset.workColor || null) as WorkListColor | null;
      closeMenu(true);
      if (color === before) return;
      saving.add(workId); options.redraw();
      try { await options.tag(workId, color, before); options.message('色タグを保存しました。'); }
      catch (error) { options.message(error instanceof Error ? error.message : '色タグを保存できませんでした。', true); }
      finally { saving.delete(workId); options.redraw(); }
    });
    window.addEventListener('pointerdown', event => { if (!popup.contains(event.target as Node)) closeMenu(); }, { capture: true, signal: controller.signal });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(true); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const buttons = [...popup.querySelectorAll<HTMLButtonElement>('button')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
      if (event.key === 'Tab') closeMenu();
    }, { capture: true, signal: controller.signal });
    window.addEventListener('resize', position, { signal: controller.signal });
  }
  return { open: openMenu, close: closeMenu, isOpen: () => !!menu, isSaving: (id: string) => saving.has(id) };
}
