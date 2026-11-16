import {warningMark} from '../lib/advisoryWarnings.ts';
import {submissionWarningAt,exhibitionSubmissionWarnings,type SubmissionWarning} from '../lib/exhibitionSubmissionWarnings.ts';
import { photoExifEditor, bindPhotoExifEditor } from "./photoExifEditor";
import {titleBoardFieldsHtml,bindTitleBoardFields} from './exhibitionTitleBoardFields.ts';
import {
  editableSubmission,
  submissionEditChanges,
} from "../lib/exhibitionSubmissionEdits.ts";
import { exhibitionGradeOptionsHtml } from "../lib/exhibitionGrades.ts";
import {
  emptyWorkDetails,
  metadataStrings,
  prefectures,
} from "../lib/exhibitionText.ts";
import {
  workKindLabels,
  type FormSchema,
  type SubmissionContent,
  type Work,
  type PhotoLayout,
} from "../lib/exhibitionTypes.ts";
import { paperSizes, paperSizeId } from "../lib/exhibitionEditing.ts";
import {
} from "../lib/exhibitionSubmissionLimits.ts";
import { seriesReviewHtml } from "../lib/exhibitionSeriesReview.ts";
import { bindSeriesReviews } from "./exhibitionSeriesReview.ts";
import { createSeriesDialog as createSeriesEditor } from "./exhibitionSeriesDialog.ts";
import {
  bindTextValidation,
  ensureTextMeasurement,
  validateTextFields,
  metadataLineHint,
  resizeMetadataInputs,
} from "./exhibitionTextValidation.ts";
import { readExhibitionResponse } from "./exhibitionResponse.ts";
type Any = Record<string, any>;
const fieldApplies = (
  f: FormSchema["fields"][number],
  scope: string,
  sectionId?: string,
  kind?: Work["kind"],
) =>
  f.scope === scope &&
  (!f.sectionId || f.sectionId === sectionId) &&
  (!f.kinds?.length || (!!kind && f.kinds.includes(kind)));
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const pencil =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 21V3h10.925l-2 2H5v14h14v-6.95l2-2V21zm6-6v-4.25L19.625.125L23.8 4.4L13.25 15zM21.025 4.4l-1.4-1.4zM11 13h1.4l5.8-5.8l-.7-.7l-.725-.7L11 11.575zm6.5-6.5l-.725-.7zl.7.7z"/></svg>';
const input = (attributes: string, value: unknown, type = "text") =>
  `<input type="${type}" ${attributes} value="${escape(value)}"/>`;
