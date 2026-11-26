import {watchAdvisoryClock} from './advisoryDeadlineUi.ts';
import {deadlinePassed} from '../lib/advisoryWarnings.ts';
import {overdueWarningHtml} from '../lib/advisoryWarnings.ts';
import type { questionFor } from "../lib/memberTools";
import { type ToolOption, type ToolResults } from "../lib/memberToolTypes";
import { exportToolResults, type ExportAsset } from "./memberToolExport";
import { operationNotice } from "./siteNotice";
import { initRichBodyEditor } from "./richBodyEditor";
import { richBodyPreview } from "./richBodyPreview";
type State = ReturnType<typeof questionFor>;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const field = (parent: ParentNode, name: string) =>
  parent.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >(`[name="${name}"]`)!;
const dateISO = (value: string) =>
  value ? new Date(`${value}:00+09:00`).toISOString() : "";
const dateLabel = (o: ToolOption) =>
  [o.date, o.text, [o.start, o.end].filter(Boolean).join("〜")]
    .filter(Boolean)
    .join(" ");
async function api(url: string, body?: unknown) {
  const r = await fetch(
    url,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await r.json();
  if (!r.ok || !data.ok)
    throw new Error(data.message || "操作を完了できませんでした。");
  if (body !== undefined) document.dispatchEvent(new CustomEvent('help:statechange'));
  return data;
}
function status(root: ParentNode, message: string, error = false) {
  const el = root.querySelector<HTMLElement>("[data-tool-status]");
  if (el) {
    el.textContent = message;
    el.dataset.error = String(error);
  }
  operationNotice(message, error, "member-tool");
}
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-create-tool]",
))
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const r = await api("/api/member/tools", {
        kind: button.dataset.createTool,
      });
      location.href = `/Member/manage/tools/${r.id}`;
    } catch (e) {
      status(document, (e as Error).message, true);
      button.disabled = false;
    }
  });
