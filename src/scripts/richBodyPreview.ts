import { activityTextParts } from "../lib/activityPresentation";
import { readBlogEmbed } from "../lib/blogEmbeds";
import { blogClipboardHtml } from "./blogClipboard";

export function richBodyPreview(html: string) {
  const template = document.createElement("template");
  template.innerHTML = blogClipboardHtml(html, true);
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const text: Text[] = [];
  while (walker.nextNode()) text.push(walker.currentNode as Text);
  for (const node of text) {
    if (node.parentElement?.closest("a,code,pre")) continue;
    const parts = activityTextParts(node.data);
    if (!parts.some(part => part.href)) continue;
    node.replaceWith(...parts.map(part => {
      if (!part.href) return document.createTextNode(part.text);
      const anchor = document.createElement("a");
      anchor.href = part.href;
      anchor.textContent = part.text;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      return anchor;
    }));
  }
  for (const paragraph of template.content.querySelectorAll("p")) {
    if (paragraph.childElementCount !== 1 || !(paragraph.firstElementChild instanceof HTMLAnchorElement)) continue;
    const link = paragraph.firstElementChild;
    if (paragraph.textContent?.trim() !== link.textContent?.trim()) continue;
    const embed = readBlogEmbed(link.getAttribute("href") ?? "");
    if (!embed) continue;
    if (!embed.video) {
      paragraph.classList.add("blog-link-card");
      continue;
    }
    const figure = document.createElement("figure");
    figure.className = "blog-video";
    const frame = document.createElement("iframe");
    frame.title = "YouTubeの動画";
    frame.src = `https://www.youtube-nocookie.com/embed/${embed.video}`;
    frame.loading = "lazy";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation");
    frame.allowFullscreen = true;
    figure.append(frame);
    paragraph.replaceWith(figure);
  }
  return template.content;
}

export function richBodyPreviewHtml(html: string) {
  const template = document.createElement("template");
  template.content.append(richBodyPreview(html));
  return template.innerHTML;
}
