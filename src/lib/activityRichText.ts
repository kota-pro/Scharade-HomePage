import { activityTextParts, escapeActivityText } from "./activityPresentation.ts";
import { portfolioIntroductionText } from "./portfolioIntroduction.ts";
import { sanitizeArticleHtml } from "./contentSecurity.ts";
import { renderBlogBody } from "./blogBody.ts";

export function activityRichTextPlain(cleanHtml: string) {
  return portfolioIntroductionText(cleanHtml
    .replace(/<br\s*\/?>|<\/(?:p|div|li|blockquote|ul|ol|h[1-6]|tr|pre|figure|figcaption)>/gi, "\n")
    .replace(/<\/(?:th|td)>/gi, " ")
    .replace(/<img\b[^>]*>/gi, image => /\salt="([^"]+)"/i.exec(image)?.[1] || "画像")).trim();
}

export function activityRichHtml(html: string) {
  const clean = sanitizeArticleHtml(html, true);
  // Process text outside existing links after the HTML and attributes have been sanitized.
  return renderBlogBody(clean.replace(/<(?:a|pre|code)(?:\s[^>]*)?>[\s\S]*?<\/(?:a|pre|code)>|<[^>]+>|[^<]+/g, segment => {
    if (segment.startsWith("<")) return segment;
    const text = segment.replace(/&(amp|lt|gt|quot);/g, entity => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    })[entity]!);
    const parts = activityTextParts(text);
    if (!parts.some(part => part.href)) return segment;
    return parts.map(part => part.href
      ? `<a href="${escapeActivityText(part.href)}" target="_blank" rel="noopener noreferrer">${escapeActivityText(part.text)}</a>`
      : escapeActivityText(part.text)).join("");
  }));
}

export function activityEditorHtml(text = "", html?: string) {
  if (html) return sanitizeArticleHtml(html, true);
  return text ? `<p>${escapeActivityText(text).replace(/\r\n?|\n/g, "<br>")}</p>` : "";
}