const listItems = [
  ...document.querySelectorAll<HTMLElement>("[data-tool-list-item]"),
];
const search = document.querySelector<HTMLInputElement>("[data-tool-search]");
const filter = document.querySelector<HTMLSelectElement>("[data-tool-filter]");
const filterTools = () => {
  const query = (search?.value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .trim();
  for (const item of listItems)
    item.hidden = Boolean(
      (filter?.value && item.dataset.toolKind !== filter.value) ||
        !(item.dataset.toolQuestion || "")
          .normalize("NFKC")
          .toLocaleLowerCase("ja")
          .includes(query),
    );
  const empty = document.querySelector<HTMLElement>("[data-tool-no-match]");
  if (empty) empty.hidden = listItems.some((item) => !item.hidden);
};
search?.addEventListener("input", filterTools);
filter?.addEventListener("change", filterTools);
for (const root of document.querySelectorAll<HTMLElement>("[data-tool-root]"))
  setup(root);
function setup(root: HTMLElement) {
  let state: State = JSON.parse(root.dataset.toolState!),
    assets: ExportAsset[] = JSON.parse(root.dataset.toolAssets || "[]");
  const base = `/api/member/tools/${root.dataset.toolId}`,
    manage = root.dataset.toolMode === "manage";
  const questionField = root.querySelector<HTMLElement>('[data-body-field="question"]');
  const questionEditor = questionField && initRichBodyEditor(questionField);
  let busy = false,
    loadedResults: ToolResults | null = null;
  const assetURL = (id: string) => `${base}/assets/${id}`;
  const deadlineClock=watchAdvisoryClock(()=>{let warning=root.querySelector<HTMLElement>('[data-deadline-warning]');const show=!manage&&state.open&&state.canAnswer&&deadlinePassed(state.settings.endsAt);if(show&&!warning){root.insertAdjacentHTML('afterbegin',overdueWarningHtml());warning=root.querySelector('[data-deadline-warning]');}if(warning)warning.hidden=!show;},()=>[state.settings.endsAt]);
  const showStatus = (msg: string, error = false) => status(root, msg, error);
  const sync = () => {
    const remove = root.querySelector<HTMLButtonElement>('[data-delete-item]');
    if (remove) {
      remove.dataset.deleteRevision = String(state.revision);
      remove.dataset.deleteQuestion = state.question;
    }
    let late=root.querySelector<HTMLElement>('[data-deadline-warning]');
    if(!manage&&state.canAnswer&&state.overdue&&!late){root.insertAdjacentHTML('afterbegin',overdueWarningHtml());late=root.querySelector<HTMLElement>('[data-deadline-warning]');}
    if(late)late.hidden=manage||!state.canAnswer||!state.overdue;deadlineClock.refresh();
    const p = root.querySelector("[data-reception-status]");
    if (p)
      p.textContent =
        state.status === "draft"
          ? "下書き（まだ公開していません）"
          : state.open
            ? `受付中${state.settings.endsAt ? " · 提出期限 " + new Date(state.settings.endsAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : " · 終了日時なし"}`
            : "受付終了";
    const toggle = root.querySelector<HTMLButtonElement>(
      "[data-toggle-reception]",
    );
    if (toggle) {
      toggle.disabled = state.status === "draft";
      toggle.textContent = state.closed ? "受付を再開" : "受付を終了";
    }
    root
      .querySelectorAll("[data-tool-state-badge]")
      .forEach(
        (badge) =>
          (badge.textContent =
            state.status === "draft"
              ? "下書き"
              : state.open
                ? "受付中"
                : "受付終了"),
      );
    const publicationSummary = root.querySelector("[data-publication-summary]");
    if (publicationSummary && state.publication)
      publicationSummary.textContent = state.publication.paused
        ? "公開停止中"
        : "公開設定あり";
    if (!manage) renderAnswer();
  };
  async function act(payload: Record<string, unknown>) {
    const own = payload.responseId
      ? state.own.find((r) => r.id === payload.responseId)
      : state.kind === "box"
        ? undefined
        : state.own[0];
    const r = await api(base, {
      ...payload,
      revision: state.revision,
      answerRevision: state.answerRevision,
      responseRevision: own?.revision ?? 0,
    });
    state = r.tool;
    sync();
    return r;
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await task();
    } catch (e) {
      showStatus((e as Error).message, true);
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  }
  async function upload(file: File, purpose: "option" | "response") {
    if (file.size > 20 * 1024 * 1024)
      throw new Error("ファイルは1件20 MB以内にしてください。");
    const data = new FormData();
    data.set("file", file);
    data.set("purpose", purpose);
    const r = await fetch(`${base}/upload`, { method: "POST", body: data });
    const json = await r.json();
    if (!r.ok || !json.ok)
      throw new Error(json.message || "アップロードできませんでした。");
    const a = { ...json.asset, url: assetURL(json.asset.id) };
    assets.push(a);
    return a;
  }
  root
    .querySelectorAll("[data-close-dialog]")
    .forEach((b) =>
      b.addEventListener("click", () => b.closest("dialog")?.close()),
    );
  function img(id: string) {
    const image = node("img");
    image.src = assetURL(id);
    image.alt = "添付画像";
    image.loading = "lazy";
    return image;
  }
  function safeText(text: string) {
    const div = node("div");
    div.className = "tool-response-body";
    const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
    for (const part of parts) {
      if (/^https?:\/\//.test(part)) {
        const a = node("a", part);
        a.href = part;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        div.append(a);
      } else div.append(document.createTextNode(part));
    }
    return div;
  }
  function responseBody(text: string) {
    if (text.length <= 400) return safeText(text);
    const details = node("details");
    details.className = "tool-response-detail";
    const summary = node("summary"),
      excerpt = node("span", text.slice(0, 180) + "…"),
      label = node("span", "全文を読む");
    excerpt.className = "tool-response-excerpt";
    label.className = "tool-expand-label";
    summary.append(excerpt, label);
    details.append(summary, safeText(text));
    details.addEventListener(
      "toggle",
      () => (label.textContent = details.open ? "本文を閉じる" : "全文を読む"),
    );
    return details;
  }
  function attachments(parent: HTMLElement, ids: string[]) {
    const wrap = node("div");
    wrap.className = "tool-assets";
    for (const id of ids) {
      const a = assets.find((a) => a.id === id);
      if (!a) continue;
      const link = node("a", a.name);
      link.href = assetURL(id);
      link.target = "_blank";
      link.rel = "noopener";
      if (a.mime.startsWith("image/")) link.prepend(img(id));
      wrap.append(link);
    }
    parent.append(wrap);
  }
  const optionRoot = root.querySelector<HTMLElement>("[data-tool-options]");
  function refreshOptions() {
    const rows = [
      ...(optionRoot?.querySelectorAll<HTMLElement>(".tool-option-edit") || []),
    ];
    rows.forEach((row, index) => {
      row.querySelector("[data-option-number]")!.textContent =
        `${state.kind === "schedule" ? "候補" : "選択肢"} ${String(index + 1).padStart(2, "0")}`;
    });
    const count = root.querySelector("[data-option-count]");
    if (count) count.textContent = `${rows.length}件`;
  }
  function optionEditor(option: Partial<ToolOption> = {}) {
    if (!optionRoot) return;
    const row = node("div");
    row.className = "tool-option-edit";
    row.dataset.optionId = option.id || "";
    row.dataset.imageId = option.imageId || "";
    const heading = node("div");
    heading.className = "tool-option-heading";
    const number = node("span");
    number.className = "tool-option-number";
    number.dataset.optionNumber = "";
    const actions = node("div");
    actions.className = "tool-option-actions";
    for (const direction of ["up", "down"] as const) {
      const move = node("button", direction === "up" ? "↑" : "↓");
      move.type = "button";
      move.setAttribute(
        "aria-label",
        direction === "up" ? "選択肢を上へ" : "選択肢を下へ",
      );
      move.addEventListener("click", () => {
        if (direction === "up" && row.previousElementSibling)
          row.previousElementSibling.before(row);
        if (direction === "down" && row.nextElementSibling)
          row.nextElementSibling.after(row);
        refreshOptions();
      });
      actions.append(move);
    }
    const remove = node("button", "削除");
    remove.type = "button";
    remove.setAttribute("aria-label", "選択肢を削除");
    remove.addEventListener("click", () => {
      row.remove();
      refreshOptions();
      renderCalendar();
    });
    actions.append(remove);
    heading.append(number, actions);
    row.append(heading);
    const fields = node("div");
    fields.className = "tool-option-fields";
    row.append(fields);
    if (state.kind === "schedule") {
      const label = node("label", "日付"),
        input = node("input");
      input.type = "date";
      input.name = "optionDate";
      input.value = option.date || "";
      input.required = true;
      input.addEventListener("change", renderCalendar);
      label.append(input);
      fields.append(label);
    }
    const label = node(
        "label",
        state.kind === "schedule" ? "時間帯など（省略可）" : "選択肢",
      ),
      input = node("input");
    input.name = "optionText";
    input.maxLength = 300;
    input.value = option.text || "";
    input.required = state.kind === "poll";
    input.placeholder =
      state.kind === "schedule" ? "例：午前・午後" : "選択肢を入力";
    label.append(input);
    fields.append(label);
    if (state.kind === "schedule") {
      const timeFields = node("div");
      timeFields.className = "tool-time-fields";
      for (const key of ["start", "end"] as const) {
        const label = node("label", key === "start" ? "開始時刻" : "終了時刻"),
          input = node("input");
        input.type = "time";
        input.name = `option${key}`;
        input.value = option[key] || "";
        label.append(input);
        timeFields.append(label);
      }
      fields.append(timeFields);
    } else {
      const imagePreview = node("div");
      if (option.imageId) imagePreview.append(img(option.imageId));
      row.append(imagePreview);
      const media = node("details");
      media.className = "tool-option-media";
      media.append(node("summary", "画像を設定（任意）"));
      const label = node("label", "画像を選択"),
        input = node("input");
      input.type = "file";
      input.accept = "image/*";
      input.name = "optionImage";
      label.append(input);
      media.append(label);
      const removeImage = node("button", "画像を外す");
      removeImage.type = "button";
      removeImage.hidden = !option.imageId;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const preview = node("img"),
          url = URL.createObjectURL(file);
        preview.src = url;
        preview.alt = "選択した画像";
        preview.onload = preview.onerror = () => URL.revokeObjectURL(url);
        imagePreview.replaceChildren(preview);
        removeImage.hidden = false;
      });
      removeImage.addEventListener("click", () => {
        row.dataset.imageId = "";
        input.value = "";
        imagePreview.replaceChildren();
        removeImage.hidden = true;
      });
      media.append(removeImage);
      row.append(media);
    }
    optionRoot.append(row);
    refreshOptions();
  }
  if (optionRoot) {
    state.options.forEach(optionEditor);
    if (!state.options.length && state.kind === "poll") {
      optionEditor();
      optionEditor();
    }
  }
  root
    .querySelector("[data-add-option]")
    ?.addEventListener("click", () => optionEditor());
  const today = new Date();
  let calendar = new Date(today.getFullYear(), today.getMonth(), 1);
  function renderCalendar() {
    const container = root.querySelector("[data-calendar-days]");
    if (!container) return;
    container.replaceChildren();
    root.querySelector("[data-calendar-month]")!.textContent =
      `${calendar.getFullYear()}年 ${calendar.getMonth() + 1}月`;
    for (const d of ["日", "月", "火", "水", "木", "金", "土"])
      container.append(node("span", d));
    for (let i = 0; i < calendar.getDay(); i++) container.append(node("span"));
    const last = new Date(
      calendar.getFullYear(),
      calendar.getMonth() + 1,
      0,
    ).getDate();
    for (let i = 1; i <= last; i++) {
      const date = `${calendar.getFullYear()}-${String(calendar.getMonth() + 1).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
      const b = node("button", String(i));
      b.type = "button";
      b.setAttribute("aria-label", date);
      b.dataset.selected = String(
        [...root.querySelectorAll<HTMLInputElement>("[name=optionDate]")].some(
          (v) => v.value === date,
        ),
      );
      b.setAttribute("aria-pressed", b.dataset.selected!);
      b.addEventListener("click", () => {
        optionEditor({ date });
        renderCalendar();
      });
      container.append(b);
    }
  }
  root.querySelector("[data-calendar-prev]")?.addEventListener("click", () => {
    calendar = new Date(calendar.getFullYear(), calendar.getMonth() - 1, 1);
    renderCalendar();
  });
  root.querySelector("[data-calendar-next]")?.addEventListener("click", () => {
    calendar = new Date(calendar.getFullYear(), calendar.getMonth() + 1, 1);
    renderCalendar();
  });
  renderCalendar();
  root
    .querySelector<HTMLFormElement>("[data-tool-editor]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!questionEditor?.validate()) return;
      void run(async () => {
        const form = event.currentTarget as HTMLFormElement; // captured before asynchronous work
        const options = [];
        for (const row of root.querySelectorAll<HTMLElement>(
          ".tool-option-edit",
        )) {
          const file =
            row.querySelector<HTMLInputElement>("[name=optionImage]")
              ?.files?.[0];
          if (file) {
            const a = await upload(file, "option");
            row.dataset.imageId = a.id;
            row.querySelector<HTMLInputElement>("[name=optionImage]")!.value =
              "";
          }
          options.push({
            id: row.dataset.optionId,
            text: field(row, "optionText").value,
            imageId: row.dataset.imageId || undefined,
            date: row.querySelector<HTMLInputElement>("[name=optionDate]")
              ?.value,
            start:
              row.querySelector<HTMLInputElement>("[name=optionstart]")?.value,
            end: row.querySelector<HTMLInputElement>("[name=optionend]")?.value,
          });
        }
        const checked = (name: string) =>
          form.querySelector<HTMLInputElement>(`[name=${name}]`)?.checked ||
          false;
        await act({
          action: "save",
          questionHtml: questionEditor.html(),
          options,
          recipientIds: [
            ...form.querySelectorAll<HTMLInputElement>(
              "[name=recipientIds]:checked",
            ),
          ].map((i) => i.value),
          settings: {
            endsAt: dateISO(field(form, "endsAt").value),
            multiple: checked("multiple"),
            anonymous: checked("anonymous"),
            allowOptions: checked("allowOptions"),
            publicQuestion: checked("publicQuestion"),
          },
        });
        // Server assigns permanent IDs to newly added options.
        optionRoot?.replaceChildren();
        state.options.forEach(optionEditor);
        const preview = root.querySelector<HTMLDialogElement>(
            "[data-tool-preview]",
          )!,
          content = preview.querySelector("[data-preview-content]")!;
        content.classList.add("portfolio-introduction-content", "rich-body-content");
        content.replaceChildren(state.questionHtml ? richBodyPreview(state.questionHtml) : safeText(state.question));
        for (const o of state.options) {
          const item = node(
            "div",
            state.kind === "schedule" ? dateLabel(o) : o.text,
          );
          item.className = "tool-preview-option";
          if (o.imageId) item.append(img(o.imageId));
          content.append(item);
        }
        content.append(
          node("p", `通知先：${state.recipientIds?.length || 0}人`),
        );
        content.append(
          node(
            "p",
            `${state.settings.anonymous ? "匿名" : "記名"} / ${state.settings.multiple ? (state.kind === "box" ? "複数投稿可" : "複数選択可") : "通常受付"} / ${state.settings.publicQuestion ? "質問はログインなしで公開" : "質問は通知先のみ"} / 終了：${state.settings.endsAt ? new Date(state.settings.endsAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "指定なし"}`,
          ),
        );
        preview.querySelector<HTMLButtonElement>(
          "[data-publish-tool]",
        )!.hidden = state.status === "published";
        preview.querySelector("[data-preview-help]")!.textContent =
          state.status === "published"
            ? "公開中の内容を更新しました。"
            : "公開すると通知先に通知が届き、回答受付が始まります。";
        preview.showModal();
        showStatus("保存しました。");
      });
    });
  root.querySelector("[data-publish-tool]")?.addEventListener(
    "click",
    () =>
      void run(async () => {
        await act({ action: "publish" });
        root.querySelector<HTMLDialogElement>("[data-tool-preview]")!.close();
        showStatus("公開しました。通知先のメンバーが回答できます。");
      }),
  );
  root.querySelector("[data-toggle-reception]")?.addEventListener(
    "click",
    () =>
      void run(async () => {
        await act({ action: "reception", closed: !state.closed });
        showStatus(
          state.closed
            ? "受付を終了しました。"
            : "受付を再開しました。終了日時が過ぎている場合は設定も変更してください。",
        );
      }),
  );
  root
    .querySelector<HTMLFormElement>("[data-tool-permissions]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      void run(async () => {
        await act({
          action: "permissions",
          staffResults: (field(form, "staffResults") as HTMLInputElement)
            .checked,
          staffIdentity: (field(form, "staffIdentity") as HTMLInputElement)
            .checked,
        });
        showStatus("権限を保存しました。");
        location.reload();
      });
    });
  const publicationForm = root.querySelector<HTMLFormElement>(
    "[data-tool-publication]",
  );
  const publicationFields = () => {
    if (!publicationForm) return;
    const show = (selector: string, visible: boolean) => {
      const el = publicationForm.querySelector<HTMLElement>(selector);
      if (el) el.hidden = !visible;
    };
    show(
      "[data-publication-members]",
      field(publicationForm, "audience").value === "selected",
    );
    show(
      "[data-publication-date]",
      field(publicationForm, "start").value === "date",
    );
    show(
      "[data-publication-posts]",
      publicationForm.querySelector<HTMLSelectElement>("[name=boxMode]")
        ?.value === "selected",
    );
  };
  publicationForm?.addEventListener("change", publicationFields);
  publicationFields();
  root
    .querySelector<HTMLFormElement>("[data-tool-publication]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      void run(async () => {
        await act({
          action: "publication",
          publication: {
            audience: field(form, "audience").value,
            memberIds: [
              ...form.querySelectorAll<HTMLInputElement>(
                "[name=memberIds]:checked",
              ),
            ].map((i) => i.value),
            start: field(form, "start").value,
            startsAt:
              field(form, "start").value === "date"
                ? dateISO(field(form, "startsAt").value)
                : "",
            endsAt: dateISO(field(form, "endsAt").value),
            paused: (field(form, "paused") as HTMLInputElement).checked,
            boxMode:
              form.querySelector<HTMLSelectElement>("[name=boxMode]")?.value ||
              "selected",
            responseIds: [
              ...form.querySelectorAll<HTMLInputElement>(
                "[name=responseIds]:checked",
              ),
            ].map((i) => i.value),
          },
        });
        showStatus("結果の公開設定を保存しました。");
        await loadResults();
      });
    });
  root
    .querySelector<HTMLFormElement>("[data-participant-option]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      void run(async () => {
        const file =
          form.querySelector<HTMLInputElement>("[name=image]")?.files?.[0];
        const a = file ? await upload(file, "option") : null;
        await act({
          action: "add-option",
          option: {
            text: field(form, "text").value,
            date: form.querySelector<HTMLInputElement>("[name=date]")?.value,
            start: form.querySelector<HTMLInputElement>("[name=start]")?.value,
            end: form.querySelector<HTMLInputElement>("[name=end]")?.value,
            imageId: a?.id,
          },
        });
        form.reset();
        showStatus("選択肢を追加しました。");
      });
    });
  function renderAnswer() {
    const container = root.querySelector<HTMLElement>("[data-tool-answer]");
    if (!container) return;
    container.replaceChildren();
    root.querySelector("[data-anonymous-notice]")!.textContent = state.settings
      .anonymous
      ? "匿名で受付中です。通常の結果には名前を表示しませんが、権限のある担当者は名前を個別に確認できます。"
      : "記名で受付中です。公開された結果には名前と回答内容が表示されます。";
    if (state.kind === "box") {
      const warning = node(
        "p",
        "回答は担当者が確認し、メンバーに公開する場合があります。",
      );
      warning.className = "tool-box-warning";
      const p = state.boxPublication;
      if (p)
        warning.append(
          document.createTextNode(
            ` 現在の公開先：${({ recipients: "通知先メンバー", all: "承認済みメンバー全員", selected: `選択した${p.selectedCount}人`, staff: "運営以上", executive: "幹部以上", admin: "管理者" } as Record<string, string>)[p.audience]}。${p.paused ? "公開停止中。" : p.mode === "all" ? "今後の投稿も自動公開されます。" : "選択された投稿のみ公開します。"}`,
          ),
        );
      container.append(warning);
      for (const own of state.own) {
        const card = node("article");
        card.className = "tool-box-response";
        const heading = node("div");
        heading.className = "tool-response-header";
        heading.append(
          node("h4", "自分の投稿"),
          node(
            "small",
            new Date(own.updatedAt).toLocaleDateString("ja-JP", {
              timeZone: "Asia/Tokyo",
            }),
          ),
        );
        card.append(heading, responseBody(own.body));
        attachments(card, own.assetIds);
        if (state.open && state.canAnswer) {
          const edit = node("button", "編集");
          edit.type = "button";
          edit.addEventListener("click", () => {
            const existing = container.querySelector("[data-box-form]");
            existing?.remove();
            boxForm(own);
          });
          const remove = node("button", "削除");
          remove.type = "button";
          remove.addEventListener(
            "click",
            () =>
              void run(async () => {
                await act({ action: "withdraw", responseId: own.id });
                showStatus("投稿を削除しました。");
                await loadResults();
              }),
          );
          const actions = node("div");
          actions.className = "tool-response-actions";
          actions.append(edit, remove);
          card.append(actions);
        }
        container.append(card);
      }
      if (
        state.canAnswer &&
        state.open &&
        (state.settings.multiple || !state.own.length)
      )
        boxForm();
      return;
    }
    const own = state.own[0],
      form = node("form");
    form.className = "tool-response-form";
    const options = node("div");
    options.className =
      state.kind === "poll" ? "tool-answer-options" : "tool-date-options";
    if (own?.needsRevision)
      form.append(
        node(
          "p",
          "回答した選択肢が削除されました。選択肢を選び直して保存してください。",
        ),
      );
    for (const o of state.options) {
      if (state.kind === "poll") {
        const label = node("label");
        label.className = "tool-answer-option";
        const input = node("input");
        input.type = state.settings.multiple ? "checkbox" : "radio";
        input.name = "choice";
        input.value = o.id;
        input.checked = own?.choices.includes(o.id) || false;
        input.disabled = !state.canAnswer || !state.open;
        label.append(input, node("span", o.text));
        if (o.imageId) label.append(img(o.imageId));
        options.append(label);
      } else {
        const row = node("div");
        row.className = "tool-date-answer";
        row.append(node("strong", dateLabel(o)));
        const select = node("select");
        select.name = o.id;
        select.disabled = !state.canAnswer || !state.open;
        select.setAttribute("aria-label", dateLabel(o));
        for (const [value, text] of [
          ["", "未回答"],
          ["yes", "○"],
          ["maybe", "△"],
          ["no", "×"],
        ]) {
          const option = node("option", text);
          option.value = value;
          option.selected = own?.dates[o.id] === value;
          select.append(option);
        }
        row.append(select);
        options.append(row);
      }
    }
    form.append(options);
    if (state.canAnswer && state.open) {
      const save = node("button", own ? "回答を変更" : "回答する");
      save.type = "submit";
      save.className = "admin-button";
      const actions = node("div");
      actions.className = "tool-response-actions";
      actions.append(save);
      form.append(actions);
      if (own) {
        const cancel = node("button", "回答を取り消す");
        cancel.type = "button";
        cancel.addEventListener(
          "click",
          () =>
            void run(async () => {
              await act({ action: "withdraw", responseId: own.id });
              showStatus("回答を取り消しました。");
              await loadResults();
            }),
        );
        actions.append(cancel);
      }
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(async () => {
        await act({
          action: "respond",
          choices: [
            ...form.querySelectorAll<HTMLInputElement>("[name=choice]:checked"),
          ].map((i) => i.value),
          dates: Object.fromEntries(
            [...form.querySelectorAll<HTMLSelectElement>("select")]
              .filter((s) => s.value)
              .map((s) => [s.name, s.value]),
          ),
        });
        showStatus("回答を保存しました。");
        await loadResults();
      });
    });
    container.append(form);
    function boxForm(own?: State["own"][number]) {
      const form = node("form");
      form.dataset.boxForm = "";
      form.className = "tool-box-form";
      let ids = [...(own?.assetIds || [])];
      const label = node("label", "回答（20,000文字以内）");
      const body = node("textarea");
      body.rows = 8;
      body.maxLength = 20000;
      body.value = own?.body || "";
      body.name = "body";
      label.append(body);
      form.append(
        label,
        node(
          "p",
          "URLを文章中に入力できます。画像・PDF・Word・Excel・PowerPoint・テキストは1件20 MB、5件まで添付できます。",
        ),
      );
      const list = node("div");
      list.className = "tool-upload-list";
      form.querySelectorAll("p").forEach((p) => (p.className = "tool-help"));
      form.append(list);
      const draw = () => {
        list.replaceChildren();
        for (const id of ids) {
          const p = node(
            "p",
            assets.find((a) => a.id === id)?.name || "添付ファイル",
          );
          const remove = node("button", "外す");
          remove.type = "button";
          remove.addEventListener("click", () => {
            ids = ids.filter((v) => v !== id);
            draw();
          });
          p.append(remove);
          list.append(p);
        }
      };
      draw();
      const files = node("input");
      files.type = "file";
      files.multiple = true;
      files.accept =
        "image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.tsv,.md";
      files.setAttribute("aria-label", "添付ファイル");
      const fileLabel = node("label", "添付ファイル（省略可）");
      fileLabel.append(files);
      form.append(fileLabel);
      const save = node("button", own ? "変更を保存" : "投稿する");
      save.type = "submit";
      save.className = "admin-button";
      const actions = node("div");
      actions.className = "tool-response-actions";
      actions.append(save);
      form.append(actions);
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void run(async () => {
          const selected = [...(files.files || [])];
          if (ids.length + selected.length > 5)
            throw new Error("添付ファイルは5件までです。");
          for (const file of selected) {
            const a = await upload(file, "response");
            ids.push(a.id);
          }
          files.value = "";
          await act({
            action: "respond",
            responseId: own?.id,
            body: body.value,
            assetIds: ids,
          });
          showStatus("投稿を保存しました。");
          await loadResults();
        });
      });
      container!.append(form);
    }
  }
  function identity(parent: HTMLElement, r: ToolResults["responses"][number]) {
    parent.append(document.createTextNode(r.name));
    if (!r.anonymous || !state.canReveal) return;
    const b = node("button", "◉ 名前を確認");
    b.type = "button";
    b.className = "tool-identity";
    b.setAttribute("aria-label", "匿名回答の名前を確認");
    let shown = false;
    const label = node("span");
    b.addEventListener(
      "click",
      () =>
        void run(async () => {
          if (shown) {
            label.textContent = "";
            shown = false;
            b.textContent = "◉ 名前を確認";
            return;
          }
          const result = await api(`${base}/identity`, { responseId: r.id });
          label.textContent = ` ${result.name} `;
          shown = true;
          b.textContent = "◉ 名前を隠す";
        }),
    );
    parent.append(label, b);
  }
  async function loadResults(force = false) {
    const container = root.querySelector<HTMLElement>("[data-tool-results]")!,
      message = root.querySelector("[data-results-message]")!;
    // Always discard old identities and results before a new authorization check.
    container.replaceChildren();
    loadedResults = null;
    root.querySelector<HTMLButtonElement>("[data-export-results]")!.hidden =
      true;
    if (!state.canSeeResults && !force) {
      message.textContent = "結果は現在公開されていません。";
      return;
    }
    try {
      const data = await api(`${base}/results`);
      const results = data.results as ToolResults;
      loadedResults = results;
      assets = [
        ...assets.filter(
          (a) => !data.assets.some((b: ExportAsset) => a.id === b.id),
        ),
        ...data.assets,
      ];
      message.textContent = `回答者 ${results.respondentCount}人 / 通知先 ${results.recipientCount}人`;
      root.querySelector<HTMLButtonElement>("[data-export-results]")!.hidden =
        false;
      if (results.kind === "poll")
        for (const o of results.options) {
          const votes = results.responses.filter((r) =>
              r.choices.includes(o.id),
            ),
            card = node("article");
          card.className = "tool-poll-result";
          card.append(node("h4", o.text));
          if (o.imageId) card.append(img(o.imageId));
          const percent = results.respondentCount
            ? Math.round((votes.length / results.respondentCount) * 100)
            : 0;
          const count = node("p", `${votes.length}票（${percent}%）`);
          count.className = "tool-poll-count";
          card.append(count);
          const meter = node("div");
          meter.className = "tool-result-meter";
          const bar = node("span");
          bar.style.width = `${percent}%`;
          meter.append(bar);
          card.append(meter);
          const list = node("ul");
          for (const r of votes) {
            const li = node("li");
            identity(li, r);
            list.append(li);
          }
          const voters = node("details");
          voters.className = "tool-result-voters";
          voters.append(
            node("summary", `回答者を見る（${votes.length}人）`),
            list,
          );
          card.append(voters);
          container.append(card);
        }
      else if (results.kind === "schedule") {
        const wrap = node("div");
        wrap.className = "tool-results-scroll";
        const table = node("table"),
          head = node("thead"),
          hr = node("tr");
        hr.append(node("th", "回答者"));
        for (const o of results.options) hr.append(node("th", dateLabel(o)));
        head.append(hr);
        table.append(head);
        const body = node("tbody");
        const count = node("tr");
        count.append(node("th", "○ / △ / × / 未回答"));
        for (const o of results.options)
          count.append(
            node(
              "td",
              ["yes", "maybe", "no", ""]
                .map(
                  (v) =>
                    results.responses.filter((r) => (r.dates[o.id] || "") === v)
                      .length,
                )
                .join(" / "),
            ),
          );
        body.append(count);
        for (const r of results.responses) {
          const tr = node("tr"),
            name = node("td");
          identity(name, r);
          tr.append(name);
          for (const o of results.options)
            tr.append(
              node(
                "td",
                ({ yes: "○", maybe: "△", no: "×" } as Record<string, string>)[
                  r.dates[o.id]
                ] || "未回答",
              ),
            );
          body.append(tr);
        }
        table.append(body);
        wrap.append(table);
        const hint = node(
          "p",
          "表は横にスクロールできます。○・△・×と未回答を分けて表示しています。",
        );
        hint.className = "tool-help";
        container.append(hint, wrap);
      } else {
        const selectAll = node("button", "画像出力の全投稿を選択 / 解除");
        selectAll.type = "button";
        selectAll.addEventListener("click", () => {
          const checks = [
            ...container.querySelectorAll<HTMLInputElement>(
              "[data-export-response]",
            ),
          ];
          const checked = !checks.every((c) => c.checked);
          checks.forEach((c) => (c.checked = checked));
        });
        const selection = node("div");
        selection.className = "tool-export-selection";
        selection.append(selectAll);
        container.append(selection);
        for (const r of results.responses) {
          const card = node("article");
          card.className = "tool-box-response";
          const label = node("label");
          label.className = "tool-check";
          const check = node("input");
          check.type = "checkbox";
          check.checked = true;
          check.dataset.exportResponse = r.id;
          label.append(check, document.createTextNode("画像に含める"));
          const heading = node("div");
          heading.className = "tool-response-header";
          const name = node("p");
          identity(name, r);
          heading.append(name, label);
          card.append(heading, responseBody(r.body));
          attachments(card, r.assetIds);
          container.append(card);
        }
        const publish = root.querySelector("[data-publish-responses]");
        if (publish) {
          publish.replaceChildren();
          for (const r of results.responses) {
            const label = node("label");
            label.className = "tool-check";
            const check = node("input");
            check.type = "checkbox";
            check.name = "responseIds";
            check.value = r.id;
            check.checked =
              state.publication?.responseIds.includes(r.id) || false;
            label.append(
              check,
              document.createTextNode(
                `${r.name}：${r.body.slice(0, 100) || "添付ファイル"}`,
              ),
            );
            publish.append(label);
          }
        }
      }
      if (!results.responses.length)
        container.append(
          node(
            "p",
            results.kind === "box"
              ? "公開中の投稿はありません。"
              : "まだ回答がありません。",
          ),
        );
    } catch (e) {
      message.textContent = (e as Error).message;
    }
  }
  root
    .querySelector("[data-load-results]")
    ?.addEventListener("click", () => void run(() => loadResults(true)));
  root.querySelector("[data-export-results]")?.addEventListener(
    "click",
    () =>
      void run(async () => {
        if (!loadedResults) return;
        const ids = [
          ...root.querySelectorAll<HTMLInputElement>(
            "[data-export-response]:checked",
          ),
        ].map((i) => i.dataset.exportResponse!);
        if (state.kind === "box" && !ids.length)
          throw new Error("画像に含める投稿を選択してください。");
        // Re-fetch permissions and sanitized data; revealed labels are never used.
        const data = await api(`${base}/results`);
        const results = data.results as ToolResults;
        if (state.kind === "box")
          results.responses = results.responses.filter((r) =>
            ids.includes(r.id),
          );
        await exportToolResults(
          root.querySelector<HTMLDialogElement>("[data-tool-export]")!,
          results,
          data.assets,
        );
      }),
  );
  sync();
  if (state.canSeeResults) void loadResults();
  else
    root.querySelector("[data-results-message]")!.textContent =
      "結果は現在公開されていません。";
}
