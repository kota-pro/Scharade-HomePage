import { privateSection } from "../lib/privateNavigation";

const nav = document.querySelector<HTMLElement>(".private-mobile-nav");
if (nav) {
  const updateCurrent = () => {
    const section = privateSection(location.pathname, location.hash, new URLSearchParams(location.search).get("view") || "");
    for (const link of nav.querySelectorAll<HTMLAnchorElement>("[data-private-nav-key]")) {
      if (link.dataset.privateNavKey === section) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  };
  updateCurrent();
  window.addEventListener("hashchange", updateCurrent);
  window.addEventListener("pageshow", updateCurrent);

  // Keep the keyboard's viewport free without treating ordinary toolbar motion or pinch zoom as typing.
  const viewport = window.visualViewport;
  let restingHeight = viewport?.height ?? window.innerHeight;
  const updateKeyboard = () => {
    const editing = document.activeElement?.matches('textarea,[contenteditable="true"],input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="file"]):not([type="range"]):not([type="color"])') ?? false;
    const height = viewport?.height ?? window.innerHeight;
    if (!editing) restingHeight = height;
    document.body.toggleAttribute("data-private-keyboard", editing && (viewport?.scale ?? 1) === 1 && Math.max(restingHeight, window.innerHeight) - height > 150);
  };
  viewport?.addEventListener("resize", updateKeyboard);
  window.addEventListener("resize", updateKeyboard);
  document.addEventListener("focusin", updateKeyboard);
  document.addEventListener("focusout", () => queueMicrotask(updateKeyboard));
  window.addEventListener("pageshow", updateKeyboard);
}
