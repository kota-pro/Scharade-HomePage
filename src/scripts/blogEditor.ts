import { apiErrorMessage, readApiResponse } from "./apiResponse";
import { blogEmbedLink, readBlogEmbed } from "../lib/blogEmbeds";
import { changeBlogTable, newBlogTable } from "./blogTable";
import { blogClipboardHtml } from "./blogClipboard";

const form = document.querySelector<HTMLFormElement>("[data-blog-editor]");
if (form) initBlogEditor(form);

function initBlogEditor(form: HTMLFormElement) {
  const body = form.querySelector<HTMLElement>("[data-rich-body]")!;
  const rich = form.querySelector<HTMLElement>("[data-blog-rich]")!;
  const status = form.querySelector<HTMLElement>("[data-status]")!;
  const richStatus = rich.querySelector<HTMLElement>("[data-rich-status]")!;
  const pictures = form.querySelector<HTMLUListElement>("[data-blog-pictures]")!;
  const dialog = form.querySelector<HTMLDialogElement>("[data-rich-dialog]")!;
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
  const preview = document.querySelector<HTMLDialogElement>("[data-blog-preview-dialog]")!;
  const previewStage = preview.querySelector<HTMLElement>("[data-blog-preview-stage]")!;
  const previewFrame = preview.querySelector<HTMLIFrameElement>("[data-blog-preview-frame]")!;
  const previewStatus = preview.querySelector<HTMLElement>("[data-blog-preview-status]")!;
  const input = <T extends HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement = HTMLInputElement>(name: string) =>
    dialog.querySelector<T>(`[data-rich-input="${name}"]`)!;
  let savedRange: Range | null = null;
  let clickedCell: HTMLTableCellElement | null = null;
  let edited: HTMLElement | null = null;
  let working = false;
  let inserting = false;
  let kind = "";
  let previousFocus: Element | null = null;
  let committed = false;
  let mediaToken = "", mediaFetched = 0, mediaRequest: AbortController | undefined;

  const snapshot = () => {
    const fields = new FormData(form);
    const tagText = fields.get("tagText");
    return {
      title: String(fields.get("title") ?? ""),
      slug: String(fields.get("slug") ?? ""),
      excerpt: String(fields.get("excerpt") ?? ""),
      body: articleHtml(),
      tags: typeof tagText === "string" ? tagText.split("、").map(value => value.trim()).filter(Boolean) : fields.getAll("tags"),
      pictures: Array.from(pictures.querySelectorAll<HTMLElement>("[data-picture-url]"), item => item.dataset.pictureUrl!),
    };
  };
  const initial = snapshot();
  let navigating = false;

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
    richStatus.textContent = "";
    if (command === "inline-code") return wrap("code");
    if (command === "quote") return execute("formatBlock", "blockquote");
    execute(command);
  }

  body.addEventListener("focus", () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, "false");
  });
  document.addEventListener("selectionchange", remember);
  body.addEventListener("input", remember);
  body.addEventListener("click", event => {
    clickedCell = (event.target as Element).closest<HTMLTableCellElement>("td,th");
    remember();
  });
  body.addEventListener("paste", event => {
    event.preventDefault();
    const html = blogClipboardHtml(event.clipboardData?.getData("text/html") ?? "");
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
    wrap("span", ["style", `color: ${(event.target as HTMLInputElement).value}`]);
  });
  for (const control of rich.querySelectorAll<HTMLSelectElement>("[data-rich-select]")) {
    control.addEventListener("change", () => {
      const value = control.value;
      control.value = "";
      if (!value) return;
      switch (control.dataset.richSelect) {
        case "block": execute("formatBlock", value); break;
        case "size": wrap("span", ["style", `font-size: ${value}`]); break;
        case "color": wrap("span", ["style", `color: ${value}`]); break;
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
    dialog.querySelector("[data-rich-dialog-title]")!.textContent = title;
    dialog.querySelector("[data-rich-text-label]")!.textContent = kind === "image" ? "代替テキスト" : "表示テキスト";
    for (const field of dialog.querySelectorAll<HTMLElement>("[data-dialog-field]")) {
      field.hidden = !fields.includes(field.dataset.dialogField!);
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
      input("url").value = link.href;
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
    input(fields[0]).focus();
  }

  for (const trigger of form.querySelectorAll<HTMLButtonElement>("[data-rich-dialog-open], [data-blog-media]")) {
    trigger.addEventListener("click", () => openDialog(trigger.dataset.richDialogOpen ?? trigger.dataset.blogMedia!));
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
    const response = await fetch("/api/member/blog/media", { method: "POST", body });
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

  function addPicture(url: string) {
    if (Array.from(pictures.children).some(child => (child as HTMLElement).dataset.pictureUrl === url)) throw new Error("この写真はすでに追加されています。");
    if (pictures.children.length >= 50) throw new Error("記事写真は50枚まで追加できます。");
    const item = document.createElement("li");
    item.dataset.pictureUrl = url;
    const image = document.createElement("img");
    image.src = url;
    image.alt = "記事写真";
    item.append(image);
    for (const [action, label, value] of [["up", "写真を前に移動", "↑"], ["down", "写真を後ろに移動", "↓"], ["remove", "写真を外す", "外す"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = value;
      button.setAttribute("aria-label", label);
      if (action === "remove") button.dataset.pictureRemove = "";
      else button.dataset.pictureMove = action;
      item.append(button);
    }
    pictures.append(item);
  }

  pictures.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    const item = button?.closest("li");
    if (!button || !item) return;
    if (button.hasAttribute("data-picture-remove")) {
      const next = item.nextElementSibling?.querySelector("button") ?? item.previousElementSibling?.querySelector("button") ??
        form.querySelector<HTMLButtonElement>("[data-blog-media]");
      item.remove();
      next?.focus();
    } else if (button.dataset.pictureMove === "up") item.previousElementSibling?.before(item);
    else if (button.dataset.pictureMove === "down") item.nextElementSibling?.after(item);
  });

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
        commit(edited, makeLink(href, description || href, input("newTab").checked).outerHTML);
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
        if (kind === "picture" && pictures.children.length >= 50) throw new Error("記事写真は50枚まで追加できます。");
        let dimensions: { width?: number; height?: number } = {};
        let url = "";
        if (file) {
          if (file.size > 5_000_000) throw new Error("ファイルは5MB以下にしてください。");
          dialogStatus.textContent = "microCMSへアップロードしています…";
          const result = await upload(file, kind === "file" ? "file" : "image");
          dimensions = result;
          url = result.url;
        } else {
          url = mediaUrl(raw, kind);
        }
        if (kind === "picture") addPicture(url);
        else if (kind === "file") {
          const anchor = makeLink(url, description || file?.name || "添付ファイル", true);
          anchor.dataset.embedType = "file";
          commit(edited, anchor.outerHTML);
        } else {
          const image = document.createElement("img");
          const source = new URL(url);
          if (width && height) {
            source.searchParams.set("w", String(width));
            source.searchParams.set("h", String(height));
          }
          image.src = source.href;
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

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (dialog.open) return void applyDialog();
    const button = event.submitter as HTMLButtonElement | null;
    void save(button?.value === "publish" ? "publish" : "save");
  });

  async function save(action: "save" | "publish" | "unpublish") {
    if (working || inserting || dialog.open) return;
    if (action !== "unpublish" && ["title", "slug"].some(field => !(form.elements.namedItem(field) as HTMLInputElement).reportValidity())) return;
    if (action === "unpublish" && !window.confirm("この記事の公開を取り下げ、下書きに戻しますか？")) return;
    const values = snapshot();
    const create = !form.dataset.id;
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(initial[key as keyof typeof initial]) !== JSON.stringify(value)));
    const payload = create ? { ...values, requestId: form.dataset.requestId } :
      { ...(action !== "unpublish" && changes), action, updatedAt: form.dataset.updatedAt };
    working = true;
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>("button[type=submit], [data-blog-unpublish]"));
    for (const button of buttons) button.disabled = true;
    status.textContent = action === "publish" ? "公開しています…" : "保存しています…";
    try {
      const response = await fetch(form.dataset.endpoint!, {
        method: create ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message);
      navigating = true;
      location.assign(`/Management/blog/edit/${encodeURIComponent(create ? result.id : form.dataset.id!)}?saved=${action === "save" ? "1" : action}`);
    } catch (error) {
      status.textContent = apiErrorMessage(error);
    } finally {
      working = false;
      for (const button of buttons) button.disabled = false;
    }
  }

  form.querySelector("[data-blog-unpublish]")?.addEventListener("click", () => void save("unpublish"));
  window.addEventListener("beforeunload", event => {
    if (!navigating && JSON.stringify(initial) !== JSON.stringify(snapshot())) event.preventDefault();
  });

  const openPreview = form.querySelector<HTMLButtonElement>("[data-blog-preview]")!;
  const previewSizes = { desktop: [1440, 900], mobile: [390, 844] } as const;
  const sizeButtons = preview.querySelectorAll<HTMLButtonElement>("[data-preview-size]");
  let previewSize: keyof typeof previewSizes = matchMedia("(max-width: 780px)").matches ? "mobile" : "desktop";
  function fitPreview() {
    if (previewStage.hidden) return;
    const [width, height] = previewSizes[previewSize];
    const scale = Math.min(1, previewStage.clientWidth / width, previewStage.clientHeight / height);
    previewStage.style.setProperty("--preview-width", `${width}px`);
    previewStage.style.setProperty("--preview-height", `${height}px`);
    previewStage.style.setProperty("--preview-scale", String(scale));
  }
  function selectPreviewSize(size: keyof typeof previewSizes) {
    previewSize = size;
    previewFrame.toggleAttribute("data-mobile", size === "mobile");
    for (const button of sizeButtons) button.setAttribute("aria-pressed", String(button.dataset.previewSize === size));
    fitPreview();
  }
  selectPreviewSize(previewSize);
  new ResizeObserver(fitPreview).observe(previewStage);
  let previewRequest: AbortController | null = null;
  openPreview.addEventListener("click", async () => {
    if (preview.open) return;
    previewRequest?.abort();
    previewStage.hidden = true;
    previewFrame.removeAttribute("srcdoc");
    const controller = new AbortController();
    previewRequest = controller;
    const data = new FormData();
    data.set("content", JSON.stringify({ ...snapshot(), publishedAt: form.dataset.publishedAt }));
    previewStatus.textContent = "プレビューを読み込んでいます…";
    preview.showModal();
    try {
      const response = await fetch("/Management/blog/preview", {
        method: "POST",
        mode: "same-origin",
        // The reverse proxy uses no-referrer, which suppresses Origin on form navigation.
        referrerPolicy: "same-origin",
        body: data,
        signal: controller.signal,
      });
      const message = "プレビューを表示できませんでした。もう一度お試しください。";
      if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("text/html")) {
        const result = await readApiResponse(response, message);
        throw new Error(result.message || message);
      }
      const html = await response.text();
      if (!controller.signal.aborted && preview.open) {
        previewFrame.srcdoc = html;
        previewStage.hidden = false;
        fitPreview();
        previewStatus.textContent = "";
      }
    } catch (error) {
      if (!controller.signal.aborted && preview.open) {
        previewStatus.textContent = apiErrorMessage(error, "プレビューを読み込めませんでした。もう一度お試しください。");
      }
    }
  });
  preview.querySelector("[data-close-preview]")!.addEventListener("click", () => preview.close());
  let backdropPointer = false;
  function outsidePreview(event: MouseEvent) {
    const rect = preview.getBoundingClientRect();
    return event.target === preview &&
      (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
  }
  preview.addEventListener("pointerdown", event => { backdropPointer = outsidePreview(event); });
  preview.addEventListener("click", event => {
    if (backdropPointer && outsidePreview(event)) preview.close();
    backdropPointer = false;
  });
  preview.addEventListener("close", () => {
    if (preview.open) return;
    previewRequest?.abort();
    previewRequest = null;
    previewStage.hidden = true;
    previewFrame.removeAttribute("srcdoc");
    openPreview.focus({ preventScroll: true });
  });
  for (const button of sizeButtons) button.addEventListener("click", () => selectPreviewSize(button.dataset.previewSize === "mobile" ? "mobile" : "desktop"));

  const shiftShortcuts: Record<string, string> = {
    KeyX: "strikeThrough", KeyE: "justifyCenter", KeyR: "justifyRight", KeyB: "quote",
    Digit8: "insertUnorderedList", Digit7: "insertOrderedList",
  };
  body.addEventListener("keydown", event => {
    if (event.isComposing) return;
    clickedCell = null;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      const canPublish = form.querySelector('button[value="publish"]');
      void save(event.shiftKey && canPublish ? "publish" : "save");
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
}
