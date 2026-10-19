const shell = document.querySelector<HTMLElement>('[data-calendar-navigation]');
if (shell) {
  const calendar = shell.querySelector<HTMLElement>('[data-calendar-swipe]')!;
  const previous = shell.querySelector<HTMLAnchorElement>('[data-calendar-previous]')!;
  const next = shell.querySelector<HTMLAnchorElement>('[data-calendar-next]')!;
  const scrollKey = 'scharade-calendar-scroll';
  let navigating = false, suppressClick = false, wheelDistance = 0, wheelTimer: ReturnType<typeof setTimeout> | undefined;
  let gesture: { id: number; x: number; y: number; dx: number; dy: number; horizontal: boolean } | undefined;
  const navigate = (link: HTMLAnchorElement) => {
    if (navigating) return;
    navigating = true;
    try { sessionStorage.setItem(scrollKey, JSON.stringify({ url: link.href, y: scrollY })); } catch {}
    location.assign(link.href);
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(scrollKey) ?? 'null');
    sessionStorage.removeItem(scrollKey);
    if (saved?.url === location.href && Number.isFinite(saved.y)) requestAnimationFrame(() => requestAnimationFrame(() => scrollTo(0, saved.y)));
  } catch {}
  for (const link of [previous, next]) link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(link);
  });
  const clear = () => {
    if (gesture && calendar.hasPointerCapture(gesture.id)) calendar.releasePointerCapture(gesture.id);
    gesture = undefined;
    delete calendar.dataset.calendarDragging;
    calendar.style.removeProperty('transform');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
  };
  function move(event: PointerEvent) {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    g.dx = event.clientX - g.x; g.dy = event.clientY - g.y;
    if (!g.horizontal && Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx)) { clear(); return; }
    if (!g.horizontal && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5) {
      g.horizontal = true; calendar.dataset.calendarDragging = '';
      calendar.setPointerCapture(g.id);
    }
    if (g.horizontal) {
      event.preventDefault();
      calendar.style.transform = `translateX(${Math.max(-32, Math.min(32, g.dx * .2))}px)`;
    }
  }
  function up(event: PointerEvent) {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    const swipe = g.horizontal && Math.abs(g.dx) >= Math.max(50, Math.min(100, calendar.clientWidth * .18)) && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
    suppressClick = g.horizontal;
    clear();
    if (swipe) navigate(g.dx < 0 ? next : previous);
    setTimeout(() => { suppressClick = false; }, 0);
  }
  function cancel() { clear(); }
  calendar.addEventListener('pointerdown', event => {
    if (gesture || !event.isPrimary) { clear(); return; }
    if (event.button !== 0) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, horizontal: false };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
  });
  calendar.addEventListener('click', event => { if (suppressClick) { event.preventDefault(); event.stopPropagation(); } }, true);
  calendar.addEventListener('dragstart', event => event.preventDefault());
  calendar.addEventListener('keydown', event => {
    if (event.target !== calendar || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? previous : next); }
  });
  calendar.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return;
    event.preventDefault();
    if (wheelTimer) clearTimeout(wheelTimer);
    wheelDistance += event.deltaX * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? calendar.clientWidth : 1);
    wheelTimer = setTimeout(() => { if (Math.abs(wheelDistance) >= 60) navigate(wheelDistance > 0 ? next : previous); wheelDistance = 0; }, 150);
  }, { passive: false });
}
export {};
