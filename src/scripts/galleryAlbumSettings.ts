import { flashNotice } from "./siteNotice";

const root = document.querySelector<HTMLElement>("[data-gallery-settings]");
if (root) {
  const dialog = root.querySelector("dialog")!;
  const form = dialog.querySelector("form")!;
  const trigger = root.querySelector<HTMLButtonElement>("[data-open-gallery-settings]")!;
  const close = dialog.querySelector<HTMLButtonElement>("[data-close-gallery-settings]")!;
  const fieldset = form.querySelector("fieldset")!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const visibility = form.querySelector<HTMLInputElement | HTMLSelectElement>("[name=visibility]")!;
  const savedVisibility = visibility.value;
  const albumFields = dialog.querySelector<HTMLElement>("#gallery-album-fields")!;
  const exclusionFields = dialog.querySelector<HTMLElement>("#gallery-exclusion-fields")!;
  const count = dialog.querySelector<HTMLElement>("[data-gallery-exclusion-count]")!;
  const modeButtons = dialog.querySelectorAll<HTMLButtonElement>("[data-gallery-settings-mode]");
  const scrollArea = dialog.querySelector<HTMLElement>("[data-gallery-settings-scroll]")!;
  const saveStatus = dialog.querySelector<HTMLElement>("[data-gallery-save-status]")!;
  const albumId = encodeURIComponent(root.dataset.albumId!);
  const exclusionEndpoint = `/api/member/gallery/${albumId}/exclusions`;
  const savedCover = root.dataset.coverId ?? "";
  type Mode = "album" | "exclusions";
  const photoList = (grid: string, status: string, more: string) => ({
    grid: dialog.querySelector<HTMLElement>(grid)!,
    status: dialog.querySelector<HTMLElement>(status)!,
    more: dialog.querySelector<HTMLButtonElement>(more)!,
    cursor: null as string | null,
    loaded: false,
    loading: false,
  });
  const lists = {
    album: photoList("[data-gallery-cover-photos]", "[data-gallery-photo-status]", "[data-gallery-cover-more]"),
    exclusions: photoList("[data-gallery-exclusion-photos]", "[data-gallery-exclusion-status]", "[data-gallery-exclusion-more]"),
  };
  let mode: Mode = "album", coverId = savedCover, saving = false;
  let exclusionRevision: number | undefined;
  let savedExclusions = new Set<string>(), excluded = new Set<string>();

  const markSelection = () => {
    dialog.querySelectorAll<HTMLButtonElement>("[data-cover-id]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.coverId === coverId));
    });
    lists.exclusions.grid.querySelectorAll<HTMLButtonElement>("[data-exclusion-id]").forEach(button => {
      button.setAttribute("aria-pressed", String(excluded.has(button.dataset.exclusionId!)));
    });
    count.textContent = exclusionRevision === undefined ? "" : `非公開 ${excluded.size}枚`;
  };

  const updateSubmit = () => {
    submit.disabled = saving || (mode === "exclusions" && exclusionRevision === undefined);
    submit.textContent = mode === "exclusions" ? "非公開設定を保存" : "設定を保存";
  };
  function showMode(next: Mode) {
    mode = next;
    albumFields.hidden = mode !== "album";
    exclusionFields.hidden = mode !== "exclusions";
    modeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.gallerySettingsMode === mode)));
    saveStatus.textContent = "";
    scrollArea.scrollTop = 0;
    updateSubmit();
    if (!lists[mode].loaded) void loadPhotos(mode);
  }

  async function loadPhotos(which: Mode) {
    const list = lists[which], exclusions = which === "exclusions";
    if (list.loading || (list.loaded && !list.cursor)) return;
    list.loading = list.more.disabled = true;
    list.status.textContent = "写真を読み込んでいます…";
    try {
      const endpoint = exclusions ? exclusionEndpoint : `/api/gallery/${albumId}`;
      const response = await fetch(`${endpoint}${list.cursor ? `?cursor=${encodeURIComponent(list.cursor)}` : ""}`);
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.photos)) throw new Error(result.message || result.error || "写真を読み込めませんでした。");
      if (exclusions) {
        if (list.loaded && exclusionRevision !== result.revision) throw new Error("別の画面で設定が変更されました。ページを再読み込みしてください。");
        if (!list.loaded) {
          exclusionRevision = result.revision;
          savedExclusions = new Set(result.excludedPhotoIds);
          excluded = new Set(savedExclusions);
        }
      }
      for (const photo of result.photos as { id: string; name: string; src: string }[]) {
        const button = document.createElement("button");
        button.type = "button";
        if (exclusions) button.dataset.exclusionId = photo.id;
        else button.dataset.coverId = photo.id;
        button.setAttribute("aria-label", exclusions ? `${photo.name}の公開を切り替える` : `${photo.name}をカバーにする`);
        const image = document.createElement("img");
        image.src = photo.src;
        image.alt = "";
        image.loading = "lazy";
        button.append(image);
        list.grid.append(button);
      }
      list.cursor = result.nextCursor;
      list.loaded = true;
      markSelection();
      list.status.textContent = list.grid.childElementCount ? "" : exclusions ? "選択できる写真はまだありません。" : "カバーにできる写真はまだありません。";
      list.more.textContent = "写真をさらに表示";
      list.more.hidden = !list.cursor;
    } catch (error) {
      list.status.textContent = error instanceof Error && !(error instanceof SyntaxError) ? error.message : "写真を読み込めませんでした。";
      list.more.textContent = "写真を再読み込み";
      list.more.hidden = false;
    } finally {
      list.loading = list.more.disabled = false;
      updateSubmit();
    }
  }

  trigger.addEventListener("click", () => {
    form.reset();
    coverId = savedCover;
    excluded = new Set(savedExclusions);
    markSelection();
    dialog.showModal();
    showMode("album");
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => trigger.focus({ preventScroll: true }));
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  lists.album.more.addEventListener("click", () => void loadPhotos("album"));
  lists.exclusions.more.addEventListener("click", () => void loadPhotos("exclusions"));
  modeButtons.forEach(button => button.addEventListener("click", () => {
    const next = button.dataset.gallerySettingsMode as Mode;
    if (saving || mode === next) return;
    const changed = mode === "album"
      ? coverId !== savedCover || visibility.value !== savedVisibility
      : excluded.size !== savedExclusions.size || [...excluded].some(id => !savedExclusions.has(id));
    if (changed) {
      saveStatus.textContent = "変更を保存してから表示を切り替えてください。";
      return;
    }
    showMode(next);
  }));
  dialog.addEventListener("click", event => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-cover-id],button[data-exclusion-id]");
    if (!button || saving) return;
    const id = button.dataset.exclusionId;
    if (id) {
      if (excluded.has(id)) excluded.delete(id);
      else if (excluded.size < 5000) excluded.add(id);
      else {
        saveStatus.textContent = "非公開にする写真は5,000枚以内で選択してください。";
        return;
      }
    } else coverId = button.dataset.coverId!;
    saveStatus.textContent = "";
    markSelection();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (submit.disabled) return;
    const exclusions = mode === "exclusions";
    const body = exclusions
      ? { revision: exclusionRevision, excludedPhotoIds: [...excluded] }
      : { visibility: visibility.value, revision: Number(root.dataset.revision), coverPhotoId: coverId || null };
    saving = close.disabled = fieldset.disabled = submit.disabled = true;
    saveStatus.textContent = "保存しています…";
    try {
      const response = await fetch(exclusions ? exclusionEndpoint : `/api/member/gallery/${albumId}/settings`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "アルバム設定を保存できませんでした。");
      flashNotice(exclusions ? "公開しない写真の設定を保存しました。" : "アルバム設定を保存しました。");
      location.reload();
    } catch (error) {
      saveStatus.textContent = error instanceof SyntaxError ? "アルバム設定を保存できませんでした。" : (error as Error).message;
      saving = close.disabled = fieldset.disabled = false;
      updateSubmit();
    }
  });
}
