import { activityTextParts, escapeActivityText } from "./activityPresentation.ts";
import { portfolioIntroductionText, sanitizePortfolioIntroduction } from "./portfolioIntroduction.ts";

export function activityRichTextPlain(cleanHtml: string) {
  return portfolioIntroductionText(cleanHtml.replace(/<br\s*\/?>|<\/(?:p|div|li|blockquote|ul|ol)>/gi, "\n")).trim();
}

export function activityRichHtml(html: string) {
  const clean = sanitizePortfolioIntroduction(html, true);
  // Process text outside existing links after the HTML and attributes have been sanitized.
  return clean.replace(/<a(?:\s[^>]*)?>[\s\S]*?<\/a>|<[^>]+>|[^<]+/g, segment => {
    if (segment.startsWith("<")) return segment;
    const text = segment.replace(/&(amp|lt|gt|quot);/g, entity => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    })[entity]!);
    return activityTextParts(text).map(part => part.href
      ? `<a href="${escapeActivityText(part.href)}" target="_blank" rel="noopener noreferrer">${escapeActivityText(part.text)}</a>`
      : escapeActivityText(part.text)).join("");
  });
}

export function activityEditorHtml(text = "", html?: string) {
  if (html) return sanitizePortfolioIntroduction(html, true);
  return text ? `<p>${escapeActivityText(text).replace(/\r\n?|\n/g, "<br>")}</p>` : "";
}
