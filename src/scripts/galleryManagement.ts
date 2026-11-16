import { apiErrorMessage, readApiResponse } from "./apiResponse";

async function send(url: string, input: Record<string, unknown> | FormData) {
  const options = input instanceof FormData ? { body: input } :
    { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) };
  const response = await fetch(url, { method: "POST", ...options });
  const result = await readApiResponse(response);
  if (!response.ok || !result.ok) throw new Error(result.message);
  return result;
}

function bindForm(form: HTMLFormElement, submit: (values: Record<string, FormDataEntryValue>) => Promise<void>) {
  const status = form.querySelector<HTMLElement>("[data-status]")!;
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (form.getAttribute("aria-busy") === "true") return;
    const values = Object.fromEntries(new FormData(form));
    const button = Array.from(form.elements).find((control): control is HTMLButtonElement => control instanceof HTMLButtonElement && control.type === "submit");
    form.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;
    status.textContent = "保存しています…";
    try { await submit(values); }
    catch (error) { status.textContent = apiErrorMessage(error); }
    finally {
      if (button) button.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
}

const create = document.querySelector<HTMLFormElement>("[data-gallery-create]");
if (create) bindForm(create, async input => {
  const { id } = await send("/api/member/gallery", { ...input, requestId: create.dataset.requestId });
  location.assign(`/Management/gallery/${encodeURIComponent(id)}`);
});

const editor = document.querySelector<HTMLElement>("[data-gallery-editor]");
const settings = editor?.querySelector<HTMLFormElement>("[data-album-settings]");
if (editor && settings) {
  const endpoint = `/api/member/gallery/${encodeURIComponent(editor.dataset.id!)}`;
  bindForm(settings, async input => {
    await send(`${endpoint}/settings`, {
      ...input, revision: Number(editor.dataset.revision), coverPhotoId: editor.dataset.cover || null,
    });
    location.reload();
  });

  const grid = editor.querySelector<HTMLElement>("[data-album-photos]")!;
  const photoStatus = editor.querySelector<HTMLElement>("[data-album-photo-status]")!;
  const more = editor.querySelector<HTMLButtonElement>("[data-more-photos]")!;
  let cursor: string | null = null;
  let loading = false;
  let reloadPhotos = false;
  const displayed = new Set<string>();
  async function loadPhotos(reset = false) {
    if (loading) {
      if (reset) reloadPhotos = true;
      return;
    }
    if (reset) {
      cursor = null;
      grid.replaceChildren();
      displayed.clear();
    }
    loading = more.disabled = true;
    photoStatus.textContent = "写真を読み込んでいます…";
    try {
      const response = await fetch(`${endpoint}/exclusions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      const data = await readApiResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.message);
      const excluded = new Set(data.excludedPhotoIds);
      for (const photo of data.photos as Array<{ id: string; name: string; src: string }>) {
        if (displayed.has(photo.id)) continue;
        displayed.add(photo.id);
        const card = document.createElement("figure");
        const img = document.createElement("img");
        img.src = photo.src;
        img.alt = "";
        img.loading = "lazy";
        const caption = document.createElement("figcaption");
        caption.textContent = excluded.has(photo.id) ? `${photo.name}（非掲載）` : photo.name;
        card.append(img, caption);
        grid.append(card);
      }
      cursor = data.nextCursor;
      more.hidden = !cursor;
      more.textContent = "写真をさらに表示";
      photoStatus.textContent = grid.childElementCount ? "" : "写真はまだありません。";
    } catch (error) {
      photoStatus.textContent = apiErrorMessage(error);
      more.hidden = false;
      more.textContent = "写真を再読み込み";
    } finally {
      loading = more.disabled = false;
      if (reloadPhotos) {
        reloadPhotos = false;
        void loadPhotos(true);
      }
    }
  }
  more.addEventListener("click", () => void loadPhotos());
  void loadPhotos();

  const upload = editor.querySelector<HTMLFormElement>("[data-gallery-upload]");
  if (upload) {
    const input = upload.querySelector<HTMLInputElement>("input[type=file]")!;
    const submit = upload.querySelector<HTMLButtonElement>('button[type=submit]')!;
    const list = upload.querySelector<HTMLElement>("[data-upload-results]")!;
    type Upload = { file: File; row: HTMLLIElement; status: HTMLSpanElement; retry: HTMLButtonElement; state: "waiting" | "done" | "failed" };
    let queue: Upload[] = [];
    let running = false;

    async function processQueue() {
      if (running) return;
      running = input.disabled = submit.disabled = true;
      let succeeded = false;
      try {
        for (const job of queue.filter(item => item.state === "waiting")) {
          job.retry.hidden = true;
          job.status.textContent = "Lightroomに送信中…";
          try {
            if (job.file.size > 20 * 1024 * 1024) throw new Error("20MBを超えています。");
            const body = new FormData();
            body.set("file", job.file);
            await send(`${endpoint}/upload`, body);
            job.state = "done";
            job.status.textContent = "アップロード済み。写真の生成に時間がかかる場合があります。";
            succeeded = true;
          } catch (error) {
            job.state = "failed";
            job.retry.hidden = false;
            job.status.textContent = apiErrorMessage(error);
          }
        }
      } finally {
        input.value = "";
        running = input.disabled = submit.disabled = false;
        if (succeeded) void loadPhotos(true);
      }
    }

    upload.addEventListener("submit", event => {
      event.preventDefault();
      if (running || !input.files?.length) return;
      queue = Array.from(input.files, file => {
        const row = document.createElement("li");
        const status = document.createElement("span");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "再試行";
        retry.hidden = true;
        status.textContent = "待機中";
        row.append(`${file.name} · `, status, " ", retry);
        const job: Upload = { file, row, status, retry, state: "waiting" };
        retry.addEventListener("click", () => {
          if (running || job.state !== "failed") return;
          job.state = "waiting";
          void processQueue();
        });
        return job;
      });
      list.replaceChildren(...queue.map(job => job.row));
      void processQueue();
    });
  }
}
