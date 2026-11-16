import { type PhotoMetadata, type PortfolioSeries } from "../types/photos";
import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
import { optimizeMicrocmsImage } from "../utils/microcmsImage";
import { createPortfolioIntroductionEditor } from "./portfolioIntroductionEditor";
import { createPortfolioPhotoEditor } from "./portfolioPhotoEditor";
import { PORTFOLIO_BOOK_LIMIT, portfolioBookMediaUrl, type PortfolioBookDetails } from "../types/portfolioBooks";
import { PORTFOLIO_UPLOAD_LIMIT } from "../types/portfolioUpload";
const form = document.querySelector<HTMLFormElement>("#portfolio-form");
const bootstrap = document.querySelector<HTMLElement>("#portfolio-edit-data");
if (form && bootstrap) {
  const initial = JSON.parse(bootstrap.dataset.initial || "{}");
  const viewUrl = JSON.parse(bootstrap.dataset.viewUrl || '""');
  const pictures: string[] = Array.isArray(initial.pictures)
    ? [...initial.pictures]
    : [];
  const metadata: Record<string, PhotoMetadata> = initial.photoMetadata ?? {};
  const series: PortfolioSeries[] = initial.photoSeries ?? [];
  const books: PortfolioBookDetails[] = initial.portfolioBooks ?? [];
  const sizes: Record<string, { width: number; height: number }> = initial.photoSizes ?? {};
  const stagedSeries = new Map<string, { file: File; uploaded?: string }>();
  const seriesList = form.querySelector<HTMLElement>("[data-portfolio-series-list]")!;
  const bookList = form.querySelector<HTMLElement>("[data-portfolio-book-list]")!;
  const createSeries = form.querySelector<HTMLButtonElement>("[data-portfolio-series-create]")!;
  const createBook = form.querySelector<HTMLButtonElement>("[data-portfolio-book-create]")!;
  let seriesEditor: ReturnType<typeof import("./portfolioSeriesEditor").createPortfolioSeriesEditor> | undefined;
  let bookEditor: ReturnType<typeof import("./portfolioBookEditor").createPortfolioBookEditor> | undefined;
  let seriesToFocus: string | undefined, booksDirty = false;
  let icon = initial.iconUrl || "",
    busy = false,
    dirty = false;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const status = document.getElementById("status-message")!;
  const iconList = document.getElementById("icon-preview")!,
    pictureList = document.getElementById("picture-list")!;
  const notify = (text: string, error = false) => {
    operationNotice(text,error,"portfolio-editor");
    status.textContent = text;
    status.className = "status-message " + (error ? "error" : "success");
  };
  const markDirty = () => {
    dirty = true;
  };
  function discardStagedSeries() {
    for (const url of stagedSeries.keys()) {
      URL.revokeObjectURL(url);
      delete sizes[url];
    }
    stagedSeries.clear();
  }
  async function openSeries(trigger: HTMLElement, group?: PortfolioSeries, staged: string[] = []) {
    try {
      const { createPortfolioSeriesEditor } = await import("./portfolioSeriesEditor");
      if (busy || !trigger.isConnected) return;
      seriesEditor ??= createPortfolioSeriesEditor(document.querySelector<HTMLDialogElement>("#portfolio-series-editor")!, {
        pictures, series, sizes, title: url => stagedSeries.get(url)?.file.name ?? metadata[url]?.title,
        async apply(work, progress) {
          const added = work.photos.filter(photo => stagedSeries.has(photo.assetId));
          if (pictures.length + added.length > 500) throw new Error("作品画像は500枚以内で追加してください。");
          setBusy(true);
          try {
            for (const [index, photo] of added.entries()) {
              const asset = stagedSeries.get(photo.assetId)!;
              progress(asset.file.size > PORTFOLIO_UPLOAD_LIMIT
                ? `${index + 1} / ${added.length}枚を圧縮してアップロードしています…`
                : `${index + 1} / ${added.length}枚をアップロードしています…`);
              asset.uploaded ??= await upload(asset.file, true);
            }
            const urls = added.map(photo => stagedSeries.get(photo.assetId)!.uploaded!);
            if (new Set(urls).size !== urls.length || urls.some(url => pictures.includes(url)))
              throw new Error("重複する写真があります。別のファイルを選んでください。");
            for (const photo of added) {
              const url = stagedSeries.get(photo.assetId)!.uploaded!;
              sizes[url] = sizes[photo.assetId];
              photo.assetId = url;
              pictures.push(url);
            }
          } finally { setBusy(false); }
          const index = series.findIndex(group => group.id === work.id);
          if (index === -1) series.push(work);
          else series[index] = work;
          markDirty();
          render();
          seriesToFocus = work.id;
        },
        close() {
          discardStagedSeries();
          if (seriesToFocus) seriesList.querySelector<HTMLButtonElement>(`[data-edit-portfolio-series="${seriesToFocus}"]`)?.focus({ preventScroll: true });
          seriesToFocus = undefined;
        },
        message: notify,
      });
      seriesEditor.open(trigger, group, staged);
    } catch {
      discardStagedSeries();
      notify("組写真ツールを開けませんでした。再度お試しください。", true);
    }
  }
  createSeries.addEventListener("click", () => void openSeries(createSeries));
  async function openBook(trigger: HTMLElement, book?: PortfolioBookDetails) {
    try {
      const { createPortfolioBookEditor } = await import("./portfolioBookEditor");
      if (busy || !trigger.isConnected) return;
      if (!book && books.length >= PORTFOLIO_BOOK_LIMIT) {
        notify(`ブックは${PORTFOLIO_BOOK_LIMIT}冊まで追加できます。`, true);
        return;
      }
      bookEditor ??= createPortfolioBookEditor(document.querySelector<HTMLDialogElement>("#portfolio-book-editor")!, input("field-target-id").value, updated => {
        const index = books.findIndex(item => item.id === updated.id);
        if (index < 0) books.push(updated);
        else books[index] = updated;
        booksDirty = true;
        markDirty();
        render();
        bookList.querySelector<HTMLButtonElement>(`[data-edit-portfolio-book="${updated.id}"]`)?.focus({ preventScroll: true });
      });
      bookEditor.open(trigger, book);
    } catch {
      notify("ブック編集を開けませんでした。再度お試しください。", true);
    }
  }
  createBook.addEventListener("click", () => void openBook(createBook));
  form.addEventListener("input", event => {
    if (!(event.target instanceof HTMLInputElement && event.target.type === "file")) markDirty();
  });
  const introduction = createPortfolioIntroductionEditor(form.querySelector<HTMLElement>("[data-introduction-editor]")!);
  const photoEditor = createPortfolioPhotoEditor(document.querySelector<HTMLDialogElement>("#portfolio-photo-editor")!, {
    async inspect(url) {
      if (!initial.photoIds?.[url]) return null;
      const response = await fetch("/api/photos/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs: [{ source: "portfolio", containerId: input("field-target-id").value, imageId: initial.photoIds[url] }], details: true }) });
      const result = await readApiResponse(response), photo = result.results?.[0]?.photo;
      if (!response.ok || !photo) throw new Error(result.message || "撮影情報を読み込めませんでした。");
      return photo as PhotoMetadata;
    },
    apply(url, value) {
      metadata[url] = value;
      markDirty();
      render();
      pictureList.querySelector<HTMLButtonElement>(`[data-photo-edit="${pictures.indexOf(url)}"]`)?.focus({ preventScroll: true });
    },
  });
  const setBusy = (value: boolean) => {
    busy = value;
    introduction.setDisabled(value);
    form
      .querySelectorAll<
        HTMLInputElement | HTMLButtonElement
      >("#submit-button,input[type=file],#picture-list button,#icon-preview button,.portfolio-series-tools button,[data-portfolio-book-create]")
      .forEach(el => { el.disabled = value || el.dataset.boundary === "true"; });
    form.querySelector<HTMLElement>(".upload-area")!.setAttribute("aria-busy", String(value));
  };
  const button = (label: string, action: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (!busy) action();
    });
    return b;
  };
  const render = () => {
    iconList.replaceChildren();
    pictureList.replaceChildren();
    const assigned = new Map(series.flatMap(work => work.photos.map(photo => [photo.assetId, work] as const)));
    createSeries.disabled = pictures.filter(url => !assigned.has(url)).length < 2;
    createSeries.dataset.boundary = String(createSeries.disabled);
    seriesList.replaceChildren(...series.map((work, index) => {
      const item = document.createElement("div");
      const title = document.createElement("span");
      title.textContent = `組写真 ${index + 1} · ${work.metadata.title || "無題"}（${work.photos.length}枚）`;
      const edit = button("組写真を編集", () => void openSeries(edit, work));
      edit.dataset.editPortfolioSeries = work.id;
      const release = button("組写真を解除", () => {
        series.splice(index, 1);
        markDirty();
        render();
        createSeries.focus({ preventScroll: true });
      });
      item.append(title, edit, release);
      return item;
    }));
    bookList.replaceChildren(...books.map((book, index) => {
      const item = document.createElement("div");
      const cover = document.createElement("img");
      cover.src = portfolioBookMediaUrl(input("field-target-id").value, book.coverId, true);
      cover.alt = "";
      cover.loading = "lazy";
      const title = document.createElement("span");
      title.textContent = `ブック ${index + 1} · ${book.metadata.title}（${book.pageCount}ページ）`;
      const edit = button("ブックを編集", () => void openBook(edit, book));
      edit.dataset.editPortfolioBook = book.id;
      const remove = button("削除", () => {
        books.splice(index, 1);
        booksDirty = true;
        markDirty();
        render();
        createBook.focus({ preventScroll: true });
      });
      item.append(cover, title, edit, remove);
      return item;
    }));
    const chip = (url: string, alt: string) => {
      const div = document.createElement("div");
      div.className = "picture-chip";
      const img = document.createElement("img");
      img.src = optimizeMicrocmsImage(url, { width: 240, quality: 75 });
      img.alt = alt;
      img.width = 120;
      img.height = 120;
      img.loading = "lazy";
      img.style.objectFit = "cover";
      div.append(img);
      return div;
    };
    if (icon) {
      const div = chip(icon, "現在のアイコン");
      div.append(
        button("削除", () => {
          icon = "";
          markDirty();
          render();
        }),
      );
      iconList.append(div);
    }
    const focusPhotoAction = (index: number, action: string) => {
      const button = pictureList.querySelector<HTMLButtonElement>(`[data-photo-${action}="${index}"]`);
      (button?.disabled ? pictureList.querySelector<HTMLButtonElement>(`[data-photo-edit="${index}"]`) : button)?.focus({ preventScroll: true });
    };
    pictures.forEach((url, index) => {
      const div = chip(url, `作品 ${index + 1}`);
      div.classList.add("portfolio-picture-card");
      const heading = document.createElement("div"), number = document.createElement("span"), title = document.createElement("strong");
      heading.className = "picture-card-heading";
      number.textContent = `作品 ${String(index + 1).padStart(2, "0")}`;
      title.textContent = metadata[url]?.title || "タイトル未設定";
      heading.append(number, title);
      const group = assigned.get(url);
      if (group) {
        const label = document.createElement("small");
        label.textContent = `組写真 · ${group.metadata.title || "無題"}`;
        heading.append(label);
      }
      const edit = button("写真情報を編集", () => photoEditor.open({ url, index, total: pictures.length, metadata: metadata[url] ?? {} }, edit));
      edit.className = "picture-edit-button";
      edit.dataset.photoEdit = String(index);
      edit.setAttribute("aria-haspopup", "dialog");
      edit.setAttribute("aria-controls", "portfolio-photo-editor");
      const actions = document.createElement("div");
      actions.className = "picture-card-actions";
      const up = button("前へ", () => {
        [pictures[index - 1], pictures[index]] = [
          pictures[index],
          pictures[index - 1],
        ];
        markDirty();
        render();
        focusPhotoAction(index - 1, "up");
      });
      up.disabled = index === 0;
      up.dataset.boundary = String(up.disabled);
      up.dataset.photoUp = String(index);
      up.setAttribute("aria-label", `作品 ${index + 1} を前へ`);
      const down = button("後へ", () => {
        [pictures[index + 1], pictures[index]] = [
          pictures[index],
          pictures[index + 1],
        ];
        markDirty();
        render();
        focusPhotoAction(index + 1, "down");
      });
      down.disabled = index === pictures.length - 1;
      down.dataset.boundary = String(down.disabled);
      down.dataset.photoDown = String(index);
      down.setAttribute("aria-label", `作品 ${index + 1} を後へ`);
      const remove = button("削除", () => {
        pictures.splice(index, 1);
        if (group) {
          group.photos = group.photos.filter(photo => photo.assetId !== url);
          if (group.photos.length < 2) series.splice(series.indexOf(group), 1);
        }
        markDirty();
        render();
        pictureList.querySelector<HTMLButtonElement>(`[data-photo-edit="${Math.min(index, pictures.length - 1)}"]`)?.focus({ preventScroll: true });
        if (!pictures.length) input("picture-files").focus({ preventScroll: true });
      });
      remove.className = "picture-remove-button";
      remove.setAttribute("aria-label", `作品 ${index + 1} を削除`);
      actions.append(
        up,
        down,
        remove,
      );
      div.append(heading, edit, actions);
      pictureList.append(div);
    });
    form.querySelector<HTMLElement>("[data-picture-count]")!.textContent = `${pictures.length} / 500枚`;
    if (!pictures.length) {
      const empty = document.createElement("p");
      empty.className = "picture-list-empty";
      empty.textContent = "写真を追加すると、ここで並べ替えや情報の編集ができます。";
      pictureList.append(empty);
    }
  };
  const tags = document.getElementById("field-hashtags") as HTMLSelectElement;
  for (const tag of initial.hashtags ?? [])
    if (!Array.from(tags.options).some((option) => option.value === tag))
      tags.add(new Option(tag, tag, true, true));
  async function upload(file: File, retryRateLimit = false) {
    let originalMetadata: PhotoMetadata | undefined;
    if (file.size > PORTFOLIO_UPLOAD_LIMIT) {
      try {
        const { compressPortfolioImage } = await import("./portfolioImageCompression");
        const compressed = await compressPortfolioImage(file);
        file = compressed.file;
        originalMetadata = compressed.metadata;
      } catch (error) {
        throw new Error(`${file.name}: ${apiErrorMessage(error)}`);
      }
    }
    const data = new FormData();
    data.set("file", file);
    const request = () => fetch("/api/portfolio/upload", {
      method: "POST",
      body: data,
    });
    let response = await request();
    for (let attempt = 0; retryRateLimit && response.status === 429 && attempt < 2; attempt++) {
      const seconds = Math.min(60, Math.max(1, Number(response.headers.get("Retry-After")) || 13));
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      response = await request();
    }
    const result = await readApiResponse(response);
    if (!response.ok || !result.url)
      throw new Error(result.message || "画像をアップロードできませんでした。");
    metadata[result.url as string] ??= { ...result.photoMetadata, ...originalMetadata };
    return result.url as string;
  }
  input("series-files").addEventListener("change", async () => {
    const picker = input("series-files");
    const files = Array.from(picker.files ?? []);
    picker.value = "";
    if (!files.length || busy) return;
    if (files.length < 2 || files.length > 100 || pictures.length + files.length > 500) {
      notify("組写真は2〜100枚を選択してください。作品画像は合計500枚までです。", true);
      return;
    }
    setBusy(true);
    try {
      for (const file of files) {
        const bitmap = await createImageBitmap(file);
        const url = URL.createObjectURL(file);
        sizes[url] = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        stagedSeries.set(url, { file });
      }
    } catch {
      discardStagedSeries();
      notify("画像を読み込めませんでした。JPEG・PNG・WebPを選択してください。", true);
    } finally { setBusy(false); }
    if (stagedSeries.size) await openSeries(picker, undefined, [...stagedSeries.keys()]);
  });
  for (const id of ["field-icon-file", "picture-files"])
    input(id)?.addEventListener("change", async () => {
      const files = Array.from(input(id).files ?? []);
      if (!files.length || busy) return;
      if (id === "picture-files" && pictures.length + files.length > 500) {
        notify("作品は500枚以内で選択してください。", true);
        input(id).value = "";
        return;
      }
      const progress = form.querySelector<HTMLElement>("[data-picture-upload-status]")!;
      let completed = 0;
      setBusy(true);
      notify("画像をアップロードしています…");
      if (id === "picture-files") progress.hidden = false;
      try {
        for (const [index, file] of files.entries()) {
          if (id === "picture-files") progress.textContent = files[index].size > PORTFOLIO_UPLOAD_LIMIT
            ? `${index + 1} / ${files.length}枚を圧縮してアップロードしています…`
            : `${index + 1} / ${files.length}枚をアップロードしています…`;
          const url = await upload(file);
          if (id === "field-icon-file") icon = url;
          else pictures.push(url);
          completed++;
          markDirty();
        }
        notify("画像を追加しました。保存すると公開ページへ反映されます。");
        if (id === "picture-files") progress.textContent = `${files.length}枚の写真を追加しました。ページ下部の「Save changes」で公開します。`;
      } catch (error) {
        notify(
          apiErrorMessage(error),
          true,
        );
        if (id === "picture-files") progress.textContent = `${completed} / ${files.length}枚を追加しました。残りの写真を追加できませんでした。\n${apiErrorMessage(error)}`;
      } finally {
        render();
        setBusy(false);
        input(id).value = "";
      }
    });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      busy ||
      !form.reportValidity() ||
      !introduction.validate() ||
      !window.confirm("この内容でPortfolioを更新しますか？")
    )
      return;
    setBusy(true);
    notify("保存しています…");
    const body = {
      portfolioId: input("field-target-id").value,
      name: input("field-name").value,
      iconUrl: icon,
      pictures: [...pictures],
      photoMetadata: Object.fromEntries(pictures.map(url => [url, metadata[url] ?? {}])),
      photoSeries: series,
      ...(booksDirty ? {
        portfolioBookRevision: initial.portfolioBookRevision,
        portfolioBooks: books.map(({ id, pdfId, coverId, coverPage, direction, metadata, pageLayout, blankPagesAfter }) =>
          ({ id, pdfId, coverId, coverPage, direction, metadata, pageLayout, blankPagesAfter })),
      } : {}),
      hashtags: Array.from(tags.selectedOptions).map((o) => o.value),
      grade: input("field-grade").value,
      x_url: input("field-x-url").value,
      instagram: input("field-instagram").value,
      camera: input("field-camera").value,
      self_introduction: introduction.html(),
      self_introduction_format: "html",
    };
    try {
      const response = await fetch("/api/portfolio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok)
        throw new Error(result.message || "保存できませんでした。");
      dirty = false;
      busy = false;
      notify("保存しました。公開ページへ移動します。");
      if (viewUrl) location.assign(viewUrl);
    } catch (error) {
      notify(
        apiErrorMessage(error),
        true,
      );
      setBusy(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy) event.preventDefault();
  });
  render();
}
