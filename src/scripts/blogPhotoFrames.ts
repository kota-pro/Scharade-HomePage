import { blogPhotoTape } from "../utils/blogPhotoTape";
import type { PhotoRef } from "../types/photos";

export function frameBlogPhotos(blog: HTMLElement) {
  const photos: { id: string; url: string }[] = JSON.parse(blog.dataset.blogPhotos ?? "[]");
  const photoIdByPath = new Map(photos.map(photo => {
    const url = new URL(photo.url);
    return [url.origin + url.pathname, photo.id];
  }));
  for (const thumbnail of blog.querySelectorAll<HTMLImageElement>(".post-body img[src]")) {
    const full = new URL(thumbnail.src);
    const path = full.origin + full.pathname;
    const imageId = photoIdByPath.get(path);
    let frame: HTMLElement;
    if (imageId && blog.dataset.blogId) {
      full.searchParams.set("w", "2048");
      full.searchParams.set("q", "85");
      const link = document.createElement("a");
      link.className = "photo-open";
      link.href = full.href;
      link.dataset.photoRef = JSON.stringify({ source: "blog", containerId: blog.dataset.blogId, imageId } satisfies PhotoRef);
      link.dataset.photoInlineControls = "false";
      link.setAttribute("aria-label", `${thumbnail.alt || "写真"}を拡大`);
      frame = link;
    } else {
      frame = document.createElement("span");
    }
    const original = imageId ? thumbnail.closest("a") ?? thumbnail : thumbnail;
    original.replaceWith(frame);
    frame.classList.add("taped-image");
    for (const [name, value] of Object.entries(blogPhotoTape(path))) frame.style.setProperty(name, value);
    thumbnail.classList.add("gallery-image");
    frame.append(thumbnail);
  }
}
