export interface PhotoRow {
  start: number;
  height: number;
  widths: number[];
}

/** Keep photo order and aspect ratios, choosing rows with similar heights.
 * At most 100 photos are laid out per page, so considering every row break is
 * inexpensive and avoids squeezing leftover photos into an arbitrary last row.
 */
export function justifiedRows(ratios: number[], width: number, gap: number, mobile = false): PhotoRow[] {
  if (!ratios.length || !Number.isFinite(width) || width <= 0) return [];
  const aspects = ratios.map(ratio => Number.isFinite(ratio) && ratio > 0 ? ratio : 1.5);
  const spacing = Math.max(0, Number.isFinite(gap) ? gap : 0);
  const target = Math.min(300, Math.max(100, width * 0.24));
  const row = (start: number, end: number, height: number): PhotoRow => ({
    start, height, widths: aspects.slice(start, end).map(ratio => ratio * height),
  });

  if (mobile) {
    return aspects.map((ratio, index) => row(index, index + 1, width / ratio));
  }
  const totalAspect = aspects.reduce((sum, ratio) => sum + ratio, 0);

  // A short portfolio should not enlarge a single portrait to the entire page.
  if (totalAspect * target + (aspects.length - 1) * spacing <= width) {
    return [row(0, aspects.length, target)];
  }

  const costs = Array<number>(aspects.length + 1).fill(Infinity);
  const ends = Array<number>(aspects.length);
  costs[aspects.length] = 0;
  for (let start = aspects.length - 1; start >= 0; start--) {
    let sum = 0;
    for (let end = start + 1; end <= aspects.length; end++) {
      sum += aspects[end - 1];
      const available = width - (end - start - 1) * spacing;
      if (available <= 0) break;
      const height = available / sum;
      const cost = (end - start) * Math.log(height / target) ** 2 + costs[end];
      if (cost < costs[start]) {
        costs[start] = cost;
        ends[start] = end;
      }
    }
  }

  const rows: PhotoRow[] = [];
  for (let start = 0; start < aspects.length;) {
    const end = ends[start];
    const sum = aspects.slice(start, end).reduce((value, ratio) => value + ratio, 0);
    rows.push(row(start, end, (width - (end - start - 1) * spacing) / sum));
    start = end;
  }
  return rows;
}
