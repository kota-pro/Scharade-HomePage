type ImageOptions = {
  width?: number;
  quality?: number;
};
import { safeMediaUrl, sanitizeArticleHtml } from "../lib/contentSecurity.ts";

export function optimizeMicrocmsImage(
  source: string,
  { width = 1600, quality = 75 }: ImageOptions = {},
) {
  try {
    const safe = safeMediaUrl(source);
    if (!safe) return "";
    const url = new URL(safe);

    url.searchParams.set("w", String(width));
    url.searchParams.set("q", String(quality));
    url.searchParams.set("fm", "webp");
    return url.toString();
  } catch {
    return "";
  }
}

export function optimizeMicrocmsHtml(html: string, width = 1600) {
  return sanitizeArticleHtml(html).replace(
    /(<img\b[^>]*?\bsrc=["'])(https:\/\/[^"']+)(["'][^>]*>)/gi,
    (_match, before: string, source: string, after: string) =>
      `${before}${optimizeMicrocmsImage(source, { width })}${after}`,
  );
}
