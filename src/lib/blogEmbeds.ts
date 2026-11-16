const marker = "#scharade-embed:";

export function blogEmbedLink(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    url.hash = marker + encodeURIComponent(url.hash.slice(1));
    return url.href;
  } catch { return ""; }
}

export function readBlogEmbed(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hash.startsWith(marker)) return null;
    url.hash = decodeURIComponent(url.hash.slice(marker.length));
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) :
      ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
        ? url.searchParams.get("v") ?? /^\/(?:shorts|live|embed)\/([^/]+)$/.exec(url.pathname)?.[1]
        : null;
    return { url, video: id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null };
  } catch { return null; }
}
