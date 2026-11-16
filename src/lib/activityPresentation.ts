/** Only web URLs become links; all other input remains escaped text. */
export function activityTextParts(
  value: string,
): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  const pattern = /https?:\/\/[^\s<>"'\u0000-\u001f\u007f「」『』【】（）]+/giu;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index!;
    let candidate = match[0].replace(/[。、，．,.;:!?！？]+$/u, "");
    // Keep balanced parentheses in map/document URLs, excluding prose wrappers.
    while (
      candidate.endsWith(")") &&
      (candidate.match(/\)/g)?.length || 0) >
        (candidate.match(/\(/g)?.length || 0)
    )
      candidate = candidate.slice(0, -1);
    try {
      const url = new URL(candidate);
      if (!url.hostname || url.username || url.password) continue;
      if (index > offset) parts.push({ text: value.slice(offset, index) });
      parts.push({ text: candidate, href: url.href });
      offset = index + candidate.length;
    } catch {
      /* Malformed URLs are displayed as plain text. */
    }
  }
  if (offset < value.length) parts.push({ text: value.slice(offset) });
  return parts;
}

export function isActivityHeaderImage(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "images.microcms-assets.io" &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export const ACTIVITY_TEXT_LIMIT = 10000;
export const ACTIVITY_HTML_LIMIT = 60000;

export function escapeActivityText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
