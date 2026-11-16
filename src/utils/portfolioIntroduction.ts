export const INTRODUCTION_HTML_PREFIX = "<!--scharade-introduction:v1-->";
export const INTRODUCTION_TEXT_LIMIT = 5000;
export const INTRODUCTION_HTML_LIMIT = 30000;
export const INTRODUCTION_TAGS = ["p", "div", "br", "strong", "em", "u", "s", "span", "a", "ul", "ol", "li", "blockquote"];
export const INTRODUCTION_NON_TEXT_TAGS = ["script", "style", "textarea", "option", "iframe", "object", "embed", "svg", "math", "template", "video", "audio"];
const styledTags = ["span", "strong", "em", "u", "s", "p", "div", "a"];
const tagAliases: Record<string, string> = { b: "strong", i: "em", strike: "s", font: "span" };
export const RICH_TEXT_SIZES = [
  { command: "2", css: "small", pixels: 13 },
  { command: "3", css: "medium", pixels: 16 },
  { command: "4", css: "large", pixels: 18 },
  { command: "5", css: "x-large", pixels: 24 },
  { command: "6", css: "xx-large", pixels: 32 },
];

function introductionFontSize(value: string) {
  const size = RICH_TEXT_SIZES.find(option => option.css === value || `${option.pixels}px` === value);
  return size ? `${size.pixels}px` : "";
}

export function introductionTag(tag: string, attributes: Record<string, string>, allowSize = false) {
  const tagName = Object.hasOwn(tagAliases, tag) ? tagAliases[tag] : tag;
  const attribs: Record<string, string> = {};
  if (styledTags.includes(tagName)) {
    const styles: string[] = [];
    for (const declaration of (attributes.style ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const raw = declaration.slice(colon + 1).trim();
      let value = "";
      if (property === "color") value = introductionColor(raw);
      if (property === "font-weight" && /^(?:normal|bold|[1-9]00)$/.test(raw)) value = raw;
      if (property === "font-style" && /^(?:normal|italic)$/.test(raw)) value = raw;
      if (property === "text-decoration" || property === "text-decoration-line") {
        // Chromium emits the longhand; other editors commonly emit the shorthand.
        const line = /^(none|(?:underline|line-through)(?:\s+(?:underline|line-through))?)(?=$|\s+solid(?:\s|$))/i.exec(raw)?.[1];
        if (line) styles.push(`text-decoration:${line.toLowerCase().replace(/\s+/g, " ")}`);
      }
      if (property === "font-size" && allowSize) value = introductionFontSize(raw);
      if (value) styles.push(`${property}:${value}`);
    }
    if (tag === "font") {
      const color = introductionColor(attributes.color ?? "");
      const size = allowSize && RICH_TEXT_SIZES.find(option => option.command === attributes.size);
      if (color) styles.push(`color:${color}`);
      if (size) styles.push(`font-size:${size.pixels}px`);
    }
    if (styles.length) attribs.style = styles.join(";");
  }
  if (tagName === "a") {
    const href = introductionLink(attributes.href ?? "");
    if (href) Object.assign(attribs, { href, target: "_blank", rel: "noopener noreferrer ugc" });
  }
  return { tagName, attribs };
}

export function introductionLink(value: string): string {
  const text = value.trim();
  if (!text || /[\x00-\x20\x7f]/.test(text)) return "";
  try {
    const url = new URL(text);
    return ["https:", "http:", "mailto:"].includes(url.protocol) &&
      !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

export function introductionColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(color)) return color;
  if (/^#[\da-f]{3}$/.test(color))
    return "#" + [...color.slice(1)].map(char => char + char).join("");
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(color);
  if (rgb && rgb.slice(1).every(part => Number(part) <= 255))
    return "#" + rgb.slice(1).map(part => Number(part).toString(16).padStart(2, "0")).join("");
  return "";
}
