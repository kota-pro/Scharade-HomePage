import { INTRODUCTION_HTML_LIMIT, INTRODUCTION_TEXT_LIMIT, introductionLink } from "../utils/portfolioIntroduction";
import { ACTIVITY_HTML_LIMIT, ACTIVITY_TEXT_LIMIT } from "../lib/activityPresentation";

export function createPortfolioIntroductionEditor(root: HTMLElement) {
  const editor = root.querySelector<HTMLElement>("[data-intro-editable]")!;
  const activity = !!root.dataset.activityRichField;
  const textLimit = activity ? ACTIVITY_TEXT_LIMIT : INTRODUCTION_TEXT_LIMIT;
  const htmlLimit = activity ? ACTIVITY_HTML_LIMIT : INTRODUCTION_HTML_LIMIT;
  const fieldLabel = root.dataset.introFieldLabel ?? "自己紹介";
  const required = editor.getAttribute("aria-required") === "true";
  const toolbar = root.querySelector<HTMLElement>(".introduction-toolbar")!;
  const count = root.querySelector<HTMLElement>("[data-intro-count]")!;
  const error = root.querySelector<HTMLElement>("[data-intro-error]")!;
  const dialog = root.querySelector<HTMLDialogElement>("[data-intro-dialog]")!;
  const linkText = root.querySelector<HTMLInputElement>("[data-intro-link-text]")!;
  const linkUrl = root.querySelector<HTMLInputElement>("[data-intro-link-url]")!;
  const linkError = root.querySelector<HTMLElement>("[data-intro-link-error]")!;
  let savedRange: Range | null = null;
  let editedLink: HTMLAnchorElement | null = null;
  let disabled = false;

  const selectionInside = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : null;
  };
  const remember = () => {
    const range = selectionInside();
    if (range) savedRange = range.cloneRange();
  };
  const restore = () => {
    editor.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return;
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : document.createRange();
    if (!savedRange || !editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const currentLink = () => {
    const node = selectionInside()?.startContainer;
    const element = node instanceof Element ? node : node?.parentElement;
    const anchor = element?.closest<HTMLAnchorElement>("a");
    return anchor && editor.contains(anchor) ? anchor : null;
  };
  const update = () => {
    const text = editor.textContent ?? "";
    count.textContent = `${text.length.toLocaleString("ja")} / ${textLimit.toLocaleString("ja")}`;
    if (text.length <= textLimit && (!required || text.trim())) {
      error.textContent = "";
      editor.removeAttribute("aria-invalid");
    }
    if (!selectionInside()) return;
    toolbar.querySelectorAll<HTMLButtonElement>("[data-intro-command][aria-pressed]").forEach(button => {
      button.setAttribute("aria-pressed", String(document.queryCommandState(button.dataset.introCommand!)));
    });
  };
  const changed = () => {
    remember();
    update();
    // Browser editing commands do not consistently emit input events on every engine.
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const execute = (command: string, value?: string) => {
    if (disabled) return;
    // A toolbar change can arrive before the browser's queued selectionchange event.
    if (editor.contains(document.activeElement)) remember();
    restore();
    document.execCommand(command, false, value);
    changed();
  };

  editor.addEventListener("input", () => { remember(); update(); });
  editor.addEventListener("focus", () => {
    document.execCommand("defaultParagraphSeparator", false, "p");
    document.execCommand("styleWithCSS", false, "true");
  });
  document.addEventListener("selectionchange", () => { remember(); update(); });
  toolbar.querySelectorAll<HTMLButtonElement>("button").forEach(button => {
    button.addEventListener("mousedown", event => { remember(); event.preventDefault(); });
  });
  toolbar.querySelectorAll<HTMLButtonElement>("[data-intro-command]").forEach(button => {
    button.addEventListener("click", () => execute(button.dataset.introCommand!));
  });
  const color = root.querySelector<HTMLInputElement>("[data-intro-color]")!;
  color.addEventListener("pointerdown", remember);
  color.addEventListener("change", () => execute("foreColor", color.value));
  const size = root.querySelector<HTMLSelectElement>("[data-intro-size]");
  size?.addEventListener("pointerdown", remember);
  size?.addEventListener("change", () => {
    if (size.value) execute("fontSize", size.value);
    size.value = "";
  });

  const openLinkDialog = () => {
    if (disabled) return;
    remember();
    editedLink = currentLink();
    const selection = selectionInside();
    // When the caret is inside an existing link, edit the whole link.
    if (editedLink && selection?.collapsed) {
      savedRange = document.createRange();
      savedRange.selectNodeContents(editedLink);
    }
    linkText.value = editedLink?.textContent || savedRange?.toString() || "";
    linkUrl.value = editedLink?.getAttribute("href") || "";
    linkError.textContent = "";
    dialog.showModal();
    (linkText.value ? linkUrl : linkText).focus();
  };
  root.querySelector<HTMLButtonElement>("[data-intro-link]")!.addEventListener("click", openLinkDialog);
  const closeDialog = () => {
    dialog.close();
    restore();
  };
  root.querySelector("[data-intro-link-cancel]")!.addEventListener("click", closeDialog);
  dialog.addEventListener("input", event => event.stopPropagation());
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(); });
  const applyLink = () => {
    const href = introductionLink(linkUrl.value);
    if (!href) {
      linkError.textContent = "http:// または https:// から始まるURL、もしくは mailto: のリンクを入力してください。";
      linkUrl.focus();
      return;
    }
    const text = linkText.value.trim() || href;
    dialog.close();
    restore();
    const range = selectionInside();
    if (!range) return;
    const existing = editedLink && editor.contains(editedLink) ? editedLink : null;
    const setLinkAttributes = (anchor: HTMLAnchorElement) => {
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer ugc";
    };
    if (!existing && !range.collapsed && range.toString() === text &&
        document.execCommand("createLink", false, href)) {
      // Wrapping the selection with the browser command retains its inline styles.
      editor.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(anchor => {
        if (anchor.href === href) setLinkAttributes(anchor);
      });
      editedLink = null;
      changed();
      return;
    }
    const anchor = existing ? existing.cloneNode(true) as HTMLAnchorElement : document.createElement("a");
    setLinkAttributes(anchor);
    if (existing) {
      const linkRange = document.createRange();
      linkRange.selectNode(existing);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(linkRange);
      if (anchor.textContent !== text) {
        // When the label changes, keep the formatting of its first character.
        let node = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT).nextNode();
        if (!node) anchor.textContent = text;
        else {
          node.textContent = text;
          while (node !== anchor) {
            const parent: ParentNode = node.parentNode!;
            parent.replaceChildren(node);
            node = parent;
          }
        }
      }
    } else if (range.toString() === text) {
      anchor.append(range.cloneContents());
    } else {
      anchor.textContent = text;
    }
    // Replacing a link can split its enclosing inline formatting at both ends.
    let replacement: HTMLElement = anchor;
    let parent = existing?.parentElement ?? (
      range.startContainer instanceof HTMLElement ? range.startContainer : range.startContainer.parentElement
    );
    while (parent && parent !== editor && parent.matches("span, strong, b, em, i, u, s, strike, font")) {
      const wrapper = parent.cloneNode(false) as HTMLElement;
      wrapper.append(replacement);
      replacement = wrapper;
      parent = parent.parentElement;
    }
    document.execCommand("insertHTML", false, replacement.outerHTML);
    editedLink = null;
    changed();
  };
  root.querySelector("[data-intro-link-apply]")!.addEventListener("click", applyLink);
  dialog.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); event.stopPropagation(); applyLink(); }
  });
  editor.addEventListener("keydown", event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); openLinkDialog();
    }
  });

  // Pasted HTML and dropped files must never introduce images, event handlers or embedded content.
  editor.addEventListener("paste", event => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text && !disabled) { remember(); execute("insertText", text); }
  });
  editor.addEventListener("drop", event => event.preventDefault());
  editor.addEventListener("beforeinput", event => {
    if ((event as InputEvent).inputType === "insertFromDrop") event.preventDefault();
  });

  update();
  root.dataset.introductionReady = "true";
  return {
    element: editor,
    html: () => editor.innerHTML,
    validate: () => {
      const text = editor.textContent ?? "";
      const empty = required && !text.trim();
      const tooLong = text.length > textLimit;
      const tooComplex = editor.innerHTML.length > htmlLimit;
      if (!empty && !tooLong && !tooComplex) return true;
      error.textContent = empty ? `${fieldLabel}を入力してください。`
        : tooLong ? `${fieldLabel}は${textLimit.toLocaleString("ja")}文字以内で入力してください。`
        : "装飾が多すぎます。装飾を減らして保存してください。";
      editor.setAttribute("aria-invalid", "true");
      editor.focus();
      return false;
    },
    setDisabled: (value: boolean) => {
      disabled = value;
      editor.contentEditable = String(!value);
      editor.setAttribute("aria-disabled", String(value));
      root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("button, input, select").forEach(element => { element.disabled = value; });
    },
  };
}
