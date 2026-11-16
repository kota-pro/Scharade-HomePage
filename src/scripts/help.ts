import { searchHelp, sortHelpTasks, type HelpContext, type HelpGuide, type HelpStep, type HelpTask } from '../lib/helpTypes';
import { intersect, overlaps, placeHelpArrow, type HelpRect } from '../lib/helpPosition';
import { hasRole } from '../lib/roles';

type Frame = { id: string; entity?: string; path: string; index: number; history: number[] };
const catalogVersion = 5;
type Tour = Frame & { version: 1; catalog: typeof catalogVersion; viewer: string | null; authVersion?: number; hidden: boolean; parents: Frame[]; awaitingLogin?: boolean };
const storageKey = 'scharade-help-tour-v1';
const root = document.querySelector<HTMLElement>('[data-help-root]');
if (root) setupHelp(root);

function setupHelp(root: HTMLElement) {
  let overlays: HTMLElement[] = [];
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => (root.querySelector<T>(selector) || overlays.map(host => host.matches(selector) ? host as T : host.querySelector<T>(selector)).find(Boolean))!;
  const panel = get<HTMLDialogElement>('#help-panel'), launcher = get<HTMLButtonElement>('[data-help-open]');
  const banner = get('[data-help-tour]'), arrow = get('[data-help-arrow]');
  overlays = [banner, arrow, launcher];
  const query = get<HTMLInputElement>('#help-query'), searchResults = get('#help-search-results');
  const status = get('[data-help-status]'), selection = get('[data-help-selection]');
  const taskRoot = get('[data-help-tasks]'), accountingRoot = get('[data-help-accounting]');
  let context: HelpContext | undefined, guide: HelpGuide | undefined, tour: Tour | undefined;
  let target: HTMLElement | SVGElement | undefined, heading: HTMLElement | SVGElement | undefined;
  let busy = false, loadVersion = 0, positionFrame = 0, mutationTimer = 0, disposed = false;
  let lastActivated = '', waitingTimer = 0, localTasks: HelpTask[] = [], remoteTasks: HelpTask[] = [];
  function updateBadge() {
    const count = [...localTasks, ...remoteTasks].filter(task => !task.readState?.at).length;
    const badge = get('[data-help-badge]'); badge.hidden = count === 0; badge.textContent = count > 99 ? '99+' : String(count);
    launcher.setAttribute('aria-label', count ? `ヘルプを開く（やること${count}件）` : 'ヘルプを開く');
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved?.version === 1 && saved.catalog === catalogVersion && typeof saved.id === 'string' && typeof saved.path === 'string' && Number.isInteger(saved.index) && saved.index >= 0 && Array.isArray(saved.history) && saved.history.every((n: unknown) => Number.isInteger(n) && Number(n) >= 0) && Array.isArray(saved.parents)) tour = saved;
    else sessionStorage.removeItem(storageKey);
  } catch { /* Storage may be unavailable in private browsers. */ }

  const persist = () => { try { if (tour) sessionStorage.setItem(storageKey, JSON.stringify(tour)); else sessionStorage.removeItem(storageKey); } catch {} updateResume(); };
  function updateResume() {
    get('[data-help-resume-box]').hidden = !tour;
    if (tour) get('[data-help-resume-label]').textContent = `${guide?.title || '操作の説明'}を${tour.hidden ? '非表示・一時停止' : '案内'}中です。`;
  }
  function textElement(tag: string, text: string) { const el = document.createElement(tag); el.textContent = text; return el; }
  function resultButton(title: string, description: string, action: () => void) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'help-result';
    button.append(textElement('strong', title)); if (description) button.append(textElement('small', description));
    button.onclick = action; return button;
  }
  async function requestContext(id?: string, entity?: string, path = location.pathname) {
    const params = new URLSearchParams({ path }); if (id) params.set('guide', id); if (entity) params.set('entity', entity);
    const response = await fetch(`/api/help/context?${params}`, { signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || '案内を取得できませんでした。');
    return data as HelpContext;
  }
  async function loadContext() {
    const version = ++loadVersion;
    const data = await requestContext();
    if (disposed || version !== loadVersion) return;
    context = data;
    // A different person's session must never inherit a private workflow.
    if (tour?.viewer && (tour.viewer !== data.viewer?.id || tour.authVersion !== data.viewer?.authVersion)) endTour(false);
    updateSearch();
  }
  function updateSearch() {
    searchResults.replaceChildren();
    if (!query.value.trim() || !context) return;
    const matches = searchHelp(context.guides, query.value);
    if (!matches.length) { searchResults.append(textElement('p', '近い操作が見つかりません。「写真展」「参加」「立替」などでも検索できます。')); return; }
    for (const item of matches) searchResults.append(resultButton(item.title, item.description, () => void selectGuide(item.id)));
  }
  async function openPanel() {
    if (panel.open) return;
    document.querySelector<HTMLButtonElement>('body.open .toggle_btn')?.click();
    conceal(); panel.showModal(); launcher.setAttribute('aria-expanded', 'true');
    (matchMedia('(max-width: 768px), (pointer: coarse)').matches ? get('[data-help-close]') : query).focus({ preventScroll: true });
    status.textContent = '案内を読み込んでいます…';
    try { await loadContext(); status.textContent = ''; }
    catch { status.textContent = '案内を読み込めませんでした。「このページの使い方」から再試行できます。'; }
    updateResume(); void loadTasks();
  }
  function closePanel() { panel.close(); launcher.setAttribute('aria-expanded', 'false'); }
  launcher.onclick = () => void openPanel();
  get('[data-help-close]').onclick = closePanel;
  panel.addEventListener('close', () => { launcher.setAttribute('aria-expanded', 'false'); if (!tour || tour.hidden) launcher.focus({ preventScroll: true }); else if (guide?.steps[tour.index] && matchesPath(guide.steps[tour.index].path)) void showStep(false, false); });
  panel.addEventListener('click', event => { if (event.target === panel) { const r = panel.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right) closePanel(); } });
  query.addEventListener('input', updateSearch);
  query.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); searchResults.querySelector<HTMLButtonElement>('button')?.focus(); } });
  get<HTMLFormElement>('[data-help-search]').addEventListener('submit', event => {
    event.preventDefault(); updateSearch(); searchResults.querySelector<HTMLButtonElement>('button')?.focus();
  });
  get('[data-help-page]').onclick = () => void selectGuide('__page__');
  get('[data-help-tools]')?.addEventListener('click', () => {
    if (!context) return;
    showSelection('各ツール・機能説明', '現在の権限で利用できる機能を表示しています。項目を選ぶと使い方を確認できます。');
    const content = get('[data-help-selection-content]');
    const viewer = context.viewer;
    const guides = context.guides.filter(g => !g.minimum || hasRole(viewer, g.minimum));
    for (const category of [...new Set(guides.map(g => g.category))]) {
      content.append(textElement('h4', category));
      for (const item of guides.filter(g => g.category === category)) content.append(resultButton(item.title, item.description, () => describeGuide(item.id, item.title, item.description)));
    }
  });
  function showSelection(title: string, description: string) {
    selection.hidden = false; get('[data-help-selection-heading]').textContent = title;
    get('[data-help-selection-description]').textContent = description;
    get('[data-help-selection-content]').replaceChildren();
    get('[data-help-selection-heading]').focus({ preventScroll: true }); selection.scrollIntoView({ block: 'nearest' });
  }
  function describeGuide(id: string, title: string, description: string, entity?: string) {
    showSelection(title, description);
    get('[data-help-selection-content]').append(resultButton('手順を説明しますか？ ▶︎', '', () => void selectGuide(id, entity)));
  }
  function describeTask(task: HelpTask) {
    if (!task.readState) { describeGuide(task.guideId, task.title, task.description, task.entityId); return; }
    showSelection(task.title, task.description);
    const content = get('[data-help-selection-content]');
    const button = resultButton('このやることを確認する ▶︎', '', () => void confirmTask(task, button));
    content.append(button, textElement('small', '確認すると操作手順を案内します。完了するまでは下部の「未対応」に残ります。'));
  }
  async function confirmTask(task: HelpTask, button: HTMLButtonElement) {
    if (busy || button.disabled || !task.readState) return;
    button.disabled = true; status.textContent = 'やることを確認しています…';
    try {
      const response = await fetch('/api/help/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, version: task.readState.version, source: task.readState.source }), signal: AbortSignal.timeout(35000) });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        if (response.status === 409) {
          await loadTasks();
          const latest = [...localTasks, ...remoteTasks].find(t => t.id === task.id);
          if (latest) describeTask(latest); else selection.hidden = true;
        }
        throw new Error(data.message || '既読を保存できませんでした。もう一度お試しください。');
      }
      const update = (tasks: HelpTask[]) => tasks.flatMap(t => t.id !== task.id ? [t] : data.completed ? [] : [{ ...t, readState: t.readState?.version === task.readState!.version ? { ...t.readState, at: data.readAt } : t.readState }]);
      localTasks = update(localTasks); remoteTasks = update(remoteTasks); renderTasks();
      // Refreshing also prevents an earlier in-flight response from undoing the receipt.
      void loadTasks();
      if (data.completed) { selection.hidden = true; status.textContent = 'このやることは対応済みです。'; return; }
      await selectGuide(task.guideId, task.entityId);
    } catch (error) { status.textContent = error instanceof Error ? error.message : '既読を保存できませんでした。もう一度お試しください。'; }
    finally { button.disabled = false; }
  }
  get('[data-help-selection-close]').onclick = () => { selection.hidden = true; };

  let taskRun = 0;
  async function loadTasks() {
    const run = ++taskRun;
    if (!(context?.viewer?.approved ?? root.dataset.approved === '1')) {
      taskRoot.replaceChildren(textElement('p', 'ログインすると、自分の回答・提出や権限に応じた管理業務を確認できます。'));
      const link = document.createElement('a'); link.href = '/Login'; link.textContent = 'ログインする ▶︎'; taskRoot.append(link); accountingRoot.replaceChildren(); return;
    }
    get<HTMLButtonElement>('[data-help-refresh]').disabled = true;
    try {
      const response = await fetch('/api/help/tasks', { signal: AbortSignal.timeout(15000) }), data = await response.json();
      if (run !== taskRun || disposed) return;
      if (!response.ok || !data.ok) { if (response.status === 401) { endTour(false); localTasks = []; remoteTasks = []; updateBadge(); } throw new Error(); }
      localTasks = data.tasks; renderTasks();
      if (data.errors?.length) taskRoot.append(textElement('p', `${data.errors.join('・')}の取得に失敗しました。「更新」から再試行してください。`));
      if (context) context.completed = data.completed;
    } catch { if (run === taskRun) taskRoot.replaceChildren(textElement('p', 'やることを取得できませんでした。「更新」から再試行してください。')); }
    finally { if (run === taskRun) get<HTMLButtonElement>('[data-help-refresh]').disabled = false; }
    if (!['executive', 'admin'].includes(context?.viewer?.role || root.dataset.role || '') || run !== taskRun) return;
    accountingRoot.replaceChildren(textElement('p', '会計のやることを確認しています…'));
    try {
      const response = await fetch('/api/help/tasks?source=accounting', { signal: AbortSignal.timeout(35000) }), data = await response.json();
      if (run !== taskRun || disposed) return;
      if (!response.ok || !data.ok) throw new Error();
      remoteTasks = data.tasks; accountingRoot.replaceChildren(); renderTasks();
    } catch { if (run === taskRun) { accountingRoot.replaceChildren(textElement('p', '会計のやることを取得できませんでした。他の項目は利用できます。')); const retry = resultButton('会計を再読込', '', () => void loadTasks()); accountingRoot.append(retry); } }
  }
  function renderTasks() {
    updateBadge();
    taskRoot.replaceChildren(); const tasks = sortHelpTasks([...localTasks, ...remoteTasks]);
    if (!tasks.length) { taskRoot.append(textElement('p', '現在、対応が必要な項目はありません。')); return; }
    const sections = [
      { id: 'personal', title: '自分の回答・提出', items: tasks.filter(t => t.group === 'personal') },
      { id: 'management', title: tasks.some(t => t.readState) ? '管理業務（未読）' : '管理業務', items: tasks.filter(t => t.group === 'management' && !t.readState?.at) },
      { id: 'pending', title: '未対応', items: tasks.filter(t => t.group === 'management' && t.readState?.at) },
    ];
    for (const section of sections) {
      const items = section.items; if (!items.length) continue;
      const container = document.createElement('section'); container.dataset.helpTaskGroup = section.id;
      const title = textElement('h4', section.title); title.className = 'help-task-group'; container.append(title);
      if (section.id === 'pending') container.append(textElement('p', '確認済みで、まだ完了していない管理業務です。'));
      taskRoot.append(container);
      for (const task of items) {
        const button = resultButton(task.title, task.description, () => describeTask(task));
        button.dataset.helpTaskId = task.id;
        if (task.readState?.at) { const read = textElement('small', '既読・未対応'); read.className = 'help-task-read'; button.append(read); }
        if (task.dueAt) { const overdue = Date.parse(task.dueAt) <= Date.now(); const due = textElement('small', `${overdue ? '期限超過' : '期限'}：${new Date(task.dueAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}（日本時間）`); if (overdue) due.className = 'help-task-overdue'; button.append(due); }
        if (task.optional) button.append(textElement('small', '任意の回答')); container.append(button);
      }
    }
  }
  get('[data-help-refresh]').onclick = () => void loadTasks();

  async function selectGuide(id: string, entity?: string, nested = false) {
    if (busy) return;
    busy = true; status.textContent = '案内を準備しています…';
    try {
      if (!context) await loadContext();
      const metadata = context?.guides.find(g => g.id === id);
      if (metadata?.minimum === 'member' && !context?.viewer?.approved) {
        tour = { version: 1, catalog: catalogVersion, id, entity, path: '/Member', index: 0, history: [], viewer: null, hidden: false, parents: [], awaitingLogin: true };
        persist(); location.assign('/Login?next=%2FMember'); return;
      }
      if (id === '__page__') {
        const dialog = activeDialog();
        if (dialog?.matches('.room-edit-dialog')) id = 'layout-basic';
        else if (dialog?.matches('.board-manager')) id = 'exhibition-boards';
        else if (dialog?.matches('.exhibition-album-picker')) id = 'exhibition-lightroom';
        else if (dialog?.matches('#portfolio-series-editor')) id = 'portfolio-series-edit';
        else if (dialog?.matches('.series-editor-dialog') && matchesPath('/Portfolio/edit')) id = 'portfolio-series-layout';
        else if (dialog?.matches('#portfolio-book-editor')) id = 'portfolio-book-edit';
        else if (dialog?.matches('#photo-dialog[data-photo-book], #portfolio-book-reader')) id = 'portfolio-book-view';
        else if (dialog?.matches('.gallery-settings-dialog')) {
          id = dialog.querySelector('[data-gallery-settings-mode="exclusions"][aria-pressed="true"]') ? 'gallery-exclusions' : 'gallery-settings';
        }
        else if (dialog?.matches('#photo-dialog:has([data-gallery-film-editor][open]:not([hidden]))')) id = 'gallery-film';
        else if (dialog?.matches('#photo-dialog:has([data-photo-series-overview]:not([hidden]), [data-photo-series-back]:not([hidden]))')) id = 'photo-series-view';
      }
      const data = await requestContext(id, entity);
      const next = data.guide!;
      if (next.choices) {
        showSelection(next.title, next.choices.length ? '案内する対象を選んでください。' : next.empty || '対象がありません。');
        const content = get('[data-help-selection-content]');
        for (const choice of next.choices) content.append(resultButton(choice.title, '', () => void selectGuide(id, choice.id, nested)));
        status.textContent = ''; return;
      }
      const parents = nested && tour ? [...tour.parents, { id: tour.id, entity: tour.entity, path: tour.path, index: tour.index, history: tour.history }] : [];
      context = data; guide = next;
      tour = { version: 1, catalog: catalogVersion, id, entity, path: location.pathname, index: 0, history: [], viewer: data.viewer?.id || null, authVersion: data.viewer?.authVersion, hidden: false, parents };
      persist(); closePanel(); status.textContent = ''; await showStep(true, true);
    } catch (error) { status.textContent = error instanceof Error ? error.message : '案内を開始できませんでした。'; }
    finally { busy = false; }
  }

  function matchesPath(pattern: string) {
    const escaped = pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
    return new RegExp(`^${escaped}/?$`).test(location.pathname);
  }
  function visible(element: Element): element is HTMLElement | SVGElement {
    // Closed <details> can retain layout rectangles in some browsers. Its content
    // still cannot be operated until the disclosure is opened.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
    }
    const box = element.getBoundingClientRect();
    return (element instanceof HTMLElement || element instanceof SVGElement) && !element.closest('[hidden], [inert]') && !element.closest('dialog:not([open])') && getComputedStyle(element).visibility !== 'hidden' && element.checkVisibility?.() !== false && box.width > 0 && box.height > 0;
  }
  const activeDialog = () => [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(d => d !== panel).at(-1);
  function find(selector?: string): HTMLElement | SVGElement | undefined {
    if (!selector) return;
    // Alternatives are ordered by specificity in the catalogue, not by document order.
    // A fallback image or page heading must never beat the requested field/button.
    const scope = activeDialog() || document;
    try {
      for (const option of selector.split(/,(?![^()]*\))/)) {
        const element = [...scope.querySelectorAll(option.trim())].find(el => !el.closest('[data-help-root], [data-help-tour], [data-help-arrow], [data-help-open]') && visible(el));
        if (element) return element as HTMLElement | SVGElement;
      }
    } catch { /* Invalid or obsolete selectors have no highlight. */ }
  }
  function completed(step: HelpStep) {
    if (!step.complete) return false;
    if (step.complete.kind === 'saved') return context?.completed.includes(step.complete.key) || false;
    if (!matchesPath(step.path)) return false;
    if (step.complete.kind === 'present') return document.querySelector(step.complete.selector) !== null;
    const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(step.complete.selector)];
    return controls.length > 0 && controls.every(el => {
      if (el.disabled) return false;
      if (el instanceof HTMLInputElement && el.type === 'radio') return controls.some(other => other instanceof HTMLInputElement && other.type === 'radio' && other.name === el.name && other.form === el.form && other.checked) && el.checkValidity();
      return (el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value.trim() !== '') && el.checkValidity();
    });
  }
  function conceal() {
    clearTimeout(waitingTimer); lastActivated = '';
    if (target) resizeObserver.unobserve(target);
    target?.classList.remove('help-target'); heading?.classList.remove('help-marker'); target = heading = undefined;
    for (const host of [banner, arrow]) { try { host.hidePopover?.(); } catch {} host.hidden = true; }
  }
  function mountOverlay(host: HTMLElement) {
    const activeDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(d => d !== panel).at(-1);
    const parent = activeDialog || root;
    if (host.parentElement !== parent) parent.append(host);
    host.hidden = false;
    try { if (!host.matches(':popover-open')) host.showPopover?.(); } catch { /* Fixed positioning supports older WebViews. */ }
  }
  async function showStep(navigate: boolean, focus: boolean) {
    if (!tour || tour.hidden || !guide || panel.open) return;
    if (tour.index >= guide.steps.length) { await finishGuide(); return; }
    const step = guide.steps[tour.index];
    const onPage = matchesPath(step.path);
    if (!onPage) {
      if (navigate && !step.path.includes('*')) { persist(); location.assign(step.path); return; }
      if (!navigate) { tour.hidden = true; persist(); conceal(); return; }
    }
    conceal(); mountOverlay(banner);
    get('[data-help-step-number]').textContent = `${tour.index + 1}/${guide.steps.length}`;
    get('[data-help-tour-name]').textContent = guide.title;
    get('[data-help-step-title]').textContent = step.title;
    get('[data-help-step-text]').textContent = step.text;
    get('[data-help-target-status]').textContent = '';
    get<HTMLButtonElement>('[data-help-prev]').disabled = tour.history.length === 0 && tour.parents.length === 0;
    get('[data-help-next]').textContent = tour.index === guide.steps.length - 1 ? '説明を完了' : '次へ';
    get('[data-help-detail]').hidden = !availableDetails(step).length;
    persist();
    if (onPage) prepareTarget(step, true);
    else get('[data-help-target-status]').textContent = '先に対象を作成・選択してください。移動先の画面で案内を続けます。';
    if (focus) get('[data-help-step-title]').focus({ preventScroll: true });
  }
  function availableDetails(step: HelpStep) {
    return context?.guides.filter(g => g.detail && step.details?.includes(g.id)) || [];
  }
  function prepareTarget(step: HelpStep, scroll: boolean) {
    if (!tour || tour.hidden || panel.open || !matchesPath(step.path)) return;
    // Closing/removing an editor must not leave the guide inside its hidden subtree.
    mountOverlay(banner);
    if (step.reveal) document.querySelectorAll<HTMLDetailsElement>(step.reveal).forEach(d => { if (d instanceof HTMLDetailsElement) d.open = true; });
    // Only explicitly registered view controls are activated. Never submit a form here.
    if (step.activate && lastActivated !== `${guide?.id}:${step.id}`) {
      const control = find(step.activate);
      const activeDialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(d => d !== panel).at(-1);
      if (control instanceof HTMLElement && (!activeDialog || activeDialog.contains(control)) && !(control instanceof HTMLButtonElement && control.type === 'submit' && control.form)) { lastActivated = `${guide?.id}:${step.id}`; control.click(); }
    }
    clearTimeout(waitingTimer);
    let nextTarget = find(step.target);
    if (!nextTarget && step.target) {
      // Open enclosing details without requiring users to discover a hidden input.
      const hiddenTarget = (activeDialog() || document).querySelector<HTMLElement>(step.target);
      let parent = hiddenTarget?.parentElement;
      while (parent && parent !== document.body) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      nextTarget = find(step.target);
    }
    const scrollToNewTarget = scroll || target !== nextTarget;
    if (target !== nextTarget) { if (target) resizeObserver.unobserve(target); if (nextTarget) resizeObserver.observe(nextTarget); }
    target?.classList.remove('help-target'); heading?.classList.remove('help-marker');
    target = nextTarget;
    // Only mark the heading/label that actually belongs to this operation.
    const label = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement ? target.labels?.[0] : undefined;
    heading = find(step.heading) || (target?.matches('h1,h2,h3,h4,legend') ? target : target?.closest('tr')?.querySelector<HTMLElement>('th p,th') || (label && !label.contains(target!) ? label : undefined) || target?.closest('fieldset')?.querySelector<HTMLElement>('legend')) || undefined;
    heading?.classList.add('help-marker');
    if (!target) {
      hideArrow();
      waitingTimer = window.setTimeout(() => { if (tour && !tour.hidden && guide?.steps[tour.index]?.id === step.id) get('[data-help-target-status]').textContent = '該当の項目がまだ表示されていません。前の操作や受付期間を確認するか、「次へ」で説明を進められます。'; }, 2000);
      return;
    }
    clearTimeout(waitingTimer); get('[data-help-target-status]').textContent = '';
    if (!target.matches('h1,h2,h3,h4,legend')) target.classList.add('help-target');
    mountOverlay(banner);
    if (scrollToNewTarget) {
      banner.dataset.dock = 'bottom';
      scrollTarget(target);
    }
    queuePosition();
  }
  function viewport(): HelpRect {
    const v = window.visualViewport;
    return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0, right: (v?.offsetLeft || 0) + (v?.width || innerWidth), bottom: (v?.offsetTop || 0) + (v?.height || innerHeight) };
  }
  function headerBottom() { return Math.max(0, document.querySelector('body > header')?.getBoundingClientRect().bottom || 0); }
  function visibleRect(element: Element): HelpRect | undefined {
    const modal = activeDialog();
    const view = viewport();
    let r = intersect(element.getBoundingClientRect(), { ...view, top: modal ? view.top : Math.max(view.top, headerBottom()) });
    for (let p = element.parentElement; p && r; p = p.parentElement) {
      const style = getComputedStyle(p), bounds = p.getBoundingClientRect();
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX), clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
      if (clipX || clipY) r = intersect(r, { left: clipX ? bounds.left + p.clientLeft : r.left, right: clipX ? bounds.left + p.clientLeft + p.clientWidth : r.right, top: clipY ? bounds.top + p.clientTop : r.top, bottom: clipY ? bounds.top + p.clientTop + p.clientHeight : r.bottom });
      // A top-layer dialog is not clipped by the page behind it.
      if (p === modal) break;
    }
    return r;
  }
  function scrollTarget(element: HTMLElement | SVGElement) {
    const v = viewport(), br = banner.getBoundingClientRect();
    const top = Math.max(v.top, activeDialog() ? v.top : headerBottom()) + 56;
    const bottom = br.top - 14;
    // Move each scroll container separately: modal editors often have their own scroller.
    const modal = activeDialog();
    for (let p: Element | null = element.parentElement; p; p = p.parentElement) {
      const isPage = p === document.scrollingElement;
      if (!(p instanceof HTMLElement) || (!isPage && !/auto|scroll/.test(getComputedStyle(p).overflowY)) || p.scrollHeight <= p.clientHeight) { if (p === modal) break; continue; }
      const bounds = isPage ? v : p.getBoundingClientRect();
      const min = Math.max(top, bounds.top + 12), max = Math.min(bottom, bounds.bottom - 12);
      if (max <= min) continue;
      const r = element.getBoundingClientRect();
      if (r.top < min || r.bottom > max) p.scrollBy({ top: r.height > max - min ? r.top - min : (r.top + r.bottom - min - max) / 2, behavior: 'instant' });
      if (p === modal) break;
    }
  }
  function hideArrow() { try { arrow.hidePopover?.(); } catch {} arrow.hidden = true; }
  function queuePosition() { if (!positionFrame) positionFrame = requestAnimationFrame(position); }
  function position() {
    positionFrame = 0;
    if (!tour || tour.hidden || panel.open || !target) { hideArrow(); return; }
    if (!visible(target)) { hideArrow(); if (guide) prepareTarget(guide.steps[tour.index], false); return; }
    let r = visibleRect(target);
    if (!r) { hideArrow(); return; }
    let br = banner.getBoundingClientRect();
    // At the end of a page there may be no remaining scroll room. Dock on the other
    // edge in that case, instead of covering the very control being explained.
    if (overlaps(r, br)) {
      const previous = banner.dataset.dock;
      banner.dataset.dock = previous === 'top' ? 'bottom' : 'top';
      const alternate = banner.getBoundingClientRect();
      const area = (b: HelpRect) => { const i = intersect(r!, b); return i ? (i.right - i.left) * (i.bottom - i.top) : 0; };
      if (area(alternate) >= area(br)) banner.dataset.dock = previous || 'bottom';
      br = banner.getBoundingClientRect();
    }
    if (target.matches('h1,h2,h3,h4,legend')) { hideArrow(); return; }
    // For a large canvas, point to its unobscured portion rather than its clipped edge.
    if (overlaps(r, br)) r = intersect(r, banner.dataset.dock === 'top' ? { ...viewport(), top: br.bottom + 8 } : { ...viewport(), bottom: br.top - 8 });
    if (!r) { hideArrow(); return; }
    const v = viewport(); v.top = Math.max(v.top + 8, activeDialog() ? v.top + 8 : headerBottom() + 8); v.left += 8; v.right -= 8; v.bottom -= 8;
    const placement = placeHelpArrow(r, v, [br, launcher.getBoundingClientRect()]);
    if (!placement) { hideArrow(); return; }
    mountOverlay(arrow);
    arrow.style.left = `${placement.left}px`; arrow.style.top = `${placement.top}px`;
    arrow.style.transform = `rotate(${placement.rotation}deg)`;
    arrow.dataset.tipX = String(placement.tip.x); arrow.dataset.tipY = String(placement.tip.y);
  }

  get('[data-help-next]').onclick = async () => {
    if (busy || !tour || !guide) return;
    const activeTour = tour;
    busy = true;
    try {
      try {
        const latest = await requestContext();
        if (tour !== activeTour) return;
        if (tour.viewer && (latest.viewer?.id !== tour.viewer || latest.viewer?.authVersion !== tour.authVersion)) { endTour(false); return; }
        if (context) context.completed = latest.completed;
      } catch { /* Unknown completion is never treated as done. */ }
      if (tour !== activeTour) return;
      tour.history.push(tour.index);
      let next = tour.index + 1;
      while (next < guide.steps.length && completed(guide.steps[next])) next++;
      tour.index = next; lastActivated = ''; persist(); await showStep(true, true);
    } finally { busy = false; }
  };
  get('[data-help-prev]').onclick = async () => {
    if (busy || !tour) return;
    const previous = tour.history.pop();
    if (previous === undefined) { if (tour.parents.length) await restoreParent(); return; }
    tour.index = previous; lastActivated = ''; persist(); await showStep(true, true);
  };
  get('[data-help-hide]').onclick = () => { if (!tour) return; tour.hidden = true; persist(); conceal(); launcher.focus({ preventScroll: true }); };
  get('[data-help-stop]').onclick = () => endTour(true);
  get('[data-help-end]').onclick = () => endTour(false);
  function endTour(focus: boolean) { tour = undefined; guide = undefined; conceal(); persist(); if (focus) launcher.focus({ preventScroll: true }); }
  get('[data-help-resume]').onclick = async () => {
    if (!tour || busy) return;
    busy = true;
    try { await restoreGuide(); if (tour && guide) { tour.hidden = false; persist(); closePanel(); await showStep(true, true); } }
    catch { status.textContent = 'この案内を再開できません。対象の権限・受付状態を確認してください。'; }
    finally { busy = false; }
  };
  async function finishGuide() {
    if (tour?.parents.length) { await restoreParent(); return; }
    endTour(false); await openPanel(); status.textContent = '手順の説明が終わりました。未操作の項目がある場合は、やることリストから再確認できます。';
  }
  async function restoreParent() {
    if (!tour) return;
    const parent = tour.parents.pop(); if (!parent) return;
    tour = { ...tour, ...parent, hidden: false }; await restoreGuide(); persist(); await showStep(true, true);
  }
  get('[data-help-detail]').onclick = async () => {
    if (!tour || !guide) return;
    const items = availableDetails(guide.steps[tour.index]);
    await openPanel(); showSelection('詳しい操作を選ぶ', '必要な操作だけを選んで案内できます。説明が終わると基本の案内へ戻ります。');
    for (const item of items) get('[data-help-selection-content]').append(resultButton(item.title, item.description, () => void selectGuide(item.id, undefined, true)));
  };
  async function restoreGuide() {
    if (!tour) return;
    const activeTour = tour;
    const data = await requestContext(tour.id, tour.entity, tour.path); context = data;
    if (tour !== activeTour) return;
    if (tour.viewer && (tour.viewer !== data.viewer?.id || tour.authVersion !== data.viewer?.authVersion)) { endTour(false); return; }
    guide = data.guide;
    if (guide?.choices) {
      tour.hidden = true; persist();
      await openPanel(); await selectGuide(tour.id); return;
    }
  }
  document.addEventListener('help:statechange', () => { void loadTasks(); });
  window.addEventListener('focus', () => { if (root.dataset.approved === '1') void loadTasks(); });
  const taskPoll = window.setInterval(() => { if (!document.hidden && root.dataset.approved === '1') void loadTasks(); }, 60000);
  window.addEventListener('scroll', queuePosition, { capture: true, passive: true });
  window.addEventListener('resize', queuePosition);
  window.visualViewport?.addEventListener('resize', queuePosition);
  window.visualViewport?.addEventListener('scroll', queuePosition);
  const resizeObserver = new ResizeObserver(queuePosition); resizeObserver.observe(banner);
  const observer = new MutationObserver(records => {
    const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter(d => d !== panel).at(-1);
    const launcherParent = dialog || root;
    if (launcher.parentElement !== launcherParent) launcherParent.append(launcher);
    if (!tour || tour.hidden || panel.open || !guide || records.every(r => (r.target instanceof Element ? r.target : r.target.parentElement)?.closest('[data-help-root], [data-help-tour], [data-help-arrow]'))) return;
    clearTimeout(mutationTimer); mutationTimer = window.setTimeout(() => { if (tour && !tour.hidden && guide) prepareTarget(guide.steps[tour.index], false); }, 120);
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-busy'] });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.open && tour && !tour.hidden && !document.querySelector('dialog[open]')) { event.preventDefault(); get('[data-help-hide]').click(); }
  });
  window.addEventListener('pagehide', () => { persist(); disposed = true; observer.disconnect(); resizeObserver.disconnect(); clearInterval(taskPoll); clearTimeout(mutationTimer); clearTimeout(waitingTimer); cancelAnimationFrame(positionFrame); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

  if (tour?.viewer && root.dataset.approved !== '1') endTour(false);
  if (tour) void (async () => {
    try {
      if (tour?.awaitingLogin) {
        await loadContext();
        if (!tour) return;
        if (context?.viewer?.approved) { tour.awaitingLogin = false; tour.viewer = context.viewer.id; tour.authVersion = context.viewer.authVersion; const { id, entity } = tour; await selectGuide(id, entity); }
        return;
      }
      await restoreGuide();
      if (!tour || !guide) return;
      if (tour.index >= guide.steps.length) { await finishGuide(); return; }
      if (!matchesPath(guide.steps[tour.index].path)) {
        const next = guide.steps.findIndex((s, i) => i > tour!.index && matchesPath(s.path));
        if (next >= 0) { tour.history.push(tour.index); tour.index = next; }
        else tour.hidden = true;
      }
      persist(); if (!tour.hidden) await showStep(false, false);
    } catch { if (tour) { tour.hidden = true; persist(); } }
  })();
  if (root.dataset.approved === '1') void loadTasks();
}
