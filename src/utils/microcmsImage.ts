type ImageOptions = {
  width?: number;
  quality?: number;
};

export function optimizeMicrocmsImage(
  source: string,
  { width = 1600, quality = 75 }: ImageOptions = {},
) {
  try {
    const url = new URL(source);
    if (!url.hostname.endsWith("microcms-assets.io")) return source;

    url.searchParams.set("w", String(width));
    url.searchParams.set("q", String(quality));
    url.searchParams.set("fm", "webp");
    return url.toString();
  } catch {
    return source;
  }
}

export function optimizeMicrocmsHtml(html: string, width = 1600) {
  return html.replace(
    /(<img\b[^>]*?\bsrc=["'])(https:\/\/[^"']+)(["'][^>]*>)/gi,
    (_match, before: string, source: string, after: string) =>
      `${before}${optimizeMicrocmsImage(source, { width })}${after}`,
  );
}
