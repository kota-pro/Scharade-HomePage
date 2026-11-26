import { apiErrorMessage, readApiResponse } from "./apiResponse";
import { blogEmbedLink, readBlogEmbed } from "../lib/blogEmbeds";
import { changeBlogTable, newBlogTable } from "./blogTable";
import { blogClipboardHtml } from "./blogClipboard";

import { bodyMediaPath, type BodyMediaScope } from "../types/bodyMedia";

interface Options {
  addPicture?: (url: string) => void;
  pictureCount?: () => number;
  scope?: BodyMediaScope;
  hideMediaLibrary?: boolean;
  onSave?: (publish: boolean) => void;
}

export function initRichBodyEditor(root: HTMLElement, config: Options = {}) {
  const options = {
    ...config,
    scope: config.scope ?? (root.dataset.bodyMediaScope ? JSON.parse(root.dataset.bodyMediaScope) as BodyMediaScope : undefined),
  };
  const rich = root.querySelector<HTMLElement>("[data-blog-rich]")!;
  const body = rich.querySelector<HTMLElement>("[data-rich-body]")!;
  const rootLabel = rich.querySelector<HTMLElement>("[data-rich-label]")!;
  const id = 'body-editor-' + crypto.randomUUID();
  rootLabel.id = id;
  body.setAttribute("aria-labelledby", id);
  const controller = new AbortController();
  const richStatus = rich.querySelector<HTMLElement>("[data-rich-status]")!;
  const dialog = root.querySelector<HTMLDialogElement>("[data-rich-dialog]")!;
  const dialogStatus = dialog.querySelector<HTMLElement>("[data-dialog-status]")!;
  const apply = dialog.querySelector<HTMLButtonElement>("[data-rich-dialog-apply]")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-rich-dialog-cancel]")!;
  const tableMenu = rich.querySelector<HTMLSelectElement>('[data-rich-select="table"]')!;
  const expand = rich.querySelector<HTMLButtonElement>("[data-rich-expand]")!;
  const unlink = dialog.querySelector<HTMLButtonElement>("[data-rich-unlink]")!;
  const mediaLibrary = dialog.querySelector<HTMLDetailsElement>("[data-rich-media-library]")!;
  const mediaQuery = mediaLibrary.querySelector<HTMLInputElement>("[data-media-query]")!;
  const mediaResults = mediaLibrary.querySelector<HTMLElement>("[data-media-results]")!;
  const mediaStatus = mediaLibrary.querySelector<HTMLElement>("[data-media-status]")!;
  const mediaMore = mediaLibrary.querySelector<HTMLButtonElement>("[data-media-more]")!;
  const dialogTitle = dialog.querySelector<HTMLElement>("[data-rich-dialog-title]")!;
  dialogTitle.id = id + "-dialog";
  dialog.setAttribute("aria-labelledby", dialogTitle.id);
  const input = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement = HTMLInputElement>(name: string) =>
    dialog.querySelector<T>(`[data-rich-input="${name}"]`)!;
  let savedRange: Range | null = null;
  let clickedCell: HTMLTableCellElement | null = null;
  let edited: HTMLElement | null = null;
  let inserting = false;
  let kind = "";
  let previousFocus: Element | null = null;
  let committed = false;
  let mediaToken = "", mediaFetched = 0, mediaRequest: AbortController | undefined;

  function currentRange() {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return body.contains(range.startContainer) && body.contains(range.endContainer) ? range : null;
  }

  function targetElement() {
    const node = savedRange?.startContainer;
    return node instanceof Element ? node : node?.parentElement;
  }

  function selectedCell() {
    if (clickedCell && body.contains(clickedCell)) return clickedCell;
    return targetElement()?.closest<HTMLTableCellElement>("td,th") ?? null;
  }

  function remember() {
    const range = currentRange();
    if (!range) return;
    savedRange = range.cloneRange();
    tableMenu.disabled = !selectedCell();
    for (const button of rich.querySelectorAll<HTMLButtonElement>("[data-rich-command][aria-pressed]")) {
      button.setAttribute("aria-pressed", String(document.queryCommandState(button.dataset.richCommand!)));
    }
  }

  function select(range: Range) {
    body.focus({ preventScroll: true });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function restore() {
    if (savedRange && body.contains(savedRange.commonAncestorContainer)) {
      select(savedRange);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(body);
    range.collapse(false);
    select(range);
  }

  function execute(command: string, value?: string) {
    restore();
    document.execCommand(command, false, value);
    remember();
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function replace(target: HTMLElement | null, html: string) {
    if (target && body.contains(target)) {
      const range = document.createRange();
      range.selectNode(target);
      savedRange = range;
    }
    execute("insertHTML", html);
  }

  function wrap(tag: string, attr?: [string, string]) {
    if (body.contains(document.activeElement)) remember();
    const range = savedRange;
    if (!range || range.collapsed) {
      richStatus.textContent = "書式を適用する文字を選択してください。";
      return;
    }
    const element = document.createElement(tag);
    if (attr) element.setAttribute(...attr);
    element.append(range.cloneContents());
    execute("insertHTML", element.outerHTML);
    richStatus.textContent = "";
  }

  function setColor(value: string) {
    if (body.contains(document.activeElement)) remember();
    restore();
    document.execCommand("styleWithCSS", false, "true");
    execute("foreColor", value);
    document.execCommand("styleWithCSS", false, "false");
  }

  function setFontSize(value: string) {
    // The native change preserves existing color, links and inline formatting.
    if (body.contains(document.activeElement)) remember();
    execute("fontSize", "7");
    for (const element of body.querySelectorAll<HTMLElement>('font[size="7"], span[style]')) {
      if (element.tagName === "FONT") {
        const span = document.createElement("span");
        span.style.cssText = element.style.cssText;
        span.style.fontSize = value;
        if (element.getAttribute("color")) span.style.color = element.getAttribute("color")!;
        span.append(...element.childNodes);
        element.replaceWith(span);
      } else if (["xxx-large", "-webkit-xxx-large"].includes(element.style.fontSize)) {
        element.style.fontSize = value;
      }
    }
    body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function articleHtml() {
    const copy = body.cloneNode(true) as HTMLElement;
    for (const element of copy.querySelectorAll<HTMLElement>("[style]")) {
      const color = element.style.color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
      const style = element.getAttribute("style")!;
      if (color) {
        const hex = "#" + color.slice(1).map(value => Number(value).toString(16).padStart(2, "0")).join("");
        element.setAttribute("style", style.replace(color[0], hex));
      }
    }
    for (const element of copy.querySelectorAll<HTMLElement>("b,i,strike")) {
      const tag = { B: "strong", I: "em", STRIKE: "s" }[element.tagName]!;
      const replacement = document.createElement(tag);
      for (const attribute of element.attributes) replacement.setAttribute(attribute.name, attribute.value);
      replacement.append(...element.childNodes);
      element.replaceWith(replacement);
    }
    return copy.innerHTML;
  }

  function formatting(command: string) {
    if (body.contains(document.activeElement)) remember();
    richStatus.textContent = "";
    if (command === "inline-code") return wrap("code");
    if (command === "quote") return execute("formatBlock", "blockquote");
    execute(command);
  }

  body.addEventListener("focus", () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, "false");
  });
  document.addEventListener("selectionchange", remember, { signal: controller.signal });
  body.addEventListener("input", remember);
  body.addEventListener("click", event => {
    clickedCell = (event.target as Element).closest<HTMLTableCellElement>("td,th");
    remember();
  });
  body.addEventListener("paste", event => {
    event.preventDefault();
    const html = blogClipboardHtml(event.clipboardData?.getData("text/html") ?? "", Boolean(options.scope));
    if (html) {
      document.execCommand("insertHTML", false, html);
      return;
    }
    const text = event.clipboardData?.getData("text/plain");
    if (text) document.execCommand("insertText", false, text);
  });
  body.addEventListener("drop", event => event.preventDefault());
  function setExpanded(expanded: boolean) {
    rich.toggleAttribute("data-expanded", expanded);
    expand.setAttribute("aria-pressed", String(expanded));
    const label = expanded ? "全画面を閉じる" : "全画面で編集";
    expand.setAttribute("aria-label", label);
    expand.title = label;
    restore();
  }
  expand.addEventListener("click", () => setExpanded(!rich.hasAttribute("data-expanded")));
  rich.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !rich.hasAttribute("data-expanded")) return;
    event.preventDefault();
    setExpanded(false);
    expand.focus();
  });

  for (const control of rich.querySelectorAll<HTMLElement>("button, input, select")) {
    control.addEventListener("pointerdown", remember);
  }
  for (const button of rich.querySelectorAll<HTMLButtonElement>("[data-rich-command]")) {
    if (["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"].includes(button.dataset.richCommand!))
      button.setAttribute("aria-pressed", "false");
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => formatting(button.dataset.richCommand!));
  }
  rich.querySelector<HTMLInputElement>("[data-rich-color]")?.addEventListener("change", event => {
    setColor((event.target as HTMLInputElement).value);
  });
  for (const control of rich.querySelectorAll<HTMLSelectElement>("[data-rich-select]")) {
    control.addEventListener("change", () => {
      const value = control.value;
      control.value = "";
      if (!value) return;
      switch (control.dataset.richSelect) {
        case "block": execute("formatBlock", value); break;
        case "size": setFontSize(value); break;
        case "color": setColor(value); break;
        case "class": wrap("span", ["class", value]); break;
        case "table":
          if (value === "merge") openDialog("merge");
          else {
            try { mutateTable(value); }
            catch (error) { richStatus.textContent = apiErrorMessage(error); }
          }
          break;
      }
    });
  }

  function mutateTable(action: string, span?: { rows: number; columns: number }) {
    const cell = selectedCell();
    if (!cell) throw new Error("表のセルにカーソルを置いてください。");
    const { current, html } = changeBlogTable(cell, action, span);
    replaceTable(current, html);
    richStatus.textContent = "";
  }

  function replaceTable(target: HTMLTableElement, html: string) {
    const tables = Array.from(body.querySelectorAll("table"));
    const index = tables.indexOf(target);
    if (index < 0) throw new Error("表のセルにカーソルを置いてください。");
    const copy = body.cloneNode(true) as HTMLElement;
    const replacement = document.createElement("template");
    replacement.innerHTML = html;
    copy.querySelectorAll("table")[index].replaceWith(replacement.content);
    const range = document.createRange();
    range.selectNodeContents(body);
    savedRange = range;
    clickedCell = null;
    execute("insertHTML", copy.innerHTML);
  }

  tableMenu.addEventListener("change", () => remember());

  const dialogKinds: Record<string, { title: string; fields: string[] }> = {
    link: { title: "リンクを編集", fields: ["url", "text", "newTab"] },
    image: { title: "本文の画像", fields: ["upload", "library", "url", "text", "caption", "width", "height", "alignment", "imageLink"] },
    picture: { title: "記事写真を追加", fields: ["upload", "library", "url"] },
    file: { title: "添付ファイル", fields: ["upload", "library", "url", "text"] },
    embed: { title: "外部URLを挿入", fields: ["url"] },
    table: { title: "表を挿入", fields: ["rows", "columns"] },
    merge: { title: "選択したセルから右下の範囲を結合", fields: ["rows", "columns"] },
    "code-block": { title: "コードブロック", fields: ["language", "filename", "code"] },
  };

  function openDialog(next: string, image?: HTMLImageElement) {
    remember();
    previousFocus = document.activeElement;
    committed = false;
    kind = next;
    edited = null;
    const { title, fields } = dialogKinds[kind];
    const available = options.scope || options.hideMediaLibrary ? fields.filter(field => field !== "library") : fields;
    dialog.querySelector("[data-rich-dialog-title]")!.textContent = title;
    dialog.querySelector("[data-rich-text-label]")!.textContent = kind === "image" ? "代替テキスト" : "表示テキスト";
    for (const field of dialog.querySelectorAll<HTMLElement>("[data-dialog-field]")) {
      field.hidden = !available.includes(field.dataset.dialogField!);
      const control = field.querySelector<HTMLInputElement>("input,select,textarea")!;
      control.value = "";
      if (control.type === "checkbox") control.checked = false;
    }
    const target = targetElement();
    const link = target?.closest<HTMLAnchorElement>("a");
    unlink.hidden = kind !== "link" || !link;
    if (kind === "link" && link) {
      edited = link;
      input("url").value = link.getAttribute("href") ?? "";
      input("newTab").checked = link.target === "_blank";
    }
    if (kind === "link") input("text").value = edited?.textContent || savedRange?.toString() || "";
    if (kind === "embed" && link) {
      const existing = readBlogEmbed(link.href);
      if (existing) {
        edited = link.closest("p") ?? link;
        input("url").value = existing.url.href;
      }
    }
    if (kind === "image" && !image && target instanceof HTMLImageElement) image = target;
    if (kind === "image" && image) {
      const figure = image.closest("figure");
      edited = figure ?? image.closest("a") ?? image;
      input("url").value = image.getAttribute("src") ?? "";
      input("text").value = image.alt;
      input("caption").value = figure?.querySelector("figcaption")?.textContent ?? "";
      input("width").value = image.getAttribute("width") ?? "";
      input("height").value = image.getAttribute("height") ?? "";
      input("alignment").value = figure?.style.textAlign ?? "";
      input("imageLink").value = image.closest("a")?.getAttribute("href") ?? "";
    }
    if (kind === "file" && link?.dataset.embedType === "file") {
      edited = link;
      input("url").value = link.getAttribute("href") ?? "";
      input("text").value = link.textContent ?? "";
    }
    if (kind === "code-block") {
      const pre = target?.closest("pre");
      const code = pre?.querySelector("code");
      if (pre) edited = pre.parentElement?.dataset.filename !== undefined ? pre.parentElement : pre;
      input("filename").value = edited?.dataset.filename ?? "";
      input("language").value = Array.from(code?.classList ?? []).find(name => name.startsWith("language-"))?.slice(9) ?? "";
      input("code").value = code?.textContent ?? savedRange?.toString() ?? "";
    }
    input("rows").value = kind === "merge" ? "1" : "2";
    input("columns").value = "2";
    input("upload").accept = kind === "file" ? ".pdf,.zip,.docx,.xlsx,.pptx,.txt,.csv,.mp3,.mp4" : "image/jpeg,image/png,image/webp";
    mediaLibrary.open = false;
    mediaToken = mediaQuery.value = mediaStatus.textContent = "";
    mediaFetched = 0;
    mediaMore.hidden = true;
    mediaResults.replaceChildren();
    dialogStatus.textContent = "";
    dialog.showModal();
    input(available[0]).focus();
  }

  for (const trigger of root.querySelectorAll<HTMLButtonElement>("[data-rich-dialog-open]")) {
    trigger.addEventListener("click", () => openDialog(trigger.dataset.richDialogOpen!));
  }
  body.addEventListener("dblclick", event => {
    if (event.target instanceof HTMLImageElement) openDialog("image", event.target);
  });
  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", event => { if (inserting) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    mediaRequest?.abort();
    if (!committed && previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true });
  });

  function commit(target: HTMLElement | null, html: string) {
    committed = true;
    dialog.close();
    replace(target, html);
  }

  type MediaItem = { url: string; alt?: string; width?: number; height?: number };

  function mediaFileName(url: string) {
    const name = new URL(url).pathname.split("/").at(-1) ?? "";
    try { return decodeURIComponent(name); } catch { return name; }
  }

  async function loadMedia(more = false) {
    mediaRequest?.abort();
    const request = mediaRequest = new AbortController();
    const query = new URLSearchParams({ kind, q: mediaQuery.value.trim() });
    if (more && mediaToken) query.set("token", mediaToken);
    else {
      mediaFetched = 0;
      mediaResults.replaceChildren();
    }
    mediaMore.hidden = true;
    mediaStatus.textContent = "メディアを読み込んでいます…";
    try {
      const response = await fetch(`/api/member/blog/media?${query}`, { signal: request.signal });
      const result = await readApiResponse(response);
      if (request.signal.aborted) return;
      if (!response.ok || !result.ok) throw new Error(result.message);
      mediaToken = result.token;
      mediaFetched += result.fetched;
      for (const entry of result.media as MediaItem[]) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const name = mediaFileName(entry.url);
        if (kind !== "file") {
          const thumb = document.createElement("img");
          const url = new URL(entry.url);
          url.searchParams.set("w", "96");
          thumb.src = url.href;
          thumb.alt = "";
          thumb.loading = "lazy";
          button.append(thumb);
        }
        button.append(name);
        button.addEventListener("click", () => {
          input("url").value = entry.url;
          input("upload").value = "";
          if (kind === "image") {
            input("text").value = entry.alt ?? "";
            input("width").value = entry.width ? String(entry.width) : "";
            input("height").value = entry.height ? String(entry.height) : "";
          } else if (kind === "file") input("text").value = name;
          mediaLibrary.open = false;
          input("url").focus();
        });
        item.append(button);
        mediaResults.append(item);
      }
      mediaMore.hidden = !mediaToken || !result.fetched || mediaFetched >= result.total;
      mediaStatus.textContent = mediaResults.children.length ? "" : "該当するメディアはありません。";
    } catch (error) {
      if (!request.signal.aborted) mediaStatus.textContent = apiErrorMessage(error);
    }
  }

  mediaLibrary.addEventListener("toggle", () => {
    if (mediaLibrary.open && !mediaResults.children.length) void loadMedia();
  });
  mediaLibrary.querySelector("[data-media-search]")!.addEventListener("click", () => void loadMedia());
  mediaMore.addEventListener("click", () => void loadMedia(true));
  mediaQuery.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    void loadMedia();
  });

  function linkHref(value: string) {
    const href = value.trim();
    if ((href.startsWith("/") && !href.startsWith("//") || href.startsWith("#") || /^mailto:/i.test(href)) && !/[\\\x00-\x20\x7f]/.test(href))
      return href;
    const url = new URL(href);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("リンク先のURLを確認してください。");
    return url.href;
  }

  function mediaUrl(value: string, category: string) {
    if (options.scope) {
      const path = bodyMediaPath(value.trim());
      if (!path) throw new Error("この本文に添付したファイルを選択してください。");
      return path;
    }
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.endsWith(".microcms-assets.io"))
      throw new Error("microCMSのメディアURLを入力してください。");
    if (category === "file" ? url.hostname !== "files.microcms-assets.io" : url.hostname !== "images.microcms-assets.io")
      throw new Error("選択した種類のmicroCMSメディアURLを入力してください。");
    return url.href;
  }

  async function upload(file: File, mediaKind: "image" | "file") {
    const body = new FormData();
    body.set("kind", mediaKind);
    body.set("file", file);
    if (options.scope) body.set("scope", JSON.stringify(options.scope));
    const response = await fetch(options.scope ? "/api/member/body-media/upload" : "/api/member/blog/media", { method: "POST", body });
    const result = await readApiResponse(response);
    if (!response.ok || !result.ok) throw new Error(result.message);
    return result as { url: string; width?: number; height?: number };
  }

  function makeLink(url: string, text: string, newTab = false) {
    const anchor = document.createElement("a");
    anchor.setAttribute("href", url);
    anchor.textContent = text;
    if (newTab) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
    }
    return anchor;
  }

  function number(name: string) {
    const element = input(name);
    const value = element.valueAsNumber;
    if (!Number.isSafeInteger(value) || !element.checkValidity()) throw new Error("指定したサイズまたは範囲を確認してください。");
    return value;
  }

  async function applyDialog() {
    if (inserting) return;
    inserting = apply.disabled = cancel.disabled = true;
    dialogStatus.textContent = "";
    try {
      const raw = input("url").value;
      const description = input("text").value.trim();
      if (kind === "merge") {
        const cell = selectedCell();
        if (!cell) throw new Error("表のセルにカーソルを置いてください。");
        const { current, html } = changeBlogTable(cell, "merge", { rows: number("rows"), columns: number("columns") });
        committed = true;
        dialog.close();
        replaceTable(current, html);
      } else if (kind === "table") {
        commit(null, newBlogTable(number("rows"), number("columns")).outerHTML + "<p><br></p>");
      } else if (kind === "link") {
        const href = linkHref(raw);
        const text = description || href;
        const newTab = input("newTab").checked;
        const update = (anchor: HTMLAnchorElement) => {
          anchor.setAttribute("href", href);
          if (newTab) {
            anchor.target = "_blank";
            anchor.rel = "noopener noreferrer";
          } else {
            anchor.removeAttribute("target");
            anchor.removeAttribute("rel");
          }
        };
        if (edited instanceof HTMLAnchorElement && edited.textContent === text) {
          update(edited);
          committed = true;
          dialog.close();
          restore();
          body.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (!edited && savedRange && !savedRange.collapsed && savedRange.toString() === text) {
          committed = true;
          dialog.close();
          execute("createLink", href);
          const range = currentRange();
          for (const anchor of body.querySelectorAll<HTMLAnchorElement>("a[href]"))
            if (anchor.getAttribute("href") === href && range?.intersectsNode(anchor)) update(anchor);
          body.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          commit(edited, makeLink(href, text, newTab).outerHTML);
        }
      } else if (kind === "embed") {
        const href = blogEmbedLink(raw.trim());
        if (!href) throw new Error("https://で始まるURLを入力してください。");
        commit(edited, `<p>${makeLink(href, new URL(href).hostname, true).outerHTML}</p><p><br></p>`);
      } else if (kind === "code-block") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        const language = input("language").value.trim();
        if (language && !/^[a-zA-Z0-9_+-]+$/.test(language)) throw new Error("コードの言語を確認してください。");
        if (language) code.className = `language-${language}`;
        code.textContent = input("code").value;
        pre.append(code);
        const wrapper = document.createElement("div");
        if (input("filename").value.trim()) wrapper.dataset.filename = input("filename").value.trim();
        wrapper.append(pre);
        commit(edited, (wrapper.dataset.filename ? wrapper.outerHTML : pre.outerHTML) + "<p><br></p>");
      } else {
        const file = input("upload").files?.[0];
        const height = kind === "image" && input("height").value ? number("height") : 0;
        const width = kind === "image" && input("width").value ? number("width") : 0;
        const imageLink = kind === "image" && input("imageLink").value.trim() ? linkHref(input("imageLink").value) : "";
        if (kind === "picture" && (options.pictureCount?.() ?? 0) >= 50) throw new Error("記事写真は50枚まで追加できます。");
        let dimensions: { width?: number; height?: number } = {};
        let url = "";
        if (file) {
          if (file.size > 5_000_000) throw new Error("ファイルは5MB以下にしてください。");
          dialogStatus.textContent = "アップロードしています…";
          const result = await upload(file, kind === "file" ? "file" : "image");
          dimensions = result;
          url = result.url;
        } else {
          url = mediaUrl(raw, kind);
        }
        if (kind === "picture") options.addPicture?.(url);
        else if (kind === "file") {
          const anchor = makeLink(url, description || file?.name || "添付ファイル", true);
          anchor.dataset.embedType = "file";
          commit(edited, anchor.outerHTML);
        } else {
          const image = document.createElement("img");
          const source = new URL(url, location.origin);
          if (!options.scope && width && height) {
            source.searchParams.set("w", String(width));
            source.searchParams.set("h", String(height));
          }
          image.src = options.scope ? url : source.href;
          image.alt = description;
          if (width || dimensions.width) image.width = width || dimensions.width!;
          if (height || dimensions.height) image.height = height || dimensions.height!;
          const figure = document.createElement("figure");
          const alignment = input("alignment").value;
          if (alignment) figure.style.textAlign = alignment;
          if (imageLink) {
            const anchor = makeLink(imageLink, "");
            anchor.append(image);
            figure.append(anchor);
          } else figure.append(image);
          if (input("caption").value.trim()) {
            const caption = document.createElement("figcaption");
            caption.textContent = input("caption").value.trim();
            figure.append(caption);
          }
          commit(edited, figure.outerHTML + (edited ? "" : "<p><br></p>"));
        }
      }
      if (dialog.open) dialog.close();
    } catch (error) {
      dialogStatus.textContent = apiErrorMessage(error, "入力内容を確認してください。");
    } finally { inserting = apply.disabled = cancel.disabled = false; }
  }
  apply.addEventListener("click", () => void applyDialog());
  unlink.addEventListener("click", () => {
    if (edited instanceof HTMLAnchorElement) commit(edited, edited.innerHTML);
  });

  const shiftShortcuts: Record<string, string> = {
    KeyX: "strikeThrough", KeyE: "justifyCenter", KeyR: "justifyRight", KeyB: "quote",
    Digit8: "insertUnorderedList", Digit7: "insertOrderedList",
  };
  body.addEventListener("keydown", event => {
    if (event.isComposing) return;
    clickedCell = null;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && options.onSave) {
      event.preventDefault();
      options.onSave(event.shiftKey);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.altKey && /^[1-5]$/.test(event.key)) {
      event.preventDefault();
      execute("formatBlock", `h${event.key}`);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const shortcut = event.shiftKey ? shiftShortcuts[event.code] : event.code === "KeyE" && !event.altKey ? "inline-code" : undefined;
      if (event.altKey && event.code === "KeyC") {
        event.preventDefault();
        openDialog("code-block");
        return;
      }
      if (shortcut) {
        event.preventDefault();
        formatting(shortcut);
        return;
      }
    }
    if (event.key === " " || event.key === "Enter") applyMarkdown(event, currentRange());
  });

  function applyMarkdown(event: KeyboardEvent, range: Range | null) {
    if (!range?.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return;
    const node = range.startContainer as Text;
    const block = node.parentElement;
    if (!block || !["P", "DIV"].includes(block.tagName) || block.childNodes.length !== 1) return;
    const text = node.data.slice(0, range.startOffset);
    if (text !== node.data) return;
    const headings = /^(#{1,5})$/.exec(text);
    const commands: Record<string, [string, string?]> = {
      "-": ["insertUnorderedList"], "*": ["insertUnorderedList"], "1.": ["insertOrderedList"],
      ">": ["formatBlock", "blockquote"], "```": ["formatBlock", "pre"],
    };
    const command = headings ? ["formatBlock", `h${headings[1].length}`] as const : commands[text];
    if (event.key === " " && command) {
      event.preventDefault();
      const marker = document.createRange();
      marker.selectNodeContents(node);
      savedRange = marker;
      execute("delete");
      execute(command[0], command[1]);
      return;
    }
    if (event.key !== " ") return;
    for (const [pattern, tag] of [[/\*\*([^*]+)\*\*$/, "strong"], [/\*([^*]+)\*$/, "em"], [/~~([^~]+)~~$/, "s"], [/`([^`]+)`$/, "code"]] as const) {
      const match = pattern.exec(text);
      if (!match) continue;
      event.preventDefault();
      const marked = document.createRange();
      marked.setStart(node, match.index);
      marked.setEnd(node, range.startOffset);
      savedRange = marked;
      const element = document.createElement(tag);
      element.textContent = match[1];
      execute("insertHTML", element.outerHTML + "&nbsp;");
      break;
    }
  }

  function validate(required = root.hasAttribute("data-body-required")) {
    if (inserting) {
      richStatus.textContent = "画像やファイルの添付が完了するまでお待ちください。";
      return false;
    }
    if (required && !body.textContent?.trim() && !body.querySelector("img")) {
      richStatus.textContent = `${rootLabel.textContent}を入力してください。`;
      body.focus();
      return false;
    }
    richStatus.textContent = "";
    return true;
  }

  return {
    element: body, html: articleHtml, validate, openDialog,
    setDisabled(disabled: boolean) {
      body.contentEditable = String(!disabled);
      body.setAttribute("aria-disabled", String(disabled));
    },
    dialogActive: () => dialog.open,
    applyDialog,
    destroy() { controller.abort(); mediaRequest?.abort(); },
  };
}
