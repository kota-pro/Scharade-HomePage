import { optimizeMicrocmsImage } from "./microcmsImage.ts";
export function siteImage(source: string, width = 960) {
  if (source.startsWith("/media/site/") && source.endsWith(".webp"))
    return width === 960 ? source : source.replace(/\.webp$/, `-${width}.webp`);
  return optimizeMicrocmsImage(source, { width, quality: 78 });
}
export function siteImageSet(source: string) {
  return [480, 960, 1440]
    .map((width) => `${siteImage(source, width)} ${width}w`)
    .join(", ");
}
