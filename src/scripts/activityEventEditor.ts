import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
import { activityTextParts } from "../lib/activityPresentation";
import { activityDate, eventCategoryLabels, type EventCategory } from "../lib/activityTypes";
import { INTRODUCTION_NON_TEXT_TAGS, INTRODUCTION_TAGS, introductionTag } from "../utils/portfolioIntroduction";
import type { createPortfolioIntroductionEditor } from "./portfolioIntroductionEditor";

function linkifiedText(value: string) {
  return activityTextParts(value).map(part => {
    if (!part.href) return document.createTextNode(part.text);
    const link = document.createElement("a");
    link.href = part.href;
    link.textContent = part.text;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  });
}

function previewText(node: Node, inLink = false): Node[] {
  if (node.nodeType === Node.TEXT_NODE)
    return inLink ? [document.createTextNode(node.textContent ?? "")] : linkifiedText(node.textContent ?? "");
  if (!(node instanceof HTMLElement) || INTRODUCTION_NON_TEXT_TAGS.includes(node.localName)) return [];
  const attributes = Object.fromEntries([...node.attributes].map(attribute => [attribute.name, attribute.value]));
  const { tagName, attribs } = introductionTag(node.localName, attributes, true);
  const children = [...node.childNodes].flatMap(child => previewText(child, inLink || tagName === "a"));
  if (!INTRODUCTION_TAGS.includes(tagName)) return children;
  const element = document.createElement(tagName);
  for (const [name, value] of Object.entries(attribs)) element.setAttribute(name, value);
  element.append(...children);
  return [element];
}

