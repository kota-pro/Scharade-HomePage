import type { PhotoLiker, PhotoView } from "../types/photos";

export function createPhotoLikers(likers: PhotoLiker[], count: number, heading = true) {
  const content = document.createElement("div"); content.className = "photo-likers-summary"; content.dataset.photoLikers = "";
  if (likers.length) {
    if (heading) { const label = document.createElement("p"); label.className = "photo-likers-label"; label.textContent = "いいねした会員"; content.append(label); }
    const list = document.createElement("ul"); list.className = "photo-liker-list"; list.setAttribute("aria-label", "いいねした会員");
    for (const liker of likers) {
      const item = document.createElement("li"), name = document.createElement(liker.href && /^\/Portfolio\/[a-zA-Z0-9_-]+$/.test(liker.href) ? "a" : "span");
      name.textContent = liker.name; if (name instanceof HTMLAnchorElement) name.href = liker.href!;
      item.append(name); list.append(item);
    }
    content.append(list);
  } else { const empty = document.createElement("p"); empty.textContent = count ? "表示できる会員名はありません。" : "まだいいねはありません。"; content.append(empty); }
  const other = Math.max(0, count - likers.length);
  if (other) { const remaining = document.createElement("p"); remaining.className = "photo-likers-other"; remaining.textContent = `その他のいいね：${other.toLocaleString("ja-JP")}件`; content.append(remaining); }
  return content;
}

const dialog = document.querySelector<HTMLDialogElement>("#photo-likers");
let opener: HTMLElement | undefined;
let previousOverflow = "";
if (dialog) {
  dialog.querySelector("[data-photo-likers-close]")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { document.body.style.overflow = previousOverflow; opener?.focus({ preventScroll: true }); });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
}
export function openPhotoLikers(photo: PhotoView, button: HTMLElement) {
  if (!dialog || photo.count === undefined) return;
  opener = button;
  dialog.querySelector<HTMLElement>("[data-photo-likers-title]")!.textContent = photo.title || photo.alt || "写真";
  dialog.querySelector<HTMLElement>("[data-photo-likers-total]")!.textContent = `合計${photo.count.toLocaleString("ja-JP")}件のいいね`;
  dialog.querySelector("[data-photo-likers-content]")!.replaceChildren(createPhotoLikers(photo.likers ?? [], photo.count, false));
  if (!dialog.open) { previousOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; dialog.showModal(); }
}