export function createSubmissionEditor(options: {
  exhibitionId: string;
  data: () => Any;
  changed: (dirty: boolean) => void;
  save: (submission: Any, content: SubmissionContent) => Promise<boolean>;
  extra: (submission: Any, tab: string) => string;
  bindExtra: (scope: HTMLElement) => void;
}) {
  let session:
    | {
        submission: Any;
        original: SubmissionContent;
        content: SubmissionContent;
        schema: FormSchema;
      }
    | undefined;
  let container: HTMLElement | undefined,
    tab = "content",
    sectionId = "",
    workId = "",
    mode = "",
    confirming = false,
    busy = false;
  let releaseReview: (() => void) | undefined;
  const assetUrl = (id: string) =>
    `/api/exhibitions/${options.exhibitionId}/assets/${encodeURIComponent(id)}?preview=1&thumbnail=1`;
  const asset = (id: string) =>
    (options.data().assets ?? []).find((a: Any) => a.id === id);
  const changes = () =>
    session
      ? submissionEditChanges(
          session.original,
          session.content,
          session.schema,
          (id) => asset(id)?.name ?? "添付画像",
        )
      : [];
  const work = () => session?.content.works.find((w) => w.id === workId);
  const warnings=()=>session?exhibitionSubmissionWarnings(options.data().exhibition,session.content,submissionWarningAt(session.submission)):[];
  const warningBadge=(items:SubmissionWarning[])=>items.length?warningMark(`警告${items.length}件`):'';
  const warningPanel=()=>{const items=warnings().filter(w=>w.tab===tab);return items.length?`<aside class="submission-warning-summary"><h3>${warningMark('提出内容の警告')} 警告（保存・提出できます）</h3><ul class="advisory-warning-list">${items.map(w=>`<li>${w.tab==='content'&&!confirming?`<button type="button" data-se-warning-target="${w.workId??'counts'}" data-warning-section="${w.sectionId??''}">${escape(w.message)} 該当箇所を表示</button>`:escape(w.message)}</li>`).join('')}</ul></aside>`:'';};
  function refreshWarnings(){
    if(!container||!session)return;const items=warnings();
    container.querySelectorAll<HTMLElement>('[data-se-warning-tab]').forEach(el=>el.innerHTML=warningBadge(items.filter(w=>w.tab===el.dataset.seWarningTab)));
    container.querySelectorAll<HTMLElement>('[data-se-warning-section]').forEach(el=>el.innerHTML=warningBadge(items.filter(w=>w.sectionId===el.dataset.seWarningSection)));
    container.querySelectorAll<HTMLElement>('[data-se-warning-work]').forEach(el=>el.innerHTML=warningBadge(items.filter(w=>w.workId===el.dataset.seWarningWork)));
    const panel=container.querySelector<HTMLElement>('[data-se-warnings]');if(panel){panel.innerHTML=warningPanel();panel.querySelectorAll<HTMLButtonElement>('[data-se-warning-target]').forEach(button=>button.addEventListener('click',()=>{tab='content';sectionId=button.dataset.warningSection||sectionId;const target=button.dataset.seWarningTarget!;if(target==='counts')mode='counts';else{mode='layout';workId=target;}render(false);const anchor=container?.querySelector<HTMLElement>('[data-warning-anchor]'),body=container?.querySelector<HTMLElement>('.se-body');if(anchor&&body){body.scrollTop+=anchor.getBoundingClientRect().top-body.getBoundingClientRect().top-12;anchor.focus({preventScroll:true});}}));}
  }

  const notice = (text: string, error = false) => {
    const el = container?.querySelector<HTMLElement>("[data-se-message]");
    if (el) {
      el.textContent = text;
      el.classList.toggle("error", error);
      el.focus({ preventScroll: true });
    }
  };
  const changed = () => {
    refreshWarnings();
    const count = changes().length;
    options.changed(count > 0);
    const label = container?.querySelector("[data-se-dirty]");
    if (label)
      label.textContent = count ? `未保存 ${count}項目` : "保存済みの提出内容";
    const next = container?.querySelector<HTMLButtonElement>("[data-se-next]");
    if (next) next.disabled = !count || busy;
  };
  const row = (
    label: string,
    value: unknown,
    control: string,
    wide = false,
  ) => {
    const tag = control.includes('<div class="se-metadata">') || control.includes('<span class="se-checkboxes">') ? "div" : "label";
    return `<div class="se-field${wide ? " se-field-wide" : ""}"><span class="se-label">${escape(label)}</span><div class="se-value"><button type="button" class="se-edit-value" data-se-edit aria-label="${escape(label)}を修正"><span${label === "その他ご意見、ご要望など" ? " data-submission-notes-detail" : ""}>${escape(Array.isArray(value) ? value.join("、") : value || "未入力")}</span>${pencil}</button><${tag} class="se-input" hidden><span class="se-sr">${escape(label)}</span>${control}</${tag}></div></div>`;
  };
  const custom = (
    scope: "common" | "section" | "work",
    values: Any,
    id = "",
    kind?: Work["kind"],
  ) =>
    session!.schema.fields
      .filter((f) =>
        fieldApplies(f, scope, scope === "work" ? work()?.sectionId : id, kind),
      )
      .map((f) => {
        const attrs = `data-se-field="${f.id}" data-se-scope="${scope}" data-se-owner="${id}"`,
          value = values[f.id];
        const control =
          f.type === "paragraph"
            ? `<textarea ${attrs} rows="4">${escape(value)}</textarea>`
            : f.type === "select"
              ? `<select ${attrs}><option value="">選択してください</option>${f.options.map((v) => `<option value="${escape(v)}" ${v === value ? "selected" : ""}>${escape(v)}</option>`).join("")}</select>`
              : f.type === "checkbox"
                ? `<span class="se-checkboxes">${f.options.map((v) => `<label><input type="checkbox" ${attrs} value="${escape(v)}" ${Array.isArray(value) && value.includes(v) ? "checked" : ""}/>${escape(v)}</label>`).join("")}</span>`
                : input(
                    attrs,
                    value,
                    f.type === "number" || f.type === "date" ? f.type : "text",
                  );
        return row(
          `${f.label}${f.required ? "（必須）" : ""}`,
          value,
          `${f.description ? `<small>${escape(f.description)}</small>` : ""}${control}`,
        );
      })
      .join("");
  const metadata = (w: Work) => {
    const groups = [
      ["撮影場所", "location", ["place", "prefecture", "region"]],
      ["使用機材", "equipment", ["camera", "lens", "film"]],
      ["撮影設定", "settings", ["shutterSpeed", "iso", "fNumber"]],
    ] as const;
    const labels: Any = {
      place: "地名",
      prefecture: "都道府県",
      region: "国・地域（海外・その他）",
      camera: "カメラ",
      lens: "レンズ",
      film: "フィルム（任意）",
      shutterSpeed: "シャッタースピード",
      iso: "ISO感度",
      fNumber: "F値",
    };
    return groups
      .map(([label, key, parts]) =>
        row(
          label,
          w[key],
          w.details
            ? `<div class="se-metadata">${parts.map((part) => `<label>${labels[part]}${part === "prefecture" ? `<select data-work-id="${w.id}" data-work-detail="${part}"><option value="">選択してください</option>${[...prefectures, "海外・その他"].map((v) => `<option ${v === w.details![part] ? "selected" : ""}>${escape(v)}</option>`).join("")}</select>` : `<textarea rows="1" data-metadata-input data-work-id="${w.id}" data-work-detail="${part}">${escape(w.details![part])}</textarea>`}</label>`).join("")}</div>`
            : `<textarea rows="1" data-metadata-input data-work-id="${w.id}" data-work-key="${key}">${escape(w[key])}</textarea>`,
        ),
      )
      .join("")+metadataLineHint(w.id);
  };
  const photoRows = (w: Work, editing = false) =>
    w.photos
      .map((p, i) => {
        const a = asset(p.assetId),
          bytes = a?.bytes,
          size = bytes
            ? bytes < 1048576
              ? `${Math.ceil(bytes / 1024)} KB`
              : `${(bytes / 1048576).toFixed(1)} MB`
            : "";
        return `<div class="se-photo-row"><span>${String(i + 1).padStart(2, "0")}</span><span>${escape(a?.name ?? "ファイル未選択")}${size ? ` · ${size}` : ""}</span><label class="se-file">${p.assetId ? "画像を差し替え" : "画像を選択"}<input type="file" accept="image/jpeg,image/png" data-se-upload="${i}" aria-label="写真 ${i + 1}を差し替え"/></label>${w.kind === "series" ? `<button type="button" class="se-link" data-se-remove-photo="${i}" aria-label="写真 ${i + 1}を削除">削除</button>` : ""}</div>${
          editing && w.kind !== "book"
            ? `<div class="se-photo-size"><label>写真サイズ<select data-se-paper="${i}"><option value="custom">自由入力</option>${paperSizes.map((size) => `<option value="${size.id}" ${paperSizeId(p) === size.id ? "selected" : ""}>${"label" in size ? size.label : size.id}</option>`).join("")}</select></label><label>向き<select data-se-orientation="${i}"><option value="portrait" ${p.width <= p.height ? "selected" : ""}>縦</option><option value="landscape" ${p.width > p.height ? "selected" : ""}>横</option></select></label>${[
                ["width", "幅 mm"],
                ["height", "高さ mm"],
                ["x", "X mm"],
                ["y", "Y mm"],
                ["rotation", "回転 °"],
              ]
                .map(
                  ([key, label]) =>
                    `<label>${label}${input(`data-se-photo="${i}" data-se-photo-key="${key}" step="0.1"`, p[key as keyof PhotoLayout], "number")}</label>`,
                )
                .join("")}</div>`
            : ""
        }${photoExifEditor(w, p, i, a?.photoMetadata)}`;
      })
      .join("");
  const newPhoto = (i = 0): PhotoLayout => ({
    assetId: "",
    x: i * 220,
    y: 0,
    width: 210,
    height: 297,
    rotation: 0,
  });
  const counts = () =>
    `<section class="se-counts" data-warning-anchor tabindex="-1"><h3>展示と作品数を修正</h3><p>作品数を減らすと、各種別の末尾の作品を削除します。変更は保存前に確認できます。</p>${session!.schema.sections
      .map((s) => {
        const a = session!.content.sections.find((a) => a.sectionId === s.id);
        return `<fieldset><legend><label><input type="checkbox" data-se-section="${s.id}" ${a ? "checked" : ""}/> ${escape(s.title)}</label></legend>${
          a
            ? `<div class="se-count-inputs">${[
                ["singles", "単写真"],
                ["series", "組写真"],
                ["books", "ブック"],
              ]
                .map(
                  ([key, label]) =>
                    `<label>${label}${input(`data-se-count="${key}" data-se-section-id="${s.id}" min="0" max="${key === "singles" ? 300 : 100}" step="1"`, a[key as keyof typeof a], "number")}</label>`,
                )
                .join("")}</div>`
            : ""
        }</fieldset>`;
      })
      .join(
        "",
      )}<button type="button" class="se-outline" data-se-mode="">提出内容に戻る</button></section>`;
  const contentHtml = () => {
    const { content: c, schema } = session!,
      section = c.sections.find((s) => s.sectionId === sectionId);
    if (!section) {
      sectionId = c.sections[0]?.sectionId ?? "";
    }
    const selected = c.sections.find((s) => s.sectionId === sectionId),
      choices = c.works.filter((w) => w.sectionId === sectionId);
    if (!choices.some((w) => w.id === workId)) workId = choices[0]?.id ?? "";
    const w = work();
    return `<div class="se-columns"><div><section><h3>出展者情報</h3>${[
      ["name", "名前"],
      ["grade", "学年"],
      ["authorName", "作者名"],
      ["portfolioUrl", "外部Portfolio URL"],
    ]
      .map(([key, label]) =>
        row(
          label,
          c[key as keyof SubmissionContent],
          key === "grade"
            ? `<select data-common="grade">${exhibitionGradeOptionsHtml(c.grade)}</select>`
            : input(
                `data-common="${key}"`,
                c[key as keyof SubmissionContent],
                key === "portfolioUrl" ? "url" : "text",
              ),
        ),
      )
      .join(
        "",
      )}${custom("common", c.fields)}</section><section><h3>展示と作品</h3><div class="se-sections">${c.sections.map((a) => `<button type="button" data-se-select-section="${a.sectionId}" aria-pressed="${a.sectionId === sectionId}">${escape(schema.sections.find((s) => s.id === a.sectionId)?.title)}（${a.singles + a.series + a.books}作品）<span data-se-warning-section="${a.sectionId}"></span></button>`).join("")}</div><div class="se-count-summary"><small>${selected ? `単写真 ${selected.singles}作品 ／ 組写真 ${selected.series}作品 ／ ブック ${selected.books}冊` : "参加する展示を選択してください"}</small><button type="button" class="se-link" data-se-mode="counts">枚数を修正</button></div>${selected ? custom("section", selected.fields, selected.sectionId) : ""}<label class="se-work-choice"><span class="se-sr">編集する作品</span><select data-se-work>${choices.map((w, i) => `<option value="${w.id}" ${w.id === workId ? "selected" : ""}>${workKindLabels[w.kind]} ${i + 1} — ${escape(w.title || "無題")}</option>`).join("")}</select></label>${w ? row("作品タイトル", w.title, input(`data-work-id="${w.id}" data-work-key="title"`, w.title)) + titleBoardFieldsHtml(w) + metadata(w) + custom("work", w.fields, w.id, w.kind) : "<p>作品はありません。「枚数を修正」から追加できます。</p>"}</section></div><div>${
      w
        ? `<section><h3>キャプション</h3>${row("キャプション", w.caption, `<textarea data-work-id="${w.id}" data-work-key="caption" rows="5">${escape(w.caption)}</textarea>`, true)}</section><section><h3>作品画像と配置<span data-se-warning-work="${w.id}"></span></h3>${
            w.kind === "series" && w.photos.some((p) => p.assetId)
              ? seriesReviewHtml(
                  w,
                  session!.submission.id,
                  "submitted",
                  assetUrl,
                )
              : `<div class="se-single-images">${w.photos
                  .filter((p) => p.assetId)
                  .map(
                    (p) => `<img src="${assetUrl(p.assetId)}" alt="作品画像"/>`,
                  )
                  .join("")}</div>`
          }${photoRows(w)}<div class="se-photo-actions">${w.kind === "series" || (w.kind === "book" && !w.photos.length) ? '<button type="button" class="se-link" data-se-add-photo>＋ 写真を追加</button>' : ""}${w.kind === "series" ? series.html(w, "配置・サイズを修正") : w.kind !== "book" ? '<button type="button" class="se-outline" data-se-mode="layout">配置・サイズを修正</button>' : "<small>ブックの画像は任意です。</small>"}</div></section>`
        : ""
    }<section><h3>その他ご意見、ご要望など</h3>${row("その他ご意見、ご要望など", c.notes, `<textarea data-common="notes" rows="5" maxlength="10000">${escape(c.notes)}</textarea><small>10,000文字まで</small>`, true)}</section></div></div>`;
  };
  const series = createSeriesEditor({
    getWork: (id) => session?.content.works.find((w) => w.id === id),
    assetUrl,
    change: () => {
      syncCounts();
      changed();
    },
    closed: () => render(),
    message: notice,
    busy: () => busy,
    width: () =>
      container?.querySelector<HTMLElement>(".se-body")?.clientWidth ?? 700,
  });
  const layout = () => {
    const w = work();
    return w
      ? `<section class="se-layout" data-warning-anchor tabindex="-1"><div class="se-subheading"><h3>${escape(w.title || "作品")}の配置・サイズ</h3><button type="button" class="se-outline" data-se-mode="">提出内容に戻る</button></div>${w.kind === "series" ? series.html(w) : ""}${photoRows(w, true)}${w.kind === "series" ? '<button type="button" class="se-link" data-se-add-photo>＋ 写真を追加</button>' : ""}</section>`
      : "";
  };
  const confirmation = () =>
    `<div class="se-columns se-confirm"><section><h3>提出内容の修正</h3><dl><dt>名前</dt><dd>${escape(session!.content.name)}</dd><dt>写真展</dt><dd>${escape(options.data().exhibition.title)}</dd><dt>提出版</dt><dd>第${session!.submission.versions.at(-1).version}版 → 第${session!.submission.versions.at(-1).version + 1}版</dd></dl><p>修正した項目を確認してください。元の提出内容は履歴に残ります。</p>${session!.submission.hasUnsubmittedChanges ? "<p>出展者が保存中の未提出の下書きは保持します。</p>" : ""}</section><section><h3>変更内容</h3><ol class="se-changes">${changes()
      .map(
        (c) =>
          `<li><h4>${escape(c.label)}</h4><div class="se-before"><small>変更前</small><p>${escape(c.before)}</p></div><div class="se-after"><small>変更後</small><p>${escape(c.after)}</p></div></li>`,
      )
      .join("")}</ol></section></div>`;
  const html = (submission: Any) => {
    if (!session || session.submission.id !== submission.id) {
      session = {
        submission: structuredClone(submission),
        original: editableSubmission(submission.content),
        content: editableSubmission(submission.content),
        schema: options
          .data()
          .exhibition.schemas.find(
            (s: FormSchema) => s.version === submission.schemaVersion,
          ),
      };
      sectionId = session.content.sections[0]?.sectionId ?? "";
      workId = "";
      tab = "content";
      mode = "";
      confirming = false;
    }
    return `<div class="submission-editor" data-staff-editor="${submission.id}">${shell()}</div>`;
  };
  function shell() {
    const s = session!.submission;
    return `<header class="se-header"><div class="se-heading-row"><h2>${confirming ? "Confirm" : "Submission"}</h2><div class="se-heading-meta"><p>${escape(session!.content.name)}さんの提出内容</p><span class="se-version">提出済み · 第${s.versions.at(-1).version}版</span></div></div></header><p class="se-guide">${confirming ? "変更前後を確認して保存してください。" : "鉛筆マークのある項目をクリックして修正できます。"}</p>${
      !confirming
        ? `<nav class="se-tabs" aria-label="提出詳細の表示">${[
            ["content", "提出内容"],
            ["qr", "QR・タイトルボード"],
            ["history", "提出・連携履歴"],
          ]
            .map(
              ([key, label]) =>
                `<button type="button" data-se-tab="${key}" aria-pressed="${tab === key}">${label}<span data-se-warning-tab="${key}"></span></button>`,
            )
            .join("")}</nav>`
        : ""
    }<p class="se-message" data-se-message role="status" tabindex="-1"></p><div class="se-body"><div data-se-warnings></div>${confirming ? confirmation() : tab !== "content" ? options.extra(s, tab) : mode === "counts" ? counts() : mode === "layout" ? layout() : contentHtml()}</div><div class="se-footer"><div><small data-se-dirty></small><span>変更は、新しい提出版として記録されます。</span></div><div>${confirming ? '<button type="button" class="se-link" data-se-back>戻って修正</button><button type="button" class="se-outline" data-se-save>修正を保存</button>' : '<button type="button" class="se-link" data-se-close>閉じる</button><button type="button" class="se-outline" data-se-next>変更内容を確認</button>'}</div></div>`;
  }
  function render(preserveScroll = true) {
    if (!container) return;
    const previousBody = container.querySelector<HTMLElement>(".se-body");
    const top = preserveScroll ? previousBody?.scrollTop ?? 0 : 0;
    const left = preserveScroll ? previousBody?.scrollLeft ?? 0 : 0;
    releaseReview?.();
    container.innerHTML = shell();
    bind(container.parentElement!);
    const body = container.querySelector<HTMLElement>(".se-body");
    if (body) {
      body.scrollTop = top;
      body.scrollLeft = left;
    }
  }
  function syncCounts() {
    for (const a of session!.content.sections) {
      const seriesWorks = session!.content.works.filter(
        (w) => w.sectionId === a.sectionId && w.kind === "series",
      );
      a.seriesPhotoCounts = seriesWorks.map((w) => w.photos.length);
    }
  }
  function bind(scope: HTMLElement) {
    const found = scope.matches("[data-staff-editor]")
      ? scope
      : scope.querySelector<HTMLElement>("[data-staff-editor]");
    if (!found || !session) return;
    container = found;
    releaseReview?.();
    releaseReview = bindSeriesReviews(
      container,
      (el) =>
        (el.dataset.seriesContent === "draft"
          ? session?.submission.draft
          : tab === "content"
            ? session?.content
            : session?.original
        )?.works.find((w: Work) => w.id === el.dataset.seriesWorkId),
      assetUrl,
    );
    series.bind(container);
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-close]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          if (!busy)
            container!
              .closest("dialog")
              ?.querySelector<HTMLButtonElement>(
                "[data-submission-detail-close]",
              )
              ?.click();
        }),
      );
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-edit]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          b.hidden = true;
          const control =
            b.parentElement!.querySelector<HTMLElement>(".se-input")!;
          control.hidden = false;
          resizeMetadataInputs(control);
          control
            .querySelector<HTMLElement>("input,textarea,select")
            ?.focus({ preventScroll: true });
        }),
      );
    container
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input,textarea,select")
      .forEach((el) => {
        const boundSession = session;
        const boundWork = el.dataset.workId
          ? session!.content.works.find((w) => w.id === el.dataset.workId)
          : el.dataset.seScope === "work"
            ? session!.content.works.find((w) => w.id === el.dataset.seOwner)
            : work();
        const update = () => {
          if (busy || session !== boundSession || !container?.contains(el))
            return;
          if (el.dataset.common)
            (session!.content as Any)[el.dataset.common] = el.value;
          const w = boundWork;
          if (w && el.dataset.workKey) {
            (w as Any)[el.dataset.workKey] = el.value;
            const chooser = container?.querySelector<HTMLOptionElement>(
              `[data-se-work] option[value="${w.id}"]`,
            );
            if (chooser)
              chooser.textContent = `${workKindLabels[w.kind]} — ${w.title || "無題"}`;
          }
          if (w && el.dataset.workDetail) {
            w.details ??= emptyWorkDetails();
            (w.details as Any)[el.dataset.workDetail] = el.value;
            Object.assign(w, metadataStrings(w.details));
          }
          if (el.dataset.seField) {
            const values =
              el.dataset.seScope === "common"
                ? session!.content.fields
                : el.dataset.seScope === "section"
                  ? session!.content.sections.find(
                      (s) => s.sectionId === el.dataset.seOwner,
                    )?.fields
                  : w?.fields;
            if (values)
              values[el.dataset.seField] =
                el instanceof HTMLInputElement && el.type === "checkbox"
                  ? [
                      ...container!.querySelectorAll<HTMLInputElement>(
                        `[data-se-field="${el.dataset.seField}"][data-se-owner="${el.dataset.seOwner}"]:checked`,
                      ),
                    ].map((e) => e.value)
                  : el instanceof HTMLInputElement &&
                      el.type === "number" &&
                      el.value !== ""
                    ? Number(el.value)
                    : el.value;
          }
          if (w && el.dataset.sePhoto !== undefined)
            (w.photos[Number(el.dataset.sePhoto)] as Any)[
              el.dataset.sePhotoKey!
            ] = Number(el.value);
          changed();
        };
        el.addEventListener("input", update);
        el.addEventListener("change", update);
      });
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-tab]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.seTab!;
          mode = "";
          render(false);
        }),
      );
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-mode]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          mode = b.dataset.seMode!;
          render(false);
        }),
      );
    container
      .querySelector<HTMLSelectElement>("[data-se-work]")
      ?.addEventListener("change", (e) => {
        workId = (e.target as HTMLSelectElement).value;
        render(false);
      });
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-select-section]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          sectionId = b.dataset.seSelectSection!;
          render(false);
        }),
      );
    container
      .querySelectorAll<HTMLInputElement>("[data-se-section]")
      .forEach((el) =>
        el.addEventListener("change", () => {
          if (el.checked)
            session!.content.sections.push({
              sectionId: el.dataset.seSection!,
              singles: 0,
              series: 0,
              books: 0,
              seriesPhotoCounts: [],
              fields: {},
            });
          else {
            session!.content.sections = session!.content.sections.filter(
              (s) => s.sectionId !== el.dataset.seSection,
            );
            session!.content.works = session!.content.works.filter(
              (w) => w.sectionId !== el.dataset.seSection,
            );
          }
          changed();
          render();
        }),
      );
    container
      .querySelectorAll<HTMLInputElement>("[data-se-count]")
      .forEach((el) =>
        el.addEventListener("change", () => {
          const a = session!.content.sections.find(
              (s) => s.sectionId === el.dataset.seSectionId,
            )!,
            key = el.dataset.seCount!,
            kind = (
              { singles: "single", series: "series", books: "book" } as Any
            )[key] as Work["kind"];
          const count = Number(el.value);
          if (
            !Number.isInteger(count) ||
            count < 0 ||
            count > (kind === "single" ? 300 : 100)
          ) {
            notice("作品数を範囲内の整数で入力してください。", true);
            return;
          }
          (a as Any)[key] = count;
          const current = session!.content.works.filter(
            (w) => w.sectionId === a.sectionId && w.kind === kind,
          );
          const desired = Array.from(
            { length: count },
            (_, i) =>
              current[i] ??
              ({
                id: crypto.randomUUID(),
                sectionId: a.sectionId,
                kind,
                title: "",
                titleBoard: { quoted:false,rubyEnabled:false,ruby:[] },
                caption: "",
                location: "",
                equipment: "",
                settings: "",
                fields: {},
                details: emptyWorkDetails(),
                photos: kind === "book" ? [] : [newPhoto()],
              } as Work),
          );
          const removed = new Set(current.slice(count).map((w) => w.id));
          session!.content.works = session!.content.works.filter(
            (w) => !removed.has(w.id),
          );
          session!.content.works.push(
            ...desired.filter((w) => !current.includes(w)),
          );
          syncCounts();
          changed();
          render();
        }),
      );
    container
      .querySelectorAll<HTMLInputElement>("[data-se-upload]")
      .forEach((el) =>
        el.addEventListener("change", async () => {
          const file = el.files?.[0],
            w = work(),
            index = Number(el.dataset.seUpload);
          if (!file || !w || busy) return;
          if (file.size > 20 * 1024 * 1024 || !file.size) {
            notice("空でない20MB以下のJPEG・PNGを選んでください。", true);
            return;
          }
          let uploaded = false;
          busy = true;
          freeze(true);
          notice("画像を保存しています…");
          try {
            const form = new FormData(),
              s = session!.submission;
            form.set("submissionId", s.id);
            form.set("revision", String(s.revision));
            form.set(
              "exhibitionRevision",
              String(options.data().exhibition.revision),
            );
            form.set("assetId", crypto.randomUUID());
            form.set("file", file);
            const response = await fetch(
                `/api/member/exhibitions/${options.exhibitionId}/upload`,
                { method: "POST", body: form },
              ),
              result = await readExhibitionResponse(response);
            if (!response.ok || !result.ok)
              throw new Error(result.message ?? "写真を保存できませんでした。");
            const a = (result as Any).asset;
            options.data().assets.push(a);
            w.photos[index].assetId = a.id;
            uploaded = true;
            changed();
          } catch (e) {
            notice(
              e instanceof Error ? e.message : "写真を保存できませんでした。",
              true,
            );
          } finally {
            busy = false;
            freeze(false);
            if (uploaded) render();
          }
        }),
      );
    container
      .querySelector<HTMLButtonElement>("[data-se-add-photo]")
      ?.addEventListener("click", () => {
        const w = work();
        if (!w) return;
        if (w.photos.length >= 100) {
          notice("1作品の写真は100枚までです。", true);
          return;
        }
        w.photos.push(newPhoto(w.photos.length));
        series.reset(w.id);
        syncCounts();
        changed();
        render();
      });
    container
      .querySelectorAll<HTMLButtonElement>("[data-se-remove-photo]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          const w = work();
          if (!w) return;
          w.photos.splice(Number(b.dataset.seRemovePhoto), 1);
          series.reset(w.id);
          syncCounts();
          changed();
          render();
        }),
      );
    container
      .querySelectorAll<HTMLSelectElement>(
        "[data-se-paper], [data-se-orientation]",
      )
      .forEach((el) =>
        el.addEventListener("change", () => {
          const w = work();
          if (!w) return;
          const index = Number(el.dataset.sePaper ?? el.dataset.seOrientation),
            p = w.photos[index],
            size = paperSizes.find((s) => s.id === el.value);
          if (size) {
            const landscape = p.width > p.height;
            p.width = landscape ? size.height : size.width;
            p.height = landscape ? size.width : size.height;
          } else if (el.dataset.seOrientation !== undefined) {
            const a = Math.min(p.width, p.height),
              b = Math.max(p.width, p.height);
            p.width = el.value === "portrait" ? a : b;
            p.height = el.value === "portrait" ? b : a;
          }
          changed();
          render();
        }),
      );
    const boundSession = session;
    bindPhotoExifEditor(container, id => boundSession.content.works.find(w => w.id === id), changed, () => busy || session !== boundSession, id => asset(id)?.photoMetadata ?? {});
    bindTitleBoardFields(container,{work:id=>boundSession.content.works.find(w=>w.id===id),change:()=>{changed();validateTextFields(container!,boundSession.content);},disabled:()=>busy||session!==boundSession});
    bindTextValidation(container, () => boundSession.content);
    container
      .querySelector<HTMLButtonElement>("[data-se-next]")
      ?.addEventListener("click", async () => {
        try {
          await ensureTextMeasurement();
        } catch {
          /* The server repeats verification. */
        }
        if (validateTextFields(container!, session!.content).length) {
          tab = "content";
          mode = "";
          render(false);
          notice("タイトルボードの文字量を確認してください。", true);
          return;
        }
        const c = session!.content;
        if (
          !session!.submission.imported &&
          (!c.name.trim() ||
            !c.grade.trim() ||
            !c.authorName.trim() ||
            !c.sections.length ||
            c.sections.some((s) => !s.singles && !s.series && !s.books) ||
            c.works.some(
              (w) =>
                !w.title.trim() ||
                (w.kind !== "book" &&
                  (!w.photos.length || w.photos.some((p) => !p.assetId))),
            ))
        ) {
          notice(
            "名前・学年・作者名、各展示の作品数、作品ごとのタイトルと画像を入力してください。",
            true,
          );
          return;
        }
        confirming = true;
        mode = "";
        render(false);
      });
    container
      .querySelector<HTMLButtonElement>("[data-se-back]")
      ?.addEventListener("click", () => {
        confirming = false;
        render(false);
      });
    container
      .querySelector<HTMLButtonElement>("[data-se-save]")
      ?.addEventListener("click", async () => {
        if (busy || !changes().length) return;
        busy = true;
        freeze(true);
        notice("修正を保存しています…");
        try {
          const previous = session;
          if (
            await options.save(
              session!.submission,
              structuredClone(session!.content),
            )
          ) {
            options.changed(false);
            if (session === previous) session = undefined;
          }
        } catch (e) {
          notice(
            e instanceof Error ? e.message : "修正を保存できませんでした。",
            true,
          );
        } finally {
          busy = false;
          freeze(false);
        }
      });
    options.bindExtra(container);
    changed();
  }
  function freeze(value: boolean) {
    container
      ?.querySelectorAll<
        | HTMLInputElement
        | HTMLButtonElement
        | HTMLSelectElement
        | HTMLTextAreaElement
      >("input,button,select,textarea")
      .forEach((el) => {
        if (value) {
          el.dataset.seWasDisabled = String(el.disabled);
          el.disabled = true;
        } else if (el.dataset.seWasDisabled !== undefined) {
          el.disabled = el.dataset.seWasDisabled === "true";
          delete el.dataset.seWasDisabled;
        }
      });
  }
  return {
    html,
    bind,
    reset: () => {
      series.close();
      releaseReview?.();
      releaseReview = undefined;
      session = undefined;
      container = undefined;
      options.changed(false);
    },
    canClose: () => !busy,
    saved: () => {
      session = undefined;
    },
  };
}
