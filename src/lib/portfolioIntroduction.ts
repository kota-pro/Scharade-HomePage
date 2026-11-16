import sanitizeHtml from "sanitize-html";
import {
  INTRODUCTION_HTML_PREFIX,
  INTRODUCTION_TAGS,
  INTRODUCTION_NON_TEXT_TAGS,
  introductionTag,
} from "../utils/portfolioIntroduction.ts";

/** Text formatting with a size palette available to the activity editor. */
export function sanitizePortfolioIntroduction(value: string, allowSize = false): string {
  return sanitizeHtml(value, {
    allowedTags: INTRODUCTION_TAGS,
    allowedAttributes: { "*": ["style"], a: ["href", "target", "rel"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    nonTextTags: INTRODUCTION_NON_TEXT_TAGS,
    transformTags: { "*": (tag, attributes) => introductionTag(tag, attributes, allowSize) },
    enforceHtmlBoundary: true,
  });
}

export function portfolioIntroductionHtml(value?: string): string {
  if (!value) return "";
  if (value.startsWith(INTRODUCTION_HTML_PREFIX))
    return sanitizePortfolioIntroduction(value.slice(INTRODUCTION_HTML_PREFIX.length));
  // Legacy profiles are plain text, including literal HTML examples and indentation.
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p>${escaped.replace(/\r\n?|\n/g, "<br>")}</p>`;
}

export function portfolioIntroductionText(html: string): string {
  const escaped = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} });
  return escaped.replace(/&(amp|lt|gt);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">" })[entity]!);
}

export function serializePortfolioIntroduction(html: string): string {
  const clean = sanitizePortfolioIntroduction(html);
  return portfolioIntroductionText(clean).trim() ? INTRODUCTION_HTML_PREFIX + clean : "";
}
