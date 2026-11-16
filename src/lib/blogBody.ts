import { optimizeMicrocmsHtml } from "../utils/microcmsImage.ts";
import { readBlogEmbed } from "./blogEmbeds.ts";
import { escapeHtml } from "./http.ts";

export function renderBlogBody(html: string) {
  return optimizeMicrocmsHtml(html).replace(/<p(?:\s[^>]*)?>\s*<a\b([^>]*)>[\s\S]*?<\/a>\s*<\/p>/gi, (match: string, attrs: string) => {
    const href = /\shref="([^"]+)"/i.exec(attrs)?.[1];
    const item = href && readBlogEmbed(href.replace(/&amp;/g, "&"));
    if (!item) return match;
    const host = escapeHtml(item.url.hostname);
    const url = escapeHtml(item.url.href);
    if (!item.video) return `<p class="blog-link-card"><a href="${url}" target="_blank" rel="noopener noreferrer">${host}</a></p>`;
    return `<figure class="blog-video"><iframe title="YouTubeの動画" src="https://www.youtube-nocookie.com/embed/${item.video}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen></iframe></figure>`;
  });
}
