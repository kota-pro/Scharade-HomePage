import { bodyMediaPath } from "../types/bodyMedia";

const elements = new Set("p br hr h1 h2 h3 h4 h5 h6 div span b strong i em u s strike del sub sup blockquote pre code ul ol li a img figure figcaption table thead tbody tfoot tr th td caption colgroup col".split(" "));
const discard = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "form"]);
const attributes: Record<string, string[]> = {
  a: ["href", "target", "title"], img: ["src", "alt", "width", "height"],
  th: ["colspan", "rowspan", "scope"], td: ["colspan", "rowspan"], ol: ["start"], col: ["span"],
};

function safeLink(value: string) {
  if (/[\\\x00-\x20\x7f]/.test(value)) return false;
  if ((value.startsWith("/") && !value.startsWith("//")) || value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "mailto:") && !url.username && !url.password;
  } catch { return false; }
}

function safeImage(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "images.microcms-assets.io" && !url.username && !url.password && !url.port;
  } catch { return false; }
}

export function blogClipboardHtml(html: string, privateMedia = false) {
  if (!html || html.length > 180_000) return "";
  const contents = document.createElement("template");
  contents.innerHTML = html;
  for (const element of contents.content.querySelectorAll<HTMLElement>("*")) {
    if (!contents.content.contains(element)) continue;
    const tag = element.localName;
    if (discard.has(tag)) {
      element.remove();
      continue;
    }
    if (!elements.has(tag) || !(element instanceof HTMLElement)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const style = element.style;
    const filename = tag === "div" ? element.dataset.filename?.slice(0, 100) : undefined;
    const language = tag === "code" ? [...element.classList].find(value => /^language-[a-zA-Z0-9_+-]{1,40}$/.test(value)) : undefined;
    const isFile = tag === "a" && element.dataset.embedType === "file" && bodyMediaPath(element.getAttribute("href") || "");
    const presentation: Record<string, string> = {};
    if (/^(left|center|right|justify)$/.test(style.textAlign)) presentation["text-align"] = style.textAlign;
    if (/^(#[\da-f]{3,8}|[a-z]{3,12}|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))$/i.test(style.color)) presentation.color = style.color;
    if (/^\d{1,3}(?:px|pt|%)$/.test(style.fontSize)) presentation["font-size"] = style.fontSize;
    if (/^(bold|[5-9]00)$/.test(style.fontWeight)) presentation["font-weight"] = style.fontWeight;
    if (style.fontStyle === "italic") presentation["font-style"] = style.fontStyle;
    if (/^(\d{1,4}px|\d{1,3}%)$/.test(style.width)) presentation.width = style.width;
    if (/^(#[\da-f]{3,8}|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))$/i.test(style.backgroundColor)) presentation["background-color"] = style.backgroundColor;
    if (/^(underline|line-through)$/.test(style.textDecoration)) presentation["text-decoration"] = style.textDecoration;
    for (const attribute of [...element.attributes])
      if (!attributes[tag]?.includes(attribute.name)) element.removeAttribute(attribute.name);
    for (const [property, value] of Object.entries(presentation)) style.setProperty(property, value);
    if (filename) element.dataset.filename = filename;
    if (language) element.classList.add(language);
    if (isFile && privateMedia) element.dataset.embedType = "file";
    if (tag === "a") {
      if (!safeLink(element.getAttribute("href") ?? "")) element.removeAttribute("href");
      if (element.getAttribute("target") === "_blank") element.setAttribute("rel", "noopener noreferrer");
      else element.removeAttribute("target");
    }
    if (tag === "img") {
      const source = element.getAttribute("src") ?? "";
      if (privateMedia ? !bodyMediaPath(source) : !safeImage(source)) element.replaceWith(element.getAttribute("alt") ?? "");
    }
  }
  return contents.innerHTML;
}
