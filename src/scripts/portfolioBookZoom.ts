type Point = { x: number; y: number };

export function createBookZoom(stage: HTMLElement, content: HTMLElement, toolbar: HTMLElement, onZoom: () => void,
  { onSwipe, scrollArea, enabled = () => true }: { onSwipe?: (dx: number) => void; scrollArea?: HTMLElement; enabled?: () => boolean } = {}) {
  const out = toolbar.querySelector<HTMLButtonElement>('[data-book-zoom="out"]')!;
  const resetButton = toolbar.querySelector<HTMLButtonElement>('[data-book-zoom="reset"]')!;
  const into = toolbar.querySelector<HTMLButtonElement>('[data-book-zoom="in"]')!;
  const pointers = new Map<number, Point>();
  const maximum = 4;
  let scale = 1, x = 0, y = 0, timer = 0, gestureScale = 1;
  let start: Point | undefined, allowSwipe = false;
  const ready = () => content.childElementCount > 0 && enabled();

  function refresh() {
    let width = 0, height = 0;
    if (scale > 1) for (const canvas of content.querySelectorAll("canvas")) {
      width += canvas.offsetWidth;
      height = Math.max(height, canvas.offsetHeight);
    }
    const maxX = Math.max(0, (width * scale - stage.clientWidth) / 2);
    const maxY = Math.max(0, (height * scale - stage.clientHeight) / 2);
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
    content.style.transform = scale > 1 ? `translate(${x}px, ${y}px) scale(${scale})` : "";
    stage.toggleAttribute("data-zoomed", scale > 1);
    out.disabled = resetButton.disabled = !ready() || scale <= 1;
    into.disabled = !ready() || scale >= maximum;
    resetButton.textContent = `${Math.round(scale * 100)}%`;
  }

  function zoom(next: number, before?: Point, after = before) {
    const target = Math.min(maximum, Math.max(1, next));
    if (before && after) {
      const bounds = stage.getBoundingClientRect();
      const cx = bounds.left + bounds.width / 2, cy = bounds.top + bounds.height / 2;
      x = after.x - cx - (before.x - cx - x) * target / scale;
      y = after.y - cy - (before.y - cy - y) * target / scale;
    } else {
      x *= target / scale;
      y *= target / scale;
    }
    if (scale !== target) {
      clearTimeout(timer);
      timer = window.setTimeout(onZoom, 160);
    }
    scale = target;
    refresh();
  }

  const point = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY });
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  stage.addEventListener("pointerdown", event => {
    if (!ready() || pointers.size >= 2 || (event.pointerType === "mouse" && (event.button !== 0 || scale <= 1))) return;
    if (!pointers.size) {
      start = point(event);
      allowSwipe = event.pointerType !== "mouse" && scale === 1;
    } else allowSwipe = false;
    pointers.set(event.pointerId, point(event));
    try { stage.setPointerCapture(event.pointerId); } catch { /* Synthetic or already released pointer. */ }
  });
  stage.addEventListener("pointermove", event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const next = point(event);
    pointers.set(event.pointerId, next);
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      zoom(scale * distance(next, other) / Math.max(1, distance(previous, other)), midpoint(previous, other), midpoint(next, other));
    } else if (scale > 1) {
      x += next.x - previous.x;
      y += next.y - previous.y;
      refresh();
    } else if (allowSwipe && scrollArea) scrollArea.scrollTop -= next.y - previous.y;
  });
  function finish(event: PointerEvent) {
    if (!pointers.delete(event.pointerId) || pointers.size) return;
    if (event.type === "pointerup" && start && allowSwipe && scale === 1) {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.3) onSwipe?.(dx);
    }
    start = undefined;
    allowSwipe = false;
  }
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  stage.addEventListener("lostpointercapture", finish);
  stage.addEventListener("wheel", event => {
    if (!ready() || !event.ctrlKey) return;
    event.preventDefault();
    zoom(scale * Math.exp(-event.deltaY * .012), point(event));
  }, { passive: false });
  // Safari can expose trackpad pinch through gesture events instead of Ctrl+wheel.
  stage.addEventListener("gesturestart", event => {
    if (!ready() || pointers.size) return;
    event.preventDefault();
    gestureScale = scale;
  });
  stage.addEventListener("gesturechange", event => {
    if (!ready() || pointers.size) return;
    event.preventDefault();
    const gesture = event as MouseEvent & { scale: number };
    zoom(gestureScale * gesture.scale, point(gesture));
  });
  out.addEventListener("click", () => zoom(scale / 1.5));
  into.addEventListener("click", () => zoom(scale * 1.5));
  resetButton.addEventListener("click", () => zoom(1));
  refresh();
  return { get scale() { return scale; }, refresh, reset() {
    clearTimeout(timer);
    pointers.clear();
    allowSwipe = false;
    start = undefined;
    scale = 1;
    refresh();
  } };
}