export function setupEventEditor(
  form: HTMLFormElement,
  richFields: ReadonlyMap<string, ReturnType<typeof createPortfolioIntroductionEditor>>,
) {
  const dialog = document.querySelector<HTMLDialogElement>(
    "[data-event-confirm]",
  )!;
  const back = dialog.querySelector<HTMLButtonElement>("[data-close-confirm]")!;
  const confirm = dialog.querySelector<HTMLButtonElement>(
    "[data-confirm-update]",
  );
  const confirmStatus = dialog.querySelector<HTMLElement>(
    "[data-confirm-status]",
  );
  const notify = dialog.querySelector<HTMLInputElement>("[data-confirm-notify]");
  notify?.addEventListener("change", () => {
    if (confirm) confirm.textContent = notify.checked ? "変更を公開して通知" : "変更を保存";
  });
  const file = form.elements.namedItem("headerFile") as HTMLInputElement;
  const imageValue = form.elements.namedItem("headerImage") as HTMLInputElement;
  const imageStatus = form.querySelector<HTMLElement>("[data-image-status]")!;
  const remove = form.querySelector<HTMLButtonElement>("[data-remove-header]")!;
  const image = form.querySelector<HTMLElement>("[data-header-preview]")!;
  const released = form.dataset.released === "true";
  let uploading = false,
    approved = false,
    saving = false;
  let previousFocus: HTMLElement | null = null;
  let previousOverflow = "";
  function updateImage(container: HTMLElement, url: string) {
    container.hidden = !url;
    const img = container.querySelector("img")!;
    if (url) img.src = url;
    else img.removeAttribute("src");
  }
  function close() {
    if (saving || dialog.dataset.busy === "true") return;
    dialog.close();
  }
  dialog.addEventListener("close", () => {
    document.body.style.overflow = previousOverflow;
    previousFocus?.focus();
  });
  back.addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  // The native backdrop blocks the background and keeps keyboard focus in the dialog.
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      close();
  });
  function edit(target: HTMLElement) {
    if (saving || dialog.dataset.busy === "true") return;
    const name = target.dataset.editField!;
    const field = richFields.get(name)?.element ?? form.querySelector<HTMLElement>(`[name="${name}"]`);
    close();
    if (field)
      requestAnimationFrame(() => {
        field.closest("details")?.setAttribute("open", "");
        field.scrollIntoView({ block: "center", behavior: "smooth" });
        field.focus({ preventScroll: true });
      });
  }
  dialog
    .querySelectorAll<HTMLElement>("[data-edit-field]")
    .forEach((element) => {
      element.addEventListener("click", (event) => {
        // Web links can be checked without leaving the confirmation screen.
        if (!(event.target as HTMLElement).closest("a")) edit(element);
      });
      element.addEventListener("keydown", (event) => {
        if (
          event.target === element &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          edit(element);
        }
      });
    });
  function open() {
    const fd = new FormData(form);
    dialog
      .querySelectorAll<HTMLElement>("[data-preview-value]")
      .forEach((element) => {
        const key = element.dataset.previewValue!;
        const editor = richFields.get(key)?.element;
        if (editor) {
          const children = editor.textContent?.trim()
            ? [...editor.childNodes].flatMap(node => previewText(node))
            : ["（なし）"];
          element.replaceChildren(...children);
          return;
        }
        let value = String(fd.get(key) || "");
        if (key === "category") value = eventCategoryLabels[value as EventCategory] || "その他イベント";
        if (["startsAt", "endsAt", "deadline"].includes(key))
          value = activityDate(`${value}:00+09:00`);
        if (key === "ownerId")
          value =
            (
              form.elements.namedItem(key) as HTMLSelectElement
            ).selectedOptions[0]?.textContent?.trim() || "";
        if (key === "recipientIds") {
          const names = released
            ? form.dataset.recipientNames || ""
            : [
                ...form.querySelectorAll<HTMLInputElement>(
                  '[name="recipientIds"]:checked',
                ),
              ]
                .map((input) => input.closest("label")?.textContent?.trim())
                .join("、");
          value = names || "（なし）";
        }
        element.replaceChildren(...linkifiedText(value || "（なし）"));
      });
    updateImage(
      dialog.querySelector<HTMLElement>("[data-header-preview]")!,
      imageValue.value,
    );
    dialog.querySelector<HTMLElement>("[data-no-header]")!.hidden =
      !!imageValue.value;
    if (confirmStatus) confirmStatus.textContent = "";
    previousFocus = document.activeElement as HTMLElement;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    back.focus();
  }
  confirm?.addEventListener("click", () => {
    if (saving) return;
    approved = true;
    form.requestSubmit();
  });
  file.addEventListener("change", async () => {
    const selected = file.files?.[0];
    if (!selected || uploading) return;
    imageStatus.dataset.error = "false";
    if (
      selected.size > 20 * 1024 * 1024 ||
      !selected.type.startsWith("image/")
    ) {
      imageStatus.textContent = "20MB以下の画像を選択してください。";
      imageStatus.dataset.error = "true";
      operationNotice(imageStatus.textContent,true,"activity-image");
      file.value = "";
      return;
    }
    uploading = true;
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
    file.disabled = remove.disabled = submit.disabled = true;
    imageStatus.textContent = "画像を保存しています…"; operationNotice(imageStatus.textContent,false,"activity-image");
    try {
      const body = new FormData();
      body.set("file", selected);
      const response = await fetch("/api/member/event-image/upload", {
        method: "POST",
        body,
        signal: AbortSignal.timeout(60000),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok || !result.url)
        throw new Error(result.message || "画像を保存できませんでした。");
      imageValue.value = result.url;
      updateImage(image, result.url);
      remove.hidden = false;
      form.dataset.dirty = "true";
      imageStatus.textContent =
        "画像を選択しました。企画の内容と一緒に保存してください。";
      operationNotice(imageStatus.textContent,false,"activity-image");
    } catch (error) {
      imageStatus.textContent =
        apiErrorMessage(error);
      imageStatus.dataset.error = "true";
      operationNotice(imageStatus.textContent,true,"activity-image");
    } finally {
      uploading = false;
      file.value = "";
      file.disabled = remove.disabled = submit.disabled = false;
    }
  });
  remove.addEventListener("click", () => {
    imageValue.value = "";
    file.value = "";
    updateImage(image, "");
    remove.hidden = true;
    imageStatus.textContent = "";
    form.dataset.dirty = "true";
  });
  if (dialog.dataset.autoPreview === "true") {
    open();
    const url = new URL(location.href);
    url.searchParams.delete("preview");
    history.replaceState(null, "", url);
  }
  return {
    notifyMembers: () => notify?.checked ?? false,
    beforeSave() {
      if (uploading) return false;
      if (released && !approved) {
        open();
        return false;
      }
      approved = false;
      return true;
    },
    setBusy(value: boolean, message = "") {
      saving = value;
      if (confirm) confirm.disabled = value;
      if (notify) notify.disabled = value;
      back.disabled = value;
      if (confirmStatus) confirmStatus.textContent = message;
      if(message) operationNotice(message,!value,"activity-save");
    },
  };
}
