export type HelpRect = { left: number; top: number; right: number; bottom: number };
export const overlaps = (a: HelpRect, b: HelpRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
export function intersect(a: HelpRect, b: HelpRect): HelpRect | undefined {
  const rect = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : undefined;
}

/** The SVG tip stays six pixels from the visible target, even beside a screen edge. */
export function placeHelpArrow(target: HelpRect, viewport: HelpRect, obstacles: HelpRect[]) {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const x = clamp(target.left + Math.min((target.right - target.left) / 2, 60), viewport.left + 22, viewport.right - 22);
  const y = clamp((target.top + target.bottom) / 2, viewport.top + 22, viewport.bottom - 22);
  const candidates = [
    { left: x - 22, top: target.top - 48, rotation: 0, tip: { x, y: target.top - 6 } },
    { left: x - 22, top: target.bottom + 4, rotation: 180, tip: { x, y: target.bottom + 6 } },
    { left: target.left - 48, top: y - 22, rotation: -90, tip: { x: target.left - 6, y } },
    { left: target.right + 4, top: y - 22, rotation: 90, tip: { x: target.right + 6, y } },
  ];
  return candidates.find(p => {
    const r = { ...p, right: p.left + 44, bottom: p.top + 44 };
    return r.left >= viewport.left && r.top >= viewport.top && r.right <= viewport.right && r.bottom <= viewport.bottom && !obstacles.some(o => overlaps(r, o));
  });
}
