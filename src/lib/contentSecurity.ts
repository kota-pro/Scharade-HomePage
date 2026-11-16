import sanitizeHtml from "sanitize-html";

export function safeMediaUrl(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (url.hostname === "microcms-assets.io" || url.hostname.endsWith(".microcms-assets.io")) ? url.href : "";
  } catch { return ""; }
}
export function safeExternalUrl(value: unknown) {
  if (typeof value !== "string" || /[\x00-\x20\x7f]/.test(value)) return "";
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; }
  catch { return ""; }
}
/** The CMS is a content source, never a source of executable page code. */
export function sanitizeArticleHtml(value: string) {
  return sanitizeHtml(value, {
    allowedTags: ["p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "strong", "b", "em", "i", "u", "s", "del", "sub", "sup", "blockquote", "pre", "code", "ul", "ol", "li", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col"],
    allowedAttributes: {
      "*": ["class", "style"], a: ["href", "title", "target", "rel", "data-embed-type"],
      div: ["data-filename"],
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      th: ["colspan", "rowspan", "scope"], td: ["colspan", "rowspan"], ol: ["start"], col: ["span"],
    },
    allowedSchemes: ["https", "mailto"], allowProtocolRelative: false,
    allowedStyles: { "*": {
      "text-align": [/^(?:left|right|center|justify)$/],
      color: [/^#[a-f0-9]{3,8}$/i, /^(?:black|white|red|blue|green|gray|grey)$/i],
      "background-color": [/^#[a-f0-9]{3,8}$/i],
      "font-weight": [/^(?:normal|bold|[1-9]00)$/],
      "font-size": [/^(?:[1-9][0-9]{0,2})(?:px|pt|%)$/],
      "text-decoration": [/^(?:none|underline|line-through)$/],
      width: [/^(?:[1-9][0-9]{0,3}px|(?:[1-9][0-9]?|100)%)$/],
    } },
    transformTags: {
      a: (tagName, attrs) => ({ tagName, attribs: { ...attrs, ...(attrs.target === "_blank" ? { rel: "noopener noreferrer" } : {}), ...(attrs.target && attrs.target !== "_blank" ? { target: "_self" } : {}) } }),
      img: (tagName, attrs) => ({ tagName, attribs: { ...attrs, src: safeMediaUrl(attrs.src), loading: "lazy", decoding: "async" } }),
    },
    exclusiveFilter: frame => frame.tag === "img" && !frame.attribs.src,
    enforceHtmlBoundary: true,
  });
}
