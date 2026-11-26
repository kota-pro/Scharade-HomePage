export const catalogOption = (value: string, label: string) => ({ value, label });
export const catalogOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => catalogOption(value, label));

const collator = new Intl.Collator("ja", { numeric: true });
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

export function catalogDate(value?: string) {
  const date = Date.parse(value ?? "");
  return Number.isFinite(date) ? dateFormat.format(date) : "";
}

export function catalogMatches(needle: string, ...values: string[]) {
  const words = needle.normalize("NFKC").toLowerCase().trim().split(/\s+/);
  const haystack = values.join(" ").normalize("NFKC").toLowerCase();
  return words.every(word => haystack.includes(word));
}

export function sortCatalog<T>(rows: T[], key: (row: T) => string, order: string) {
  return [...rows].sort((a, b) => collator.compare(key(a), key(b)) * (order === "asc" ? 1 : -1));
}

export function catalogPage<T>(rows: T[], url: URL, param: string, anchor?: string) {
  const size = 20;
  const last = Math.max(1, Math.ceil(rows.length / size));
  const requested = Number(url.searchParams.get(param));
  const page = Number.isSafeInteger(requested) ? Math.min(last, Math.max(1, requested)) : 1;
  const href = (index: number) => {
    const query = new URLSearchParams(url.search);
    if (index === 1) query.delete(param);
    else query.set(param, String(index));
    return `${url.pathname}${query.size ? `?${query}` : ""}${anchor ? `#${anchor}` : ""}`;
  };
  return {
    items: rows.slice((page - 1) * size, page * size),
    total: rows.length, page, last,
    previous: page > 1 ? href(page - 1) : undefined,
    next: page < last ? href(page + 1) : undefined,
  };
}
