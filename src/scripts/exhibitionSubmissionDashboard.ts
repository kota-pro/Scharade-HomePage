import {warningMark} from '../lib/advisoryWarnings.ts';
import {submissionWarningAt,exhibitionSubmissionWarnings} from '../lib/exhibitionSubmissionWarnings.ts';
import { exhibitionNotesText } from "../lib/exhibitionNotes.ts";
import { exhibitionSubmissionRows, summarizeExhibitionSubmissions, normalizeSubmissionSearch, submissionStageLabels, type SubmissionRow } from "../lib/exhibitionSubmissionSummary.ts";
import { workKindLabels } from "../lib/exhibitionTypes.ts";
import { workListColors } from "../lib/exhibitionWorkList.ts";
import { createWorkTagMenu, type WorkTagSaver } from "./exhibitionWorkTags.ts";
type RecordValue = Record<string, any>;
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const date = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
export function createSubmissionDashboard(options: {
  exhibitionId: string; data: () => RecordValue; detail: (submission: RecordValue) => string;
  bindDetail: (container: HTMLElement) => void; canClose: () => boolean; closed: () => void;
  tagWork: WorkTagSaver; message: (text: string, error?: boolean) => void;
}) {
  let active = "summary", query = "", stage = "all", modal: HTMLDialogElement | undefined, detailId = "";
  let returnFocus: HTMLElement | null = null, overflow = "";
  let notesModal: HTMLDialogElement | undefined, notesRowId = "", selectNotesPerson: ((id: string) => void) | undefined;
  const tabs = [["summary", "提出結果の概要"], ["status", "提出状況"], ["works", "提出作品"]];
  const rows = () => exhibitionSubmissionRows(options.data());
  let dashboardRoot: HTMLElement | undefined;
  const tagMenu = createWorkTagMenu({
    work: id => {
      const work = rows().filter(row => row.stage === "submitted").flatMap(row => row.submission!.content.works).find((work: RecordValue) => work.id === id);
      return work ? { id, title: work.title, listTag: options.data().exhibition?.workListTags?.[id] } : undefined;
    },
    parent: () => dashboardRoot!,
    focus: id => dashboardRoot?.querySelector<HTMLButtonElement>(`[data-submission-work-tag="${id}"]`)?.focus({ preventScroll: true }),
    redraw: () => refreshTags(), tag: options.tagWork, message: options.message,
  });
  const tagContent = (id: string) => {
    const color = workListColors.find(color => color.id === options.data().exhibition?.workListTags?.[id]);
    return { label: color?.label ?? "無色", html: `<span class="layout-work-swatch" style="--work-tag:${color?.color ?? "transparent"}" aria-hidden="true"></span><span>${color?.label ?? "色タグ"}</span>`, color };
  };
  function refreshTags() {
    dashboardRoot?.querySelectorAll<HTMLButtonElement>("[data-submission-work-tag]").forEach(button => {
      const id = button.dataset.submissionWorkTag!, tag = tagContent(id);
      button.innerHTML = tag.html; button.disabled = tagMenu.isSaving(id);
      button.dataset.workTag = tag.color?.id ?? "";
      button.title = `色タグ：${tag.label}（クリックして変更）`;
      button.setAttribute("aria-label", `${button.dataset.workTitle}の色タグ：${tag.label}`);
      button.style.setProperty("--work-tag-background", tag.color?.background ?? "#fff");
    });
  }
  const warningsFor=(submission:RecordValue|undefined)=>submission?exhibitionSubmissionWarnings(options.data().exhibition,submission.content??submission.draft,submissionWarningAt(submission)):[];
  const warningNotice=(submission:RecordValue|undefined)=>{const warnings=warningsFor(submission);return warnings.length?`<span data-submission-warning>${warningMark(`警告${warnings.length}件。詳細を確認してください。`)}</span>`:'';};
  const notesNotice = (row: SubmissionRow) => row.notesCount || row.hasUnsubmittedNotes ? row.stage === "draft" ? "備考あり（下書き）" : row.hasUnsubmittedNotes ? "備考あり（未提出の変更あり）" : "備考あり" : "";
  const sectionTitle = (id: string) => [...(options.data().exhibition?.schemas ?? [])].reverse().flatMap((s: RecordValue) => s.sections).find((s: RecordValue) => s.id === id)?.title ?? "以前の展示";
  const assetUrl = (id: string, preview = true) => `/api/exhibitions/${options.exhibitionId}/assets/${encodeURIComponent(id)}${preview ? "?preview=1&thumbnail=1" : ""}`;
  const driveStatus = (item: RecordValue) => item.drive?.error ? "保存エラー" : item.drive?.status === "delivered" ? "保存済み" : "保存待ち";
  const driveInfo = (item: RecordValue) => `<span class="submission-drive-status" data-state="${item.drive?.error ? "error" : item.drive?.status ?? "pending"}">${driveStatus(item)}</span>${item.drive?.status === "delivered" && item.drive.url ? `<a href="${escape(item.drive.url)}" target="_blank" rel="noreferrer">Driveで開く</a>` : ""}${item.drive?.error ? `<p class="submission-drive-error">${escape(item.drive.error)}</p>` : ""}`;
  const imageTile = (item: RecordValue, label: string, output = false) => {
    const url = output ? `/api/member/exhibitions/${options.exhibitionId}/outputs/${encodeURIComponent(item.id)}` : assetUrl(item.id);
    const image = !output || /^image\/(png|jpeg)$/.test(item.mimeType ?? "");
    return `<figure class="submission-asset"><a class="submission-image-link" href="${escape(output ? url : assetUrl(item.id, false))}" target="_blank" rel="noreferrer" title="${escape(item.name)}" aria-label="${escape(item.name)}を開く">${image ? `<img src="${escape(url)}" alt="${escape(label)}" loading="lazy" data-submission-image/><span class="submission-image-fallback" hidden>画像を読み込めませんでした</span>` : `<span class="submission-document" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6"/></svg><span>${item.mimeType === "application/pdf" ? "PDF" : "出力ファイル"}</span></span>`}<span class="submission-file-name">${escape(item.name)}</span></a><figcaption>${driveInfo(item)}</figcaption></figure>`;
  };
  const summaryHtml = () => {
    const summary = summarizeExhibitionSubmissions(rows());
    const cards = [["対象の出展者", `${summary.people}人`], ["提出済み", `${summary.submitted}人`], ["下書き", `${summary.draft}人`], ["未入力", `${summary.none}人`], ["提出作品の総数", `${summary.works}作品`], ["写真の総枚数", `${summary.photos}枚`]];
    return `<section aria-labelledby="submission-summary-title"><h3 id="submission-summary-title">提出結果の概要</h3><p class="exhibition-muted">参加予定者と、入力・提出のある出展者が対象です。保管中の下書きは集計に含みません。作品数は最新の提出分のみ（単写真1枚・組写真1組・ブック1冊を各1作品）で、再提出の過去分や未提出の変更は加算しません。</p><dl class="submission-stat-cards">${cards.map(([label, value]) => `<div><dt>${label}</dt><dd data-summary-stat="${label}">${value}</dd></div>`).join("")}</dl><div class="submission-progress"><label for="submission-progress">提出率 <strong>${summary.percent}%</strong>（${summary.submitted} / ${summary.people}人）</label><progress id="submission-progress" max="100" value="${summary.percent}">${summary.percent}%</progress></div>
      <div class="submission-summary-grid"><section><h4>作品種別の割合</h4><p class="exhibition-muted">ブックを含む${summary.works}作品に対する割合です。写真の総枚数はブックの画像を除きます。</p>${Object.entries(workKindLabels).map(([kind, label]) => { const count = summary.kinds[kind as keyof typeof summary.kinds], ratio = summary.works ? Math.round(count / summary.works * 1000) / 10 : 0; return `<div class="submission-kind"><span>${label}</span><strong>${count}作品 · ${ratio}%</strong><progress aria-label="${label}の割合" max="100" value="${ratio}">${ratio}%</progress></div>`; }).join("")}</section>
      <section><h4>学年別の提出状況</h4><div class="submission-table-scroll"><table class="submission-summary-table"><thead><tr><th scope="col">学年</th><th scope="col">対象者</th><th scope="col">提出済み</th><th scope="col">提出作品</th></tr></thead><tbody>${summary.grades.map(grade => `<tr><th scope="row">${escape(grade.grade)}</th><td>${grade.people}人</td><td>${grade.submitted}人</td><td>${grade.works}作品</td></tr>`).join("") || '<tr><td colspan="4">対象者はまだいません。</td></tr>'}</tbody></table></div></section></div>
      <section><h4>展示ごとの提出作品数</h4><div class="submission-table-scroll"><table class="submission-summary-table"><thead><tr><th scope="col">展示</th><th scope="col">単写真</th><th scope="col">組写真</th><th scope="col">ブック</th><th scope="col">合計</th></tr></thead><tbody>${summary.sections.map(section => `<tr><th scope="row">${escape(sectionTitle(section.id))}</th><td>${section.single}</td><td>${section.series}</td><td>${section.book}</td><td>${section.total}作品</td></tr>`).join("") || '<tr><td colspan="5">提出された作品はまだありません。</td></tr>'}</tbody></table></div></section><section class="submission-notes-summary" data-notes-summary><div class="submission-summary-actions" data-submission-summary-actions><h4><button type="button" class="submission-notes-count" data-notes-preview="" aria-haspopup="dialog">備考（${summary.notes}）</button></h4><button type="button" class="secondary" data-manage-boards>タイトルボードの配置を調整</button><button type="button" data-output-boards title="作品の文字量とPortfolio QRを確認してからPDFを生成します。">タイトルボードPDFを生成</button></div><p class="exhibition-muted">クリックすると名前と備考の詳細を表示します。未提出の下書きは件数に含みません。</p></section></section>`;
  };
  const statusHtml = () => `<section aria-labelledby="submission-status-title"><h3 id="submission-status-title">提出内容とQRコード確認</h3><div class="submission-filters"><label>名前・作品名で検索<input type="search" data-submission-search value="${escape(query)}" placeholder="氏名・作者名・LINE名・作品名"/></label><label>提出状況<select data-submission-stage>${[["all", "すべて"], ...Object.entries(submissionStageLabels)].map(([value, label]) => `<option value="${value}" ${stage === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div><p data-submission-count role="status" aria-live="polite"></p><ul class="submission-status-list">${rows().map(row => `<li data-submission-row data-search="${escape(row.search)}" data-stage="${row.stage}"><div><strong>${escape(row.name)}</strong>${row.user?.lineName ? `<small>${escape(row.user.lineName)}</small>` : ""}<span>${escape(row.grade)}</span></div><div><span class="submission-stage" data-stage="${row.stage}">${submissionStageLabels[row.stage]}</span>${row.stage === "submitted" ? `<span>${row.submission!.content.works.length}作品 · ${row.submission!.qrConfirmed ? "QR確認済み" : "QR未確認"}</span>` : ""}${row.hasUnsubmittedNotes ? '<small>備考に未提出の変更</small>' : ""}<small>更新：${date(row.submission?.updatedAt)}</small></div><button class="secondary submission-detail-button" type="button" data-submission-detail="${escape(row.id)}" aria-label="${escape(row.name)}の提出状況の詳細${notesNotice(row) ? `（${escape(notesNotice(row))}）` : ""}"${notesNotice(row) ? ` title="${escape(notesNotice(row))}"` : ""}>詳細を確認${warningNotice(row.submission)}${row.submission?.content?.works.some((w:RecordValue)=>w.boardIssues?.length)?'<span class="board-error-dot" title="タイトルボードの配置調整が必要です" aria-label="タイトルボードの配置調整が必要です">!</span>':""}${notesNotice(row) ? '<span class="submission-notes-dot" data-submission-notes-notice aria-hidden="true"></span>' : ""}</button></li>`).join("")}</ul><p data-submission-empty hidden>条件に一致する出展者はいません。</p>
    <details class="submission-management"><summary>連携・既存回答の取り込み</summary><div class="exhibition-actions"><button class="secondary" data-retry>Googleフォーム送信を再試行</button></div><label class="exhibition-field">スプレッドシートID<input data-import-sheet /></label><button class="secondary" data-google-import>既存回答を取り込む</button><p class="exhibition-muted">既存のGoogle連携アカウントが閲覧できるスプレッドシートを指定してください。</p></details>
    ${(options.data().submissions ?? []).some((s: RecordValue) => s.inactive) ? `<details class="submission-management"><summary>保管中の下書き</summary><ul>${options.data().submissions.filter((s: RecordValue) => s.inactive).map((s: RecordValue) => `<li>${escape(s.draft?.name || "下書き")} <button type="button" class="secondary" data-submission-detail="archive:${s.id}">詳細を確認</button></li>`).join("")}</ul></details>` : ""}</section>`;
  const worksHtml = () => {
    const data = options.data(), submitted = rows().filter(row => row.stage === "submitted"), used = new Set<string>();
    const works = submitted.flatMap(row => row.submission!.content.works.map((work: RecordValue) => {
      const images = work.photos.filter((photo: RecordValue) => photo.assetId).map((photo: RecordValue) => { used.add(photo.assetId); const asset = (data.assets ?? []).find((a: RecordValue) => a.id === photo.assetId); return asset ? imageTile(asset, `${work.title || "無題"}の作品画像`) : '<p class="exhibition-muted">添付画像が見つかりません。</p>'; }).join("");
      const tag = tagContent(work.id);
      return `<article class="submission-work-card" data-submission-work-card="${escape(work.id)}"><header><h4>${escape(work.title || "無題")}${work.boardIssues?.length?'<span class="board-error-dot" title="タイトルボードの配置調整が必要です" aria-label="タイトルボードの配置調整が必要です">!</span>':""}</h4><p>${escape(row.name)} · ${escape(workKindLabels[work.kind as keyof typeof workKindLabels])} · ${escape(sectionTitle(work.sectionId))}</p></header><div class="submission-image-grid">${images || `<p class="exhibition-muted">${work.kind === "book" ? "ブックの画像提出は任意です。" : "画像はまだありません。"}</p>`}</div><div class="submission-work-actions"><button type="button" class="submission-work-tag" data-submission-work-tag="${escape(work.id)}" data-work-title="${escape(work.title || "無題")}" data-work-tag="${tag.color?.id ?? ""}" style="--work-tag-background:${tag.color?.background ?? "#fff"}" aria-label="${escape(work.title || "無題")}の色タグ：${tag.label}" title="色タグ：${tag.label}（クリックして変更）" aria-haspopup="menu" ${tagMenu.isSaving(work.id) ? "disabled" : ""}>${tag.html}</button><button type="button" class="secondary" data-submission-detail="${escape(row.id)}" aria-label="${escape(row.name)}の提出状況の詳細">提出内容を確認${warningNotice(row.submission)}</button></div></article>`;
    }));
    const extra = (data.assets ?? []).filter((asset: RecordValue) => !used.has(asset.id));
    return `<section aria-labelledby="submission-works-title"><h3 id="submission-works-title">提出作品</h3><p>最新の提出作品と、画像ごとのDrive保存状況を表示します。ファイル名は画像にポインターを重ねるか、画像リンクにフォーカスすると表示します。スマホでは画像をタップすると名前が表示され、もう一度タップすると画像を開きます。</p><div class="submission-work-grid">${works.join("") || '<p>提出された作品はまだありません。</p>'}</div><section class="submission-drive-files"><h4>Driveの保存状況：出力ファイル</h4><div class="submission-image-grid">${(data.outputs ?? []).map((item: RecordValue) => imageTile(item, "保存した出力画像", true)).join("") || '<p class="exhibition-muted">出力ファイルはまだありません。</p>'}</div></section>${extra.length ? `<details class="submission-management"><summary>下書き・差し替え前などの添付画像（${extra.length}件）</summary><p class="exhibition-muted">最新の提出作品には使われていない画像です。作品数の集計には含みません。</p><div class="submission-image-grid">${extra.map((item: RecordValue) => imageTile(item, "添付済みの画像")).join("")}</div></details>` : ""}</section>`;
  };
  const html = () => `<div class="submission-dashboard"><nav class="submission-tabs" role="tablist" aria-label="提出結果の表示">${tabs.map(([id, label]) => `<button type="button" role="tab" id="submission-tab-${id}" data-submission-tab="${id}" aria-controls="submission-panel-${id}" aria-selected="${active === id}" tabindex="${active === id ? 0 : -1}">${label}</button>`).join("")}</nav>${[["summary", summaryHtml], ["status", statusHtml], ["works", worksHtml]].map(([id, render]) => `<div role="tabpanel" id="submission-panel-${id}" aria-labelledby="submission-tab-${id}" data-submission-panel="${id}" ${active === id ? "" : "hidden"}>${(render as () => string)()}</div>`).join("")}</div>`;
  const refreshDetail = () => {
    if (!modal?.open) return;
    const row = rows().find(row => row.id === detailId || detailId.startsWith("archive:") && row.submission?.id === detailId.slice(8)), archived = detailId.startsWith("archive:") ? options.data().submissions.find((s: RecordValue) => s.id === detailId.slice(8)) : undefined;
    if (!row && !archived) { modal.close(); return; }
    const s = row?.submission ?? archived, body = modal.querySelector<HTMLElement>("[data-submission-detail-body]")!;
    const top = modal.scrollTop;
    const fullEditor = !!s?.content && !s?.inactive;
    modal.classList.toggle("submission-editor-dialog",fullEditor);
    modal.querySelector<HTMLElement>("[data-submission-detail-title]")!.textContent = `${row?.name ?? s.draft?.name ?? "下書き"}の提出状況`;
    body.innerHTML = fullEditor ? options.detail(s) : row ? `<dl class="submission-detail-facts"><div><dt>提出状況</dt><dd>${submissionStageLabels[row.stage]}</dd></div><div><dt>学年</dt><dd>${escape(row.grade)}</dd></div><div><dt>最終更新</dt><dd>${date(s?.updatedAt)}</dd></div></dl>${s ? options.detail(s) : '<p>出展フォームはまだ入力されていません。</p>'}` : `<p>保管中の下書きです。集計対象には含まれていません。</p>${options.detail(s)}`;
    if(!fullEditor&&s){const warnings=warningsFor(s);if(warnings.length)body.insertAdjacentHTML('afterbegin',`<aside class="submission-warning-summary"><h3>${warningMark('提出内容の警告')} 提出内容の警告</h3><ul class="advisory-warning-list">${warnings.map(w=>`<li>${escape(w.message)}</li>`).join('')}</ul></aside>`);}
    options.bindDetail(body);
    modal.scrollTop = top;
  };
  const open = (id: string, trigger: HTMLElement) => {
    detailId = id; returnFocus = trigger; overflow = document.body.style.overflow;
    modal = document.createElement("dialog"); modal.className = "exhibition-confirm-dialog exhibition-page submission-detail-dialog board-preview-dialog"; modal.setAttribute("aria-labelledby", "submission-detail-title");
    modal.innerHTML = '<header class="exhibition-confirm-header"><h2 id="submission-detail-title" data-submission-detail-title>提出状況</h2><button type="button" class="layout-close" data-submission-detail-close aria-label="提出状況の詳細を閉じる"><span></span><span></span></button></header><div data-submission-detail-body></div>';
    const close = () => { if (options.canClose()) modal?.close(); };
    modal.querySelector("[data-submission-detail-close]")!.addEventListener("click", close);
    modal.addEventListener("cancel", event => { event.preventDefault(); close(); });
    modal.addEventListener("close", () => { modal?.remove(); modal = undefined; document.body.style.overflow = overflow; options.closed(); const target = returnFocus?.isConnected ? returnFocus : [...document.querySelectorAll<HTMLElement>("[data-submission-detail]")].find(button=>button.dataset.submissionDetail===detailId&&button.getClientRects().length); (target ?? document.querySelector<HTMLElement>(`[data-submission-tab="${active}"]`))?.focus({ preventScroll: true }); }, { once: true });
    document.body.append(modal); document.body.style.overflow = "hidden"; modal.showModal(); refreshDetail();
  };
  const refreshNotes = () => {
    if (!notesModal?.open) return;
    const entries = rows().filter(row => row.notesCount && (notesRowId ? row.id === notesRowId : row.stage === "submitted"));
    notesModal.querySelector("[data-notes-preview-title]")!.textContent = `備考（${entries.length}）`;
    const body = notesModal.querySelector<HTMLElement>("[data-notes-preview-body]")!;
    const top = notesModal.scrollTop;
    body.innerHTML = `<p class="exhibition-muted">名前・備考をクリックすると、その方の提出概要を表示します。</p><ul class="submission-notes-entries">${entries.map(row => `<li><button type="button" class="submission-notes-entry" data-notes-entry="${escape(row.id)}" aria-label="${escape(row.name)}の提出概要を表示"><span class="submission-notes-person"><strong>${escape(row.name)}</strong><small>${submissionStageLabels[row.stage]}</small></span><span data-notes-preview-text>${escape(exhibitionNotesText(row.submission?.content ?? row.submission?.draft))}</span><span class="submission-notes-link">提出概要を見る →</span></button></li>`).join("") || "<li>備考のある提出はまだありません。</li>"}</ul>`;
    body.querySelectorAll<HTMLButtonElement>("[data-notes-entry]").forEach(button => button.addEventListener("click", () => selectNotesPerson?.(button.dataset.notesEntry!)));
    notesModal.scrollTop = top;
  };
  const openNotes = (id: string, trigger: HTMLElement, navigate: (id: string) => void) => {
    if (notesModal?.open) return;
    notesRowId = id;
    const dialog = document.createElement("dialog"), previousOverflow = document.body.style.overflow;
    notesModal = dialog;
    dialog.className = "exhibition-confirm-dialog exhibition-page submission-notes-dialog board-preview-dialog";
    dialog.setAttribute("aria-labelledby", "notes-preview-title");
    dialog.innerHTML = '<header class="exhibition-confirm-header"><h2 id="notes-preview-title" data-notes-preview-title>備考</h2><button type="button" class="layout-close" data-notes-preview-close aria-label="備考一覧を閉じる"><span></span><span></span></button></header><div data-notes-preview-body></div>';
    let selected = "";
    selectNotesPerson = person => { selected = person; dialog.close(); };
    dialog.querySelector("[data-notes-preview-close]")!.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      dialog.remove(); notesModal = undefined; selectNotesPerson = undefined; document.body.style.overflow = previousOverflow;
      if (selected) navigate(selected);
      else (trigger.isConnected ? trigger : [...document.querySelectorAll<HTMLElement>("[data-notes-preview]")].find(button => button.dataset.notesPreview === id && button.getClientRects().length))?.focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog); document.body.style.overflow = "hidden"; dialog.showModal(); refreshNotes();
  };
  const bind = (root: HTMLElement) => {
    tagMenu.close(); dashboardRoot = root;
    root.querySelectorAll<HTMLButtonElement>("[data-submission-work-tag]").forEach(button => {
      button.addEventListener("click", () => { const rect = button.getBoundingClientRect(); tagMenu.open(button.dataset.submissionWorkTag!, rect.left, rect.bottom); });
      button.addEventListener("contextmenu", event => { event.preventDefault(); tagMenu.open(button.dataset.submissionWorkTag!, event.clientX, event.clientY); });
    });
    const changeTab = (id: string) => { tagMenu.close(); active = id; root.querySelectorAll<HTMLElement>("[data-submission-tab]").forEach(tab => { const selected = tab.dataset.submissionTab === active; tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; }); root.querySelectorAll<HTMLElement>("[data-submission-panel]").forEach(panel => { panel.hidden = panel.dataset.submissionPanel !== active; }); };
    root.querySelectorAll<HTMLButtonElement>("[data-submission-tab]").forEach((button, index, buttons) => {
      button.addEventListener("click", () => changeTab(button.dataset.submissionTab!));
      button.addEventListener("keydown", event => { const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : -1; if (next < 0) return; event.preventDefault(); changeTab(buttons[next].dataset.submissionTab!); buttons[next].focus(); });
    });
    const filter = () => { let visible = 0; const normalized = normalizeSubmissionSearch(query), entries = [...root.querySelectorAll<HTMLElement>("[data-submission-row]")]; entries.forEach(row => { row.hidden = !(row.dataset.search!.includes(normalized) && (stage === "all" || stage === row.dataset.stage)); if (!row.hidden) visible++; }); const count = root.querySelector("[data-submission-count]"); if (count) count.textContent = `${visible} / ${entries.length}人を表示`; const empty = root.querySelector<HTMLElement>("[data-submission-empty]"); if (empty) empty.hidden = !!visible; };
    root.querySelector<HTMLInputElement>("[data-submission-search]")?.addEventListener("input", event => { query = (event.target as HTMLInputElement).value; filter(); });
    root.querySelector<HTMLSelectElement>("[data-submission-stage]")?.addEventListener("change", event => { stage = (event.target as HTMLSelectElement).value; filter(); });
    root.querySelectorAll<HTMLButtonElement>("[data-notes-preview]").forEach(button => button.addEventListener("click", () => openNotes(button.dataset.notesPreview!, button, id => {
      const person = rows().find(row => row.id === id);
      if (!person) { button.focus({ preventScroll: true }); return; }
      query = person.name; stage = "all";
      root.querySelector<HTMLInputElement>("[data-submission-search]")!.value = query;
      root.querySelector<HTMLSelectElement>("[data-submission-stage]")!.value = stage;
      changeTab("status"); filter();
      const target = [...root.querySelectorAll<HTMLElement>("[data-submission-detail]")].find(item => item.dataset.submissionDetail === id)!;
      target.scrollIntoView({ block: "center" }); open(id, target);
    })));
    root.querySelectorAll<HTMLButtonElement>("[data-submission-detail]").forEach(button => button.addEventListener("click", () => open(button.dataset.submissionDetail!, button)));
    root.querySelectorAll<HTMLImageElement>("[data-submission-image]").forEach(image => image.addEventListener("error", () => { image.hidden = true; const fallback = image.nextElementSibling as HTMLElement; if (fallback) fallback.hidden = false; }));
    root.querySelectorAll<HTMLAnchorElement>(".submission-image-link").forEach(link => {
      let touch = false;
      link.addEventListener("pointerdown", event => { touch = event.pointerType === "touch"; });
      link.addEventListener("click", event => { if (touch && !link.hasAttribute("data-name-visible")) { event.preventDefault(); root.querySelectorAll("[data-name-visible]").forEach(item=>item.removeAttribute("data-name-visible")); link.setAttribute("data-name-visible", ""); link.focus({preventScroll:true}); } touch = false; });
    });
    filter(); refreshDetail(); refreshNotes();
  };
  return { html, bind };
}
