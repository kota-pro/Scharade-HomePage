import { apiErrorMessage, readApiResponse } from "./apiResponse";
import { initRichBodyEditor } from "./richBodyEditor";

const form = document.querySelector<HTMLFormElement>("[data-blog-editor]");
if (form) initBlogEditor(form);

function initBlogEditor(form: HTMLFormElement) {
  const status = form.querySelector<HTMLElement>("[data-status]")!;
  const pictures = form.querySelector<HTMLUListElement>("[data-blog-pictures]")!;
  const blogPath = form.dataset.blogPath ?? "/Management/blog";
  initAuthorSearch(form);
  const editor = initRichBodyEditor(form.querySelector<HTMLElement>("[data-rich-body-editor]")!, {
    addPicture, pictureCount: () => pictures.children.length,
    hideMediaLibrary: form.hasAttribute("data-own-blog-editor"),
    onSave: publish => void save(publish && form.querySelector('button[value="publish"]') ? "publish" : "save"),
  });
  const preview = document.querySelector<HTMLDialogElement>("[data-blog-preview-dialog]")!;
  const previewStage = preview.querySelector<HTMLElement>("[data-blog-preview-stage]")!;
  const previewFrame = preview.querySelector<HTMLIFrameElement>("[data-blog-preview-frame]")!;
  const previewStatus = preview.querySelector<HTMLElement>("[data-blog-preview-status]")!;
  let working = false;
  form.querySelector("[data-blog-media]")?.addEventListener("click", () => editor.openDialog("picture"));
  const snapshot = () => {
    const fields = new FormData(form);
    const tagText = fields.get("tagText");
    return {
      byline: fields.get("byline") ?? undefined,
      title: String(fields.get("title") ?? ""),
      slug: String(fields.get("slug") ?? ""),
      excerpt: String(fields.get("excerpt") ?? ""),
      body: editor.html(),
      tags: typeof tagText === "string" ? tagText.split("、").map(value => value.trim()).filter(Boolean) : fields.getAll("tags"),
      pictures: Array.from(pictures.querySelectorAll<HTMLElement>("[data-picture-url]"), item => item.dataset.pictureUrl!),
    };
  };
  const initial = snapshot();
  let navigating = false;

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

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (editor.dialogActive()) return void editor.applyDialog();
    const button = event.submitter as HTMLButtonElement | null;
    const action = button?.value;
    void save(action === "publish" || action === "submit" || action === "approve" || action === "return" ? action : "save");
  });

  async function save(action: "save" | "publish" | "unpublish" | "submit" | "approve" | "return") {
    if (working || editor.dialogActive() || !editor.validate()) return;
    if (action !== "unpublish" && ["title", "slug"].some(field => !(form.elements.namedItem(field) as HTMLInputElement).reportValidity())) return;
    if (action === "unpublish" && !window.confirm("この記事の公開を取り下げ、下書きに戻しますか？")) return;
    const values = snapshot();
    const create = !form.dataset.id;
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) => JSON.stringify(initial[key as keyof typeof initial]) !== JSON.stringify(value)));
    if (action !== "save" && action !== "unpublish" && Object.keys(changes).length) {
      status.textContent = "変更を保存してから操作してください。";
      return;
    }
    const reason = action === "return" ? (form.elements.namedItem("reviewReason") as HTMLTextAreaElement).value.trim() : undefined;
    if (action === "return" && !reason) {
      status.textContent = "差し戻し理由を入力してください。";
      (form.elements.namedItem("reviewReason") as HTMLTextAreaElement).focus();
      return;
    }
    const payload = create ? { ...values, requestId: form.dataset.requestId } :
      { ...(action === "save" && changes), action, reason, updatedAt: form.dataset.updatedAt,
        ...(form.dataset.workflowRevision === undefined ? {} : { workflowRevision: Number(form.dataset.workflowRevision) }) };
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
      location.assign(`${blogPath}/edit/${encodeURIComponent(create ? result.id : form.dataset.id!)}?saved=${action === "save" ? "1" : action}`);
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
    data.set("content", JSON.stringify({ ...snapshot(), publishedAt: form.dataset.publishedAt, articleId: form.dataset.id }));
    previewStatus.textContent = "プレビューを読み込んでいます…";
    preview.showModal();
    try {
      const response = await fetch(`${blogPath}/preview`, {
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

}

function initAuthorSearch(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>("[data-author-search]");
  const select = form.querySelector<HTMLSelectElement>("#blog-byline");
  const status = form.querySelector<HTMLElement>("[data-author-search-status]");
  if (!input || !select || !status) return;
  const options = Array.from(select.options);
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s/g, "");
  const updateOptions = () => {
    const query = normalize(input.value);
    const selected = select.value;
    const matches = options.filter(option => option.dataset.authorNames !== undefined &&
      normalize(option.dataset.authorNames).includes(query));
    const visible = new Set(matches);
    select.replaceChildren(...options.filter(option => !option.dataset.authorNames || option.value === selected || visible.has(option)));
    select.value = selected;
    status.hidden = !query;
    status.textContent = matches.length > 0 ? `${matches.length}件の候補` : "一致する執筆者はいません。";
  };
  input.addEventListener("input", updateOptions);
  input.addEventListener("search", updateOptions);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      select.focus();
    }
  });
  input.disabled = false;
  if (input.value) updateOptions();
}
