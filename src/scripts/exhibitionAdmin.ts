import { paperSizes } from "../lib/exhibitionEditing.ts";
import {openLayoutPngPreview} from './exhibitionLayoutExport.ts';
import {createLayoutSync} from "./exhibitionLayoutSync.ts";
import {createLayoutHistory} from "./exhibitionLayoutHistory.ts";
import { createLayoutEditor } from "./exhibitionLayoutEditor";
import { bindTextValidation, ensureTextMeasurement, validateTextFields } from "./exhibitionTextValidation";
import { roomPreview } from "../lib/exhibitionRoomPreview.ts";
import { operationNotice, flashNotice } from "./siteNotice";
export {};
import { readExhibitionResponse } from "./exhibitionResponse";
import { reusableRoom } from "../lib/exhibitionRoomReuse.ts";
import type { RoomTemplate } from "../lib/exhibitionTypes.ts";
import { bindRecipientPicker } from "./recipientPicker";
import { formPreviewHtml } from "./exhibitionFormPreview";
import { gradeLabels } from "../lib/activityTypes.ts";
import type { FormSchema, RoomLayout, Work } from "../lib/exhibitionTypes.ts";
type AnyRecord = Record<string, any>;

const root = document.querySelector<HTMLElement>("#exhibition-admin");
if (root) {
  const exhibitionId = root.dataset.exhibitionId ?? "";
  const view = root.dataset.exhibitionView ?? "overview";
  let data: AnyRecord | null = null;
  let schemaDraft: AnyRecord | null = null;
  let settingsDraft: AnyRecord = {};
  let roomsDraft: AnyRecord[] = [];
  let activeRoom = 0;
  let roomModal:HTMLDialogElement|undefined,previousRoomOverflow="",previousRoomFocus:HTMLElement|null=null;
  let pointerBusy=false;
  let roomPreviewObserver: ResizeObserver | undefined;
  let roomTemplates: RoomTemplate[] = [], selectedTemplate = "", templateName = "";
  let savedSettings = "", savedSchema = "", savedRooms = "", boardDirty = false;
  let layoutSync:ReturnType<typeof createLayoutSync>|undefined,syncMessage="共同編集へ接続しています…";
  let pendingLayoutEdits = () => false;
  const isDirty = () => boardDirty || !!layoutSync?.hasPending() || pendingLayoutEdits() || (view === "form" ? JSON.stringify(schemaDraft) !== savedSchema : view === "layout" ? JSON.stringify(roomsDraft) !== savedRooms : view === "overview" ? JSON.stringify(settingsDraft) !== savedSettings : false);
  window.addEventListener("beforeunload", event => { if (data && isDirty()) { event.preventDefault(); event.returnValue = ""; } });
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
  const uuid = () => crypto.randomUUID();
  const localDateTime = (value: string) => value ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 16) : "";
  const numeric = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const message = (value: string, error = false) => {
    operationNotice(value,error,"exhibition-admin");
    const target = root.querySelector<HTMLElement>(".exhibition-status");
    if (target) { target.textContent = value; target.className = `exhibition-status${error ? " error" : value ? " success" : ""}`; }
  };
  const api = async (body: AnyRecord) => {
    const response = await fetch("/api/member/exhibitions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await readExhibitionResponse(response);
    if (!response.ok || !result.ok) throw new Error(result.message ?? "保存できませんでした。");
    return result as AnyRecord;
  };
  const current = () => data?.exhibition as AnyRecord;
  const works = () => data?.layoutWorks ?? (data?.submissions ?? []).filter((s: AnyRecord) => !s.inactive).flatMap((submission: AnyRecord) => submission.content?.works ?? []).map((work: AnyRecord) => ({ ...work, exhibitorName: (data?.submissions ?? []).find((submission: AnyRecord) => submission.content?.works?.some((item: AnyRecord) => item.id === work.id))?.content?.authorName ?? "", submissionName: (data?.submissions ?? []).find((submission: AnyRecord) => submission.content?.works?.some((item: AnyRecord) => item.id === work.id))?.content?.name ?? "" }));
  const room = () => roomsDraft[activeRoom];
  const replaceRooms=(value:RoomLayout[])=>{const activeId=room()?.id;roomsDraft=value;const index=value.findIndex(r=>r.id===activeId);activeRoom=index>=0?index:Math.min(activeRoom,Math.max(0,value.length-1));};
  const defaultRoom = () => ({ id: uuid(), name: `展示室 ${roomsDraft.length + 1}`, vertices: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, { x: 0, y: 4000 }], wallHeights: [3000, 3000, 3000, 3000], openings: [], placements: [], tables: [], books: [] });
  const formField = (field: AnyRecord, index: number) => `<fieldset class="exhibition-builder-question" data-field-index="${index}"><legend>質問 ${index + 1}</legend><div class="exhibition-grid"><label class="exhibition-field">質問名<input data-field-key="label" value="${escape(field.label)}"/></label><label class="exhibition-field">回答形式<select data-field-key="type">${[["text","短文"],["paragraph","長文"],["number","数値"],["select","選択肢"],["checkbox","複数選択"],["date","日付"]].map(([v,l]) => `<option value="${v}" ${field.type === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="exhibition-field">説明<textarea data-field-key="description">${escape(field.description)}</textarea></label><label class="exhibition-field">表示位置<select data-field-key="scope">${[["common","出展者情報"],["section","展示セクションごと"],["work","作品ごと"]].map(([v,l]) => `<option value="${v}" ${field.scope === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label class="exhibition-field">対象の展示<select data-field-key="sectionId"><option value="">すべての展示</option>${schemaDraft!.sections.map((section: AnyRecord) => `<option value="${section.id}" ${field.sectionId === section.id ? "selected" : ""}>${escape(section.title)}</option>`).join("")}</select></label><label class="exhibition-field">対象作品<select multiple data-field-key="kinds" aria-label="対象作品">${[["single","単写真"],["series","組写真"],["book","ブック"]].map(([v,l]) => `<option value="${v}" ${field.kinds?.includes(v) ? "selected" : ""}>${l}</option>`).join("")}</select><small>選択なしの場合は全作品が対象です。</small></label><label class="exhibition-field">選択肢（1行に1つ）<textarea data-field-key="options">${escape((field.options ?? []).join("\n"))}</textarea></label></div><label class="exhibition-check"><input data-field-key="required" type="checkbox" ${field.required ? "checked" : ""}/>必須回答</label><div class="exhibition-actions"><button class="danger" type="button" data-remove-field="${index}">この質問を削除</button></div></fieldset>`;
  const limitsEditor = (section: AnyRecord, index: number) => {
    const limits=section.limits??{};
    return `<fieldset class="exhibition-limits-editor"><legend>この展示の提出上限（1人ごと）</legend><div class="exhibition-grid">${[['maxWorks','作品数の上限',1,300,1],['maxLongEdgeMm','長辺の上限 mm',.1,100000,.1],['maxShortEdgeMm','短辺の上限 mm',.1,100000,.1]].map(([key,label,min,max,step])=>`<label>${label}<input data-section-limit="${key}" data-limit-section="${index}" type="number" min="${min}" max="${max}" step="${step}" placeholder="制限なし" value="${escape(limits[key as string]??'')}"/></label>`).join('')}</div><fieldset><legend>収まる規格の枠サイズ</legend><p class="exhibition-muted">ドロップダウンでサイズを追加できます。選択なしは枠の制限なし。複数追加した場合はいずれかの枠内で可。縦横の入れ替え・自由サイズを認めます。</p><label>枠サイズを選択<select data-limit-frame-select data-limit-section="${index}"><option value="">${limits.frameSizeIds?.length?'サイズを追加':'制限なし（サイズを選択）'}</option><option value="none">制限なし（すべて解除）</option>${paperSizes.map(p=>`<option value="${p.id}" ${(limits.frameSizeIds??[]).includes(p.id)?'disabled':''}>${'label' in p?p.label:p.id}（${p.width}×${p.height}mm）</option>`).join('')}</select></label><div class="exhibition-limit-frames" aria-label="選択中の枠サイズ">${paperSizes.filter(p=>(limits.frameSizeIds??[]).includes(p.id)).map(p=>`<span class="exhibition-frame-choice"><span>${'label' in p?p.label:p.id}（${p.width}×${p.height}mm）</span><button type="button" data-remove-limit-frame="${p.id}" data-limit-section="${index}" aria-label="${p.id}の枠サイズを削除">×</button></span>`).join('')}</div></fieldset><p class="exhibition-muted">寸法は単写真・組写真全体の外寸（回転・写真間の余白を含む）。mm上限と枠を併用した場合は両方に従います。ブックは作品数・寸法の上限の対象外です。</p></fieldset>`;
  };
  const schemaHtml = () => {
    const schema = schemaDraft!;
    return `<section><h3>出展フォームの質問とセクション</h3><p>「通常展示」は最初から入っています。企画展示はここで追加し、タイトル・説明・追加質問はいつでも編集できます。質問は新しいフォーム定義版として保存します。提出済みの回答と履歴は保持し、作品数・寸法の上限は次の提出・再提出から最新設定を適用します。</p>
      <p class="exhibition-muted">キャプションの質問名は「キャプション」で固定です。</p>
      <fieldset class="exhibition-limits-editor"><legend>全展示合計の提出上限（1人ごと）</legend><label>作品数の上限<input data-total-work-limit type="number" min="1" max="300" step="1" placeholder="制限なし" value="${escape(schema.limits?.maxWorks??'')}"/></label><p class="exhibition-muted">単写真1枚・組写真1組を、それぞれ1作品と数えます。ブックは作品数の上限の対象外です。空欄は制限なしです。</p></fieldset><h4>展示セクション</h4><datalist id="schema-sections">${schema.sections.map((section: AnyRecord) => `<option value="${escape(section.id)}">${escape(section.title)}</option>`).join("")}</datalist>
      <div class="exhibition-list exhibition-schema-sections">${schema.sections.map((section: AnyRecord,index: number) => `<fieldset class="exhibition-builder-question" data-section-index="${index}"><legend>展示 ${index+1}</legend><div class="exhibition-form"><label>タイトル<input data-section-key="title" value="${escape(section.title)}"/></label><label>説明<textarea data-section-key="description" rows="4">${escape(section.description)}</textarea></label></div>${limitsEditor(section,index)}<div class="exhibition-actions"><button class="danger" type="button" data-remove-section="${index}" ${schema.sections.length === 1 ? "disabled" : ""}>この展示を削除</button></div></fieldset>`).join("")}</div><div class="exhibition-actions"><button class="secondary" type="button" data-add-section>企画展示セクションを追加</button></div>
      <h4>追加質問</h4><p class="exhibition-muted">質問の表示位置、対象の展示・作品、回答形式を選べます。</p>
      <div class="exhibition-list">${schema.fields.map(formField).join("")}</div><div class="exhibition-actions"><button class="secondary" type="button" data-add-field>質問を追加</button><button type="button" data-save-schema>プレビューして保存</button></div></section>`;
  };
  const updateSchemaInput = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
    const sectionRow = input.closest<HTMLElement>("[data-section-index]");
    if (sectionRow) { const item = schemaDraft!.sections[Number(sectionRow.dataset.sectionIndex)]; item[input.dataset.sectionKey ?? "title"] = input.value; return; }
    const fieldRow = input.closest<HTMLElement>("[data-field-index]");
    if (!fieldRow) return;
    const item = schemaDraft!.fields[Number(fieldRow.dataset.fieldIndex)], key = input.dataset.fieldKey ?? "";
    if (key === "required") item.required = (input as HTMLInputElement).checked;
    else if (key === "options") item.options = input.value.split(/\n|\|/).map(value => value.trim()).filter(Boolean);
    else if (key === "kinds") { const kinds = input instanceof HTMLSelectElement ? [...input.selectedOptions].map(option => option.value) : []; item.kinds = kinds.length ? kinds : undefined; }
    else if (key === "sectionId") { item.sectionId = input.value.trim() || undefined; }
    else item[key] = input.value;
  };
  const libraryHtml = () => `<fieldset class="room-library"><legend>保存済み展示室</legend><div class="exhibition-grid"><label class="exhibition-field">再利用する展示室<select data-room-template-choice><option value="">選択してください</option>${roomTemplates.map(t => `<option value="${t.id}" ${selectedTemplate === t.id ? "selected" : ""}>${escape(t.name)}</option>`).join("")}</select></label><label class="exhibition-field">展示室の保存名<input data-room-template-name maxlength="150" value="${escape(templateName || room()?.name || "")}"/></label></div><p class="exhibition-muted">部屋の形・扉・窓・展示台・図形・注記を保存し、他の写真展でも読み込めます。</p><div class="exhibition-actions"><button class="secondary" data-room-template-load ${selectedTemplate ? "" : "disabled"}>選んだ展示室を追加</button><button class="secondary" data-room-template-save ${room() ? "" : "disabled"}>名前を付けて新規保存</button><button class="secondary" data-room-template-update ${selectedTemplate && room() ? "" : "disabled"}>選んだ保存済み展示室を更新</button></div></fieldset>`;
  const outputDownload = async (kind: string, roomId = "",outputView="floor",outputPage=0,expectedSha256?:string) => {
    if(view==="layout"&&(!layoutEditor.finishEditing()||!await layoutSync?.flush()))return;
    if (isDirty()) { message("変更内容を保存してから出力してください。", true); return; }
    message("出力を生成しています…");
    try {
      const response = await fetch(`/api/member/exhibitions/${exhibitionId}/output?kind=${encodeURIComponent(kind)}${roomId ? `&room=${encodeURIComponent(roomId)}&view=${encodeURIComponent(outputView)}&page=${outputPage}` : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expectedSha256?{expectedSha256}:{}) });
      if (!response.ok) { const problem = await readExhibitionResponse(response); throw new Error(problem.issues ? problem.issues.map((issue: AnyRecord) => `${issue.title}: ${issue.message}`).join("\n") : (problem.message ?? "出力できませんでした。")); }
      const blob = await response.blob(), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = decodeURIComponent(response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? `${current().title}.pdf`); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); message("ダウンロードを開始しました。Driveへの保存は順次処理します。");return true;
    } catch (error) { message(error instanceof Error ? error.message : "出力できませんでした。", true); }
  };
  const boardEditor = (submission: AnyRecord) => `<details data-board-editor="${submission.id}"><summary>タイトルボードの内容を修正</summary><div class="exhibition-form">${[["name", "名前"], ["grade", "学年"], ["authorName", "作者名"], ["portfolioUrl", "外部Portfolio URL"]].map(([key, label]) => `<label>${label}<input data-board-common="${key}" value="${escape(submission.content[key])}"/></label>`).join("")}${submission.content.works.map((work: AnyRecord) => `<fieldset data-board-work="${work.id}"><legend>${escape(work.title)}</legend>${[["title", "作品タイトル"], ["caption", "キャプション"], ["location", "撮影場所"], ["equipment", "使用機材"], ["settings", "撮影設定"]].map(([key, label]) => `<label>${label}${key === "caption" ? `<textarea data-board-key="${key}">${escape(work[key])}</textarea>` : `<input data-board-key="${key}" value="${escape(work[key])}"/>`}</label>`).join("")}</fieldset>`).join("")}<button data-save-board="${submission.id}">修正を保存</button></div></details>`;
  const boardContent=(editor:HTMLElement,submission:AnyRecord) => {
    const content=structuredClone(submission.content);
    editor.querySelectorAll<HTMLInputElement>("[data-board-common]").forEach(input=>content[input.dataset.boardCommon!]=input.value);
    editor.querySelectorAll<HTMLElement>("[data-board-work]").forEach(fieldset=>{const work=content.works.find((w:AnyRecord)=>w.id===fieldset.dataset.boardWork);if(!work)return;const previous={location:work.location,equipment:work.equipment,settings:work.settings};fieldset.querySelectorAll<HTMLInputElement|HTMLTextAreaElement>("[data-board-key]").forEach(input=>work[input.dataset.boardKey!]=input.value);if(work.details&&Object.entries(previous).some(([key,value])=>work[key]!==value))delete work.details;});
    return content;
  };
  const bindingHtml = (s: AnyRecord) => s.imported || s.versions.length ? "" : `<div class="exhibition-form"><p>${s.inactive ? "保管中の下書きです。" : s.userId ? "会員に紐付け済みです。" : "会員アカウントとの紐付けが必要な下書きです。"}</p><label>出展者アカウント<select data-bind-user="${s.id}"><option value="">会員を選択</option>${(data?.users ?? []).map((u: AnyRecord) => `<option value="${escape(u.id)}" ${s.userId === u.id ? "selected" : ""}>${escape(u.name)}</option>`).join("")}</select></label><div class="exhibition-actions"><button class="secondary" data-bind-submission="${s.id}">この下書きを紐付けて再開</button>${!s.inactive && !s.content ? `<button class="secondary" data-archive-submission="${s.id}">入力を再開せず保管</button>` : ""}</div><small>同じ会員に複数の下書きがある場合、この下書きを再開対象にします。他の下書きも管理画面に保管します。</small></div>`;
  const submissionsHtml = () => `<section><h3>提出内容とQRコード確認</h3><details><summary>既存の回答スプレッドシートから取り込む</summary><label class="exhibition-field">スプレッドシートID<input data-import-sheet /></label><button class="secondary" data-google-import>既存回答を取り込む</button><p class="exhibition-muted">既存のGoogle連携アカウントが閲覧できるスプレッドシートを指定してください。</p></details><p>タイトルボードPDFは、すべての作品の文字量とPortfolio QRを確認してから生成します。修正が必要な場合は理由を表示します。</p><div class="exhibition-actions"><button data-output-boards>タイトルボードPDFを生成</button><button class="secondary" data-retry>Googleフォーム送信を再試行</button></div><ul class="exhibition-list">${(data?.submissions ?? []).map((submission: AnyRecord) => `<li><strong>${escape(submission.content?.name || submission.draft?.name || "下書き")}</strong> · ${submission.content?.works?.length ?? 0}作品 · ${submission.qrConfirmed ? "QR確認済み" : "QR未確認"}<br/><span class="exhibition-muted">${submission.versions.map((version: AnyRecord) => `v${version.version}: ${version.delivery}${version.error ? ` (${escape(version.error)})` : ""}`).join(" / ") || "未提出"}</span>${bindingHtml(submission)}${submission.qrImage ? `<figure class="exhibition-qr"><img src="${escape(submission.qrImage)}" alt="Portfolio QRコード" width="140" height="140"/><figcaption><a href="${escape(submission.qrUrl)}" target="_blank" rel="noreferrer">QRコードの宛先を確認</a></figcaption></figure>` : ""}${submission.content ? `${boardEditor(submission)}<details><summary>提出した作品とレイアウト</summary><ul>${submission.content.works.map((work: AnyRecord) => `<li>${escape(work.title || "無題")}（${escape(work.layout)}）${work.caption ? `<br/>${escape(work.caption)}` : ""}<div class="exhibition-photo-previews">${work.photos.map((photo: AnyRecord) => `<img src="/api/exhibitions/${exhibitionId}/assets/${encodeURIComponent(photo.assetId)}?preview=1" alt="${escape(work.title)}の作品データ" loading="lazy"/>`).join("")}</div></li>`).join("")}</ul></details><div class="exhibition-actions">${submission.candidates.map((candidate: AnyRecord) => `<button class="secondary" data-qr-submission="${submission.id}" data-qr-portfolio="${candidate.portfolioId}">${escape(candidate.name)} のPortfolioを確定</button>`).join("")}${submission.content.portfolioUrl ? `<button class="secondary" data-qr-submission="${submission.id}">外部Portfolio URLを確定</button>` : ""}</div>` : ""}</li>`).join("") || "<li>提出はまだありません。</li>"}</ul><h4>Driveの保存状況</h4><ul class="exhibition-list">${[...(data?.assets ?? []), ...(data?.outputs ?? [])].map((item: AnyRecord) => `<li>${escape(item.name)} · ${item.drive?.status === "delivered" ? `<a href="${escape(item.drive.url)}" target="_blank" rel="noreferrer">保存済み</a>` : "保存待ち"}${item.drive?.error ? `<br/><span class="error">${escape(item.drive.error)}</span>` : ""}</li>`).join("") || "<li>保存対象はまだありません。</li>"}</ul></section>`;
  const navigationHtml = () => `<nav class="exhibition-actions exhibition-admin-nav" aria-label="写真展管理の画面">${[["overview", "通知・参加者・受付設定", ""], ["participants", "参加者一覧", "/participants"], ["form", "フォーム作成", "/form"], ["layout", "展示室・壁面レイアウト", "/layout"], ["submissions", "提出内容・QR確認", "/submissions"]].map(([key,label,suffix]) => `<a class="exhibition-button secondary" ${view === key ? 'aria-current="page"' : ""} href="/Member/manage/exhibitions/${exhibitionId}${suffix}">${label}</a>`).join("")}</nav>`;
  const overviewHtml = () => {
    const exhibition = current(), p = exhibition.participation ?? { state: "draft", votes: {}, recipientIds: [] };
    const unbound = (data?.submissions ?? []).filter((s: AnyRecord) => !s.userId && !s.inactive && !s.imported);
    return `<section><h3>通知・参加投票・入力期間</h3><p>参加投票が終了した後、「参加」の方だけが出展フォームを入力できます。日時は日本時間です。</p><div class="exhibition-form">
      <label>写真展名<input data-setting="title" value="${escape(settingsDraft.title)}"/></label>
      <div class="exhibition-grid"><label>保存先の西暦<input data-setting="year" type="number" min="2000" max="9999" value="${escape(settingsDraft.year)}"/></label><label>受付状態<select data-setting="status">${[["draft", "下書き"], ["open", "受付中"], ["closed", "受付終了"]].map(([value,label]) => `<option value="${value}" ${settingsDraft.status === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>
      <div class="exhibition-grid">${[["voteOpensAt", "参加投票開始"], ["voteClosesAt", "参加投票終了"], ["opensAt", "フォーム入力開始"], ["closesAt", "フォーム入力終了"]].map(([key,label]) => `<label>${label}<input data-setting="${key}" type="datetime-local" value="${escape(settingsDraft[key])}"/></label>`).join("")}</div>
      <fieldset data-recipient-picker><legend>通知先</legend><div class="exhibition-actions"><button type="button" data-select-recipients="all" ${p.state !== "draft" ? "disabled" : ""}>全選択</button><button type="button" data-select-recipients="none" ${p.state !== "draft" ? "disabled" : ""}>全解除</button></div><div class="exhibition-grid"><label>学年別選択<select data-recipient-grade><option value="">すべての学年</option>${Object.entries(gradeLabels).map(([value,label]) => `<option value="${value}">${label}</option>`).join("")}<option value="unknown">学年未設定</option></select></label><label>名前検索<input type="search" data-recipient-search placeholder="名前を入力"/></label></div><div class="exhibition-actions"><button type="button" data-select-recipients="grade-all" ${p.state !== "draft" ? "disabled" : ""}>この学年を選択</button><button type="button" data-select-recipients="grade-none" ${p.state !== "draft" ? "disabled" : ""}>この学年を解除</button></div><p data-recipient-count role="status" aria-live="polite"></p><div class="exhibition-recipient-list">${(data?.users ?? []).map((u: AnyRecord) => `<label class="exhibition-check" data-recipient-name="${escape(u.name)}" data-recipient-grade="${escape(u.grade)}"><input type="checkbox" data-recipient-id="${escape(u.id)}" data-exhibition-recipient="${escape(u.id)}" ${settingsDraft.recipientIds?.includes(u.id) ? "checked" : ""} ${p.state !== "draft" ? "disabled" : ""}/>${escape(u.name)}（${escape(u.gradeLabel)}）</label>`).join("")}</div></fieldset>
      <div class="exhibition-actions"><button data-save-settings>受付設定を保存</button><a class="exhibition-button secondary" href="/Member/manage/exhibitions/${exhibitionId}/participants">参加者一覧</a></div>
      ${p.state === "draft" ? `<label>写真展の通知本文<textarea data-exhibition-notice>参加・不参加・未定をご回答ください。参加投票の終了後、参加者は出展フォームを入力できます。</textarea></label><div class="exhibition-actions"><button data-publish-exhibition>通知を送信して参加投票を公開</button></div>` : `<p class="exhibition-muted">${p.state === "publishing" ? "通知を送信中です。記録後に参加投票が公開されます。" : "通知済みです。締切後の参加変更は参加者一覧ページから行えます。"}</p>`}
      ${unbound.length ? `<p class="exhibition-status error">既存の下書き${unbound.length}件を「提出内容・QR確認」画面で会員に紐付けるか保管対象にしてください。</p>` : ""}
      </div></section>
      <section><h3>Google・Lightroom連携</h3><div class="exhibition-actions"><button class="secondary" data-google-create>${exhibition.googleForms.length ? "Googleフォームに設定を反映" : "Googleフォームを作成"}</button><button class="secondary" data-lightroom-create>${exhibition.albumCreated ? "Lightroomアルバムに設定を反映" : "Lightroomアルバムを作成"}</button></div><p class="exhibition-muted">作成済みの場合は同じフォーム・回答シート・アルバムを更新します。<br/>${exhibition.googleSync?.pending ? `<span class="error">Googleの設定反映を再試行しています。${escape(exhibition.googleSync.error ?? "")}</span><br/>` : ""}${exhibition.albumSync?.pending ? `<span class="error">Lightroomの設定反映を再試行しています。${escape(exhibition.albumSync.error ?? "")}</span><br/>` : ""}Googleフォーム：${exhibition.googleForms.length ? `作成済み` : "未作成"} / Lightroom：${exhibition.albumCreated ? "作成済み" : "未作成"}</p>${exhibition.driveFolders ? `<p><a href="https://drive.google.com/drive/folders/${encodeURIComponent(exhibition.driveFolders.folderId)}" target="_blank" rel="noreferrer">写真展の保存フォルダを開く</a></p>` : ""}</section><section><h3>写真展の削除</h3><p>この写真展と回答・画像を削除し、紐付くGoogleファイルとLightroomアルバムも整理します。削除前のバックアップを保存します。</p><button class="danger" type="button" data-delete-exhibition>この写真展を削除</button></section>`;
  };
  const participantFilters={query:"",vote:"all",submission:"all"};
  const participantsHtml = () => {
    const p=current().participation ?? {state:"draft",votes:{},recipientIds:[]}, enabled=p.state==="published";
    const rows=p.recipientIds.map((id:string)=>{
      const u=(data?.users ?? []).find((u:AnyRecord)=>u.id===id), submission=(data?.submissions ?? []).find((s:AnyRecord)=>s.userId===id && !s.inactive), vote=p.votes[id]?.value ?? "unanswered";
      const stage=submission?.versions.length?"submitted":submission?"draft":"none", name=u?.name ?? submission?.content?.name ?? "退会済み会員";
      return `<li data-participant-row data-participant-name="${escape(name.normalize("NFKC").toLowerCase())}" data-participant-vote="${vote}" data-participant-submission="${stage}"><div><strong>${escape(name)}</strong>（${escape(u?.gradeLabel ?? "学年未設定")}）<p>${{attending:"参加",absent:"不参加",undecided:"未定",unanswered:"未回答"}[vote as string]} · ${{submitted:"提出済み",draft:"下書き",none:"未入力"}[stage]}${submission?.versions.length?` · ${submission.content?.works.length ?? 0}作品`:""}</p></div><div class="exhibition-actions"><select data-attendance-user="${escape(id)}" aria-label="${escape(name)}の参加状況" ${enabled&&u?"":"disabled"}><option value="">未回答</option>${[["attending","参加"],["absent","不参加"],["undecided","未定"]].map(([v,l])=>`<option value="${v}" ${vote===v?"selected":""}>${l}</option>`).join("")}</select><button class="secondary" data-save-attendance="${escape(id)}" ${enabled&&u?"":"disabled"}>参加状況を保存</button></div></li>`;
    }).join("");
    return `<section><h3>参加者一覧</h3><p>通知対象者全員の参加回答と提出状況を確認できます。</p><div class="exhibition-grid"><label>名前検索<input type="search" data-participant-filter="query" value="${escape(participantFilters.query)}"/></label><label>参加回答<select data-participant-filter="vote">${[["all","すべて"],["attending","参加"],["absent","不参加"],["undecided","未定"],["unanswered","未回答"]].map(([v,l])=>`<option value="${v}" ${participantFilters.vote===v?"selected":""}>${l}</option>`).join("")}</select></label><label>提出状況<select data-participant-filter="submission">${[["all","すべて"],["submitted","提出済み"],["draft","下書き"],["none","未入力"]].map(([v,l])=>`<option value="${v}" ${participantFilters.submission===v?"selected":""}>${l}</option>`).join("")}</select></label></div><p data-participant-count role="status"></p><ul class="exhibition-list exhibition-participants">${rows || "<li>通知対象者はまだいません。</li>"}</ul>${enabled?`<label class="exhibition-field">通知対象者を追加<select data-add-attendee><option value="">会員を選択</option>${(data?.users ?? []).filter((u:AnyRecord)=>!p.recipientIds.includes(u.id)).map((u:AnyRecord)=>`<option value="${escape(u.id)}">${escape(u.name)}</option>`).join("")}</select></label><button class="secondary" data-attendee-add>参加者として追加・通知</button>`:"<p>通知を公開すると参加状況を変更できます。</p>"}</section>`;
  };
  const filterParticipants = () => {
    const rows=[...root.querySelectorAll<HTMLElement>("[data-participant-row]")];
    rows.forEach(row=>{row.hidden=!(row.dataset.participantName!.includes(participantFilters.query.normalize("NFKC").toLowerCase()) && (participantFilters.vote==="all"||row.dataset.participantVote===participantFilters.vote) && (participantFilters.submission==="all"||row.dataset.participantSubmission===participantFilters.submission));});
    const count=root.querySelector<HTMLElement>("[data-participant-count]");if(count)count.textContent=`${rows.filter(r=>!r.hidden).length} / ${rows.length}人を表示`;
  };
  const bindRoomControls = (root:HTMLElement) => {
    root.querySelector<HTMLInputElement>("[data-room-template-name]")?.addEventListener("input", event => { templateName = (event.target as HTMLInputElement).value; });
    root.querySelector<HTMLSelectElement>("[data-room-template-choice]")?.addEventListener("change", event => { selectedTemplate = (event.target as HTMLSelectElement).value; templateName = roomTemplates.find(t => t.id === selectedTemplate)?.name ?? ""; render(); });
    root.querySelector<HTMLButtonElement>("[data-room-template-load]")?.addEventListener("click", () => { const template = roomTemplates.find(t => t.id === selectedTemplate); if (!template) return; if (roomsDraft.length >= 30) { message("展示室は30件までです。", true); return; } layoutEditor.edit(()=>{roomsDraft.push(reusableRoom(template.room,template.name));activeRoom=roomsDraft.length-1;}); message("保存済み展示室を追加しました。レイアウトを保存するとこの写真展に反映されます。"); });
    root.querySelectorAll<HTMLButtonElement>("[data-room-template-save], [data-room-template-update]").forEach(button => button.addEventListener("click", async () => {
      const selected = roomTemplates.find(t => t.id === selectedTemplate), updating = button.hasAttribute("data-room-template-update");
      if (!room() || updating && !selected) return;
      templateName = root.querySelector<HTMLInputElement>("[data-room-template-name]")?.value ?? "";
      root.querySelectorAll<HTMLButtonElement>("[data-room-template-save], [data-room-template-update]").forEach(b => b.disabled = true);
      try {
        const response = await fetch("/api/member/exhibition-rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", name: templateName, room: structuredClone(room()), ...(updating ? { id: selected!.id, revision: selected!.revision } : {}) }) });
        const result = await readExhibitionResponse(response);
        if (!response.ok || !result.ok) throw new Error(result.message ?? "保存できませんでした。");
        roomTemplates = result.templates; selectedTemplate = roomTemplates.find(t => t.name === templateName.trim())?.id ?? ""; templateName = templateName.trim(); render(); message("再利用できる展示室を保存しました。");
      } catch (error) { render(); message(error instanceof Error ? error.message : "保存できませんでした。", true); }
    }));
    root.querySelector<HTMLInputElement>('[data-room-root="name"]')?.addEventListener("change",event=>{layoutEditor.edit(()=>{room().name=(event.target as HTMLInputElement).value;});});
    root.querySelectorAll<HTMLButtonElement>("[data-room-select]").forEach(button => button.addEventListener("click", () => { activeRoom = Number(button.dataset.roomSelect); render(); }));
    root.querySelector<HTMLButtonElement>("[data-room-add]")?.addEventListener("click", () => { if(roomsDraft.length>=30){message("展示室は30件までです。",true);return;}layoutEditor.edit(()=>{roomsDraft.push(defaultRoom());activeRoom=roomsDraft.length-1;}); });
    root.querySelector<HTMLButtonElement>("[data-room-delete]")?.addEventListener("click", () => { layoutEditor.edit(()=>{roomsDraft.splice(activeRoom,1);activeRoom=Math.max(0,activeRoom-1);}); });
    const saveRoomButton=root.querySelector<HTMLButtonElement>("[data-save-rooms]");
    if(saveRoomButton&&!saveRoomButton.dataset.bound){saveRoomButton.dataset.bound="true";saveRoomButton.addEventListener("click",async()=>{await layoutEditorSave();});}
    root.querySelector("[data-layout-history]")?.addEventListener("click",()=>void layoutHistory.open());
    root.querySelectorAll<HTMLButtonElement>("[data-output-room]").forEach(button=>button.addEventListener('click',async()=>{const kind=button.dataset.outputRoom??'layout-png',r=room();if(!r)return;if(kind!=='layout-png'){await outputDownload(kind,kind==='layout-svg'?r.id:'');return;}if(!layoutEditor.finishEditing()||!await layoutSync?.flush())return;if(isDirty()){message('変更内容を保存してから出力してください。',true);return;}await openLayoutPngPreview({exhibitionId,roomId:r.id,name:r.name,download:(view,page,sha)=>outputDownload('layout-png',r.id,view,page,sha),message});}));
  };
  const roomHtml = () => {
    const layout=room(),preview=layout?roomPreview(layout as RoomLayout,works(),{width:Math.min(650,root.clientWidth),imageUrl:id=>`/api/member/exhibitions/${exhibitionId}/layout-assets/${id}?preview=1`}):undefined;return `<section><h3>展示室と壁面レイアウト</h3><div class="exhibition-actions">${roomsDraft.map((r:AnyRecord,i:number)=>`<button class="secondary" data-room-select="${i}" aria-pressed="${activeRoom===i}">${escape(r.name)}</button>`).join("")}<button class="secondary" data-room-add>展示室を追加</button><button class="secondary" data-layout-history>保存履歴</button></div>${libraryHtml()}${layout?`<label>展示室名<input data-room-root="name" value="${escape(layout.name)}"/></label><div class="exhibition-actions"><button data-open-room-editor="floor">展示室の編集</button><button data-open-room-editor="wall">壁面の編集</button><button class="danger" data-room-delete ${roomsDraft.length<=1?"disabled":""}>この展示室を削除</button></div><svg class="room-summary-preview" viewBox="${preview!.viewBox}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="展示室の概要"><title>${escape(layout.name)}のプレビュー</title>${preview!.svg}</svg><div class="exhibition-actions"><button data-save-rooms>展示室レイアウトを保存</button><button class="secondary" data-output-room="layout-pdf">PDFで出力</button><button class="secondary" data-output-room="layout-png">PNGで出力</button><button class="secondary" data-output-room="layout-svg">SVGで出力</button></div>`:"<p>展示室を追加してください。</p>"}</section>`;
  };
  const layoutEditor=createLayoutEditor({openHistory:()=>void layoutHistory.open(),
    getRooms:()=>roomsDraft as RoomLayout[],setRooms:replaceRooms,getRoomIndex:()=>activeRoom,getWorks:()=>works() as Work[],
    getImages:()=>data?.layoutAssets??[],uploadImage:async(file,id)=>{const form=new FormData();form.set("assetId",id);form.set("file",file);const response=await fetch(`/api/member/exhibitions/${exhibitionId}/layout-assets/upload`,{method:"POST",body:form}),result=await readExhibitionResponse(response);if(!response.ok)throw new Error(result.message);data!.layoutAssets=[...(data?.layoutAssets??[]).filter((a:AnyRecord)=>a.id!==id),result.asset];return result.asset;},
    userId:()=>layoutSync?.actorId()??"",imageUrl:id=>`/api/member/exhibitions/${exhibitionId}/layout-assets/${id}?preview=1`,
    assetUrl:id=>`/api/exhibitions/${exhibitionId}/assets/${id}?preview=1`,
    cardUrl:id=>{const value=JSON.stringify([works().find((w:AnyRecord)=>w.id===id),(data?.submissions??[]).find((s:AnyRecord)=>s.content?.works?.some((w:AnyRecord)=>w.id===id))?.revision]);let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}return `/api/member/exhibitions/${exhibitionId}/output?kind=board-preview&workId=${id}&content=${hash>>>0}`;},
    cardStatus:async id=>{const r=await fetch(`/api/member/exhibitions/${exhibitionId}/output?kind=board-preview&workId=${id}&status=1`),value=await readExhibitionResponse(r);if(!r.ok)throw new Error(value.message);return value.issues;},
    save:async()=>{if(boardDirty){message("編集中のタイトルボードを保存してください。",true);return false;}if(await layoutSync?.flush()){message("展示室レイアウトを保存しました。");return true;}return false;},
    isDirty:()=>!!layoutSync?.hasPending()||JSON.stringify(roomsDraft)!==savedRooms,discard:()=>{roomsDraft=JSON.parse(savedRooms);},change:()=>render(),message,
    beginEdit:keys=>layoutSync?.begin(keys)??false,endEdit:()=>layoutSync?.idle(),commit:(before,after)=>layoutSync?.commit(before,after),undo:async redo=>{await layoutSync?.undo(redo);},canUndo:()=>layoutSync?.canUndo()??false,canRedo:()=>layoutSync?.canRedo()??false,peers:()=>layoutSync?.getPresence()??{peers:[],leases:[]},clientId:()=>layoutSync?.clientId??"",cursor:value=>layoutSync?.publishCursor(value)
  });
  pendingLayoutEdits=layoutEditor.hasPendingEdits;
  if(view==="layout")layoutSync=createLayoutSync({exhibitionId,getRooms:()=>roomsDraft as RoomLayout[],setRooms:replaceRooms,paintingBusy:()=>pointerBusy,busy:()=>layoutEditor.isInteracting()||!!(document.activeElement instanceof Element&&root.contains(document.activeElement)&&document.activeElement.matches('input,textarea,select')),
    snapshot:value=>{if(!data)return;data.exhibition.rooms=value.rooms;data.exhibition.layoutRevision=value.revision;data.exhibition.revision=value.exhibitionRevision;data.exhibition.layoutCurrent=value.history[0];data.layoutWorks=value.works;data.layoutAssets=value.layoutAssets;savedRooms=JSON.stringify(value.rooms);activeRoom=Math.min(activeRoom,Math.max(0,roomsDraft.length-1));},
    refresh:()=>{activeRoom=Math.min(activeRoom,Math.max(0,roomsDraft.length-1));if(roomModal?.open&&!roomsDraft.length)roomModal.close();render();},peersChanged:()=>{layoutEditor.syncState();roomModal?.querySelector<HTMLButtonElement>('[data-layout-recover]')?.toggleAttribute('hidden',!layoutSync?.canRecover());},status:(value,error)=>{syncMessage=value;roomModal?.querySelectorAll<HTMLElement>('[data-layout-sync-status]').forEach(el=>{el.textContent=value;el.classList.toggle('error',!!error);});if(error)message(value,true);}});
  const releasePointer=()=>{window.setTimeout(()=>{pointerBusy=false;layoutSync?.idle();},0);};window.addEventListener('pointerdown',event=>{const target=event.target as Node;if(view==='layout'&&(root.contains(target)||roomModal?.contains(target)))pointerBusy=true;},true);window.addEventListener('pointerup',releasePointer);window.addEventListener('pointercancel',releasePointer);window.addEventListener('blur',releasePointer);root.addEventListener('focusout',()=>layoutSync?.idle());
  const layoutEditorSave=async()=>{if(!layoutEditor.finishEditing())return;if(await layoutSync?.flush())message("展示室レイアウトを保存しました。");};
  const layoutHistory=createLayoutHistory({exhibitionId,finish:async()=>layoutEditor.finishEditing()&&!!await layoutSync?.flush(),restore:async(id,revision,rooms)=>!!await layoutSync?.restore(id,revision,rooms),restored:()=>{layoutEditor.cancel();layoutEditor.resetHistory();render();},message,assetUrl:id=>`/api/exhibitions/${exhibitionId}/assets/${id}?preview=1`,imageUrl:id=>`/api/member/exhibitions/${exhibitionId}/layout-assets/${id}?preview=1`});
  const closeRoomEditor = () => { void layoutEditor.requestClose(); };
  const renderRoomModal = () => { if(roomModal?.open)layoutEditor.refresh(); };
  const openRoomEditor = (mode:"floor"|"wall") => {
    if(!room())return;
    if(!roomModal){roomModal=document.createElement("dialog");roomModal.className="exhibition-dialog exhibition-page room-edit-dialog";roomModal.setAttribute("aria-labelledby","room-edit-title");roomModal.innerHTML='<header><h2 id="room-edit-title" data-room-modal-title>展示室・壁面レイアウト</h2><button type="button" class="layout-close" data-room-modal-close aria-label="編集画面を閉じる"><span></span><span></span></button></header><div class="layout-sync-status"><span data-layout-sync-status role="status"></span><button type="button" class="secondary" data-layout-recover hidden>未送信の変更を保管して最新を表示</button></div><div data-room-modal-content></div>';document.body.append(roomModal);roomModal.querySelector('[data-layout-recover]')!.addEventListener('click',()=>layoutSync?.recover());roomModal.querySelector("[data-room-modal-close]")!.addEventListener("click",closeRoomEditor);roomModal.addEventListener("cancel",event=>{event.preventDefault();closeRoomEditor();});roomModal.addEventListener("close",()=>{layoutEditor.cancel();document.body.style.overflow=previousRoomOverflow;(previousRoomFocus?.isConnected?previousRoomFocus:root.querySelector<HTMLElement>('[data-open-room-editor],[data-room-add]'))?.focus({preventScroll:true});});}
    previousRoomFocus=document.activeElement as HTMLElement;previousRoomOverflow=document.body.style.overflow;document.body.style.overflow="hidden";roomModal.showModal();roomModal.querySelector<HTMLElement>("[data-layout-sync-status]")!.textContent=syncMessage;layoutEditor.mount(roomModal.querySelector<HTMLElement>("[data-room-modal-content]")!,mode==="wall"?"wall:0":"floor");
  };
  const render = () => {
    if (!data) return;
    roomPreviewObserver?.disconnect();
    root.innerHTML = `<p><a class="member-back" href="/Member/manage/exhibitions">写真展一覧へ戻る</a></p><h2>${escape(current().title)}</h2>${navigationHtml()}<p class="exhibition-status" aria-live="polite"></p><div class="exhibition-editor">${view === "form" ? schemaHtml() : view === "layout" ? roomHtml() : view === "submissions" ? submissionsHtml() : view === "participants" ? participantsHtml() : overviewHtml()}</div>`;
    bind();
    const preview=root.querySelector<SVGSVGElement>(".room-summary-preview");
    if(preview){
      const paint=()=>{const layout=room();if(!layout||!preview.isConnected)return;const {width,height}=preview.getBoundingClientRect(),scene=roomPreview(layout as RoomLayout,works(),{width,height,imageUrl:id=>`/api/member/exhibitions/${exhibitionId}/layout-assets/${id}?preview=1`});preview.setAttribute("viewBox",scene.viewBox);preview.innerHTML=`<title>${escape(layout.name)}のプレビュー</title>${scene.svg}`;};
      roomPreviewObserver=new ResizeObserver(paint);roomPreviewObserver.observe(preview);paint();
    }
  };
  const bind = () => {
    root.querySelector<HTMLButtonElement>("[data-delete-exhibition]")?.addEventListener("click", () => {
      const dialog=document.createElement("dialog");dialog.className="exhibition-confirm-dialog exhibition-page";dialog.setAttribute("aria-label","写真展の削除確認");
      dialog.innerHTML=`<header class="exhibition-confirm-header"><h2>Delete</h2></header><p>「${escape(current().title)}」と回答・画像を削除します。紐付くGoogleファイルはゴミ箱へ移動し、Lightroomアルバムは削除します。バックアップを保持します。</p><label class="exhibition-field">確認のため写真展名を入力<input data-delete-title autocomplete="off"/></label><p data-delete-status role="status"></p><div class="exhibition-actions"><button class="danger" type="button" data-delete-confirm disabled>削除する</button><button type="button" data-delete-cancel>キャンセル</button></div>`;
      document.body.append(dialog);const confirm=dialog.querySelector<HTMLButtonElement>("[data-delete-confirm]")!,input=dialog.querySelector<HTMLInputElement>("[data-delete-title]")!;
      input.addEventListener("input",()=>{confirm.disabled=input.value!==current().title;});dialog.querySelector("[data-delete-cancel]")!.addEventListener("click",()=>dialog.close());dialog.addEventListener("close",()=>dialog.remove(),{once:true});
      confirm.addEventListener("click",async()=>{confirm.disabled=true;try{await api({action:"delete",exhibitionId,revision:current().revision,confirmation:input.value});boardDirty=false;savedSettings=JSON.stringify(settingsDraft);savedSchema=JSON.stringify(schemaDraft);savedRooms=JSON.stringify(roomsDraft);flashNotice("写真展を削除しました。外部ファイルの整理も順次実行します。");location.href="/Member/manage/exhibitions?deleted=1";}catch(error){dialog.querySelector<HTMLElement>("[data-delete-status]")!.textContent=error instanceof Error?error.message:"削除できませんでした。";confirm.disabled=false;}});dialog.showModal();
    });
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-board-common], [data-board-key]").forEach(input => input.addEventListener("input", () => { boardDirty = true; }));
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach(input => input.addEventListener("input", () => { settingsDraft[input.dataset.setting!] = input.value; }));
    root.querySelectorAll<HTMLElement>("[data-recipient-picker]").forEach(picker => bindRecipientPicker(picker, ids => { settingsDraft.recipientIds = ids; }));
    filterParticipants();
    root.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-participant-filter]").forEach(input=>input.addEventListener("input",()=>{participantFilters[input.dataset.participantFilter as keyof typeof participantFilters]=input.value;filterParticipants();}));
    root.querySelector<HTMLButtonElement>("[data-publish-exhibition]")?.addEventListener("click", () => mutate({ action: "participation.publish", exhibitionId, revision: current().revision, body: root.querySelector<HTMLTextAreaElement>("[data-exhibition-notice]")?.value }, "通知を送信しています。参加投票は通知の記録後に公開されます。"));
    root.querySelectorAll<HTMLButtonElement>("[data-save-attendance]").forEach(button => button.addEventListener("click", () => { const input = [...root.querySelectorAll<HTMLSelectElement>("[data-attendance-user]")].find(i => i.dataset.attendanceUser === button.dataset.saveAttendance); if (input?.value) void mutate({ action: "participation.attendance.set", exhibitionId, revision: current().revision, userId: button.dataset.saveAttendance, vote: input.value }, "参加状況を保存しました。"); }));
    root.querySelector<HTMLButtonElement>("[data-attendee-add]")?.addEventListener("click", () => { const userId = root.querySelector<HTMLSelectElement>("[data-add-attendee]")?.value; if (userId) void mutate({ action: "participation.attendance.set", exhibitionId, revision: current().revision, userId, vote: "attending" }, "参加者に追加しました。"); });
    root.querySelectorAll<HTMLButtonElement>("[data-bind-submission], [data-archive-submission]").forEach(button => button.addEventListener("click", () => { const submissionId = button.dataset.bindSubmission ?? button.dataset.archiveSubmission, s = data!.submissions.find((s: AnyRecord) => s.id === submissionId), input = [...root.querySelectorAll<HTMLSelectElement>("[data-bind-user]")].find(i => i.dataset.bindUser === submissionId); if (s && (button.dataset.archiveSubmission || input?.value)) void mutate({ action: "submission.bind", exhibitionId, revision: current().revision, submissionId, submissionRevision: s.revision, archive: !!button.dataset.archiveSubmission, userId: input?.value }, "下書きの紐付けを保存しました。"); }));

    root.querySelector<HTMLInputElement>('[data-total-work-limit]')?.addEventListener('input',e=>{const input=e.target as HTMLInputElement;schemaDraft!.limits??={};if(input.value==='')delete schemaDraft!.limits.maxWorks;else schemaDraft!.limits.maxWorks=input.valueAsNumber;});
    root.querySelectorAll<HTMLInputElement>('[data-section-limit]').forEach(input=>input.addEventListener('input',()=>{const section=schemaDraft!.sections[Number(input.dataset.limitSection)];section.limits??={};const key=input.dataset.sectionLimit!;if(input.value==='')delete section.limits[key];else section.limits[key]=input.valueAsNumber;}));
    const updateFrames=(index:number,values:string[])=>{const section=schemaDraft!.sections[index];section.limits??={};section.limits.frameSizeIds=[...new Set(values)];render();root.querySelector<HTMLSelectElement>(`[data-limit-frame-select][data-limit-section="${index}"]`)?.focus({preventScroll:true});};
    root.querySelectorAll<HTMLSelectElement>('[data-limit-frame-select]').forEach(input=>input.addEventListener('change',()=>{if(!input.value)return;const index=Number(input.dataset.limitSection);updateFrames(index,input.value==='none'?[]:[...(schemaDraft!.sections[index].limits?.frameSizeIds??[]),input.value]);}));
    root.querySelectorAll<HTMLButtonElement>('[data-remove-limit-frame]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.limitSection);updateFrames(index,(schemaDraft!.sections[index].limits?.frameSizeIds??[]).filter((id:string)=>id!==button.dataset.removeLimitFrame));}));
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-section-key], [data-field-key]").forEach(input => input.addEventListener("input", () => updateSchemaInput(input)));
    root.querySelectorAll<HTMLButtonElement>("[data-add-section]").forEach(button => button.addEventListener("click", () => { schemaDraft!.sections.push({ id: uuid(), title: "企画展タイトル", description: "" }); render(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-section]").forEach(button => button.addEventListener("click", () => { const removed = schemaDraft!.sections[Number(button.dataset.removeSection)]; schemaDraft!.sections.splice(Number(button.dataset.removeSection), 1); schemaDraft!.fields = schemaDraft!.fields.filter((field: AnyRecord) => field.sectionId !== removed?.id); render(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-add-field]").forEach(button => button.addEventListener("click", () => { schemaDraft!.fields.push({ id: uuid(), label: "追加質問", description: "", type: "text", scope: "common", required: false, options: [] }); render(); }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-field]").forEach(button => button.addEventListener("click", () => { schemaDraft!.fields.splice(Number(button.dataset.removeField), 1); render(); }));
    root.querySelector<HTMLButtonElement>("[data-save-settings]")?.addEventListener("click", async () => { const values: AnyRecord = { gallery: current().gallery }; root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-setting]").forEach(input => values[input.dataset.setting ?? ""] = input.type === "datetime-local" && input.value ? new Date(`${input.value}+09:00`).toISOString() : input.dataset.setting === "year" ? Number(input.value) : input.value); if ((current().participation?.state ?? "draft") === "draft") values.recipientIds = settingsDraft.recipientIds; await mutate({ action: "settings", exhibitionId, revision: current().revision, ...values }, "受付設定を保存しました。"); });
    root.querySelector<HTMLButtonElement>("[data-save-schema]")?.addEventListener("click", () => openSchemaPreview());
    root.querySelector<HTMLButtonElement>("[data-google-create]")?.addEventListener("click", async () => await mutate({ action: "google.create", exhibitionId, revision: current().revision }, "Googleフォームに設定を反映しました。"));
    root.querySelector<HTMLButtonElement>("[data-google-import]")?.addEventListener("click", async () => { const sourceSpreadsheetId = root.querySelector<HTMLInputElement>("[data-import-sheet]")?.value.trim() ?? ""; if (!sourceSpreadsheetId) { message("既存回答スプレッドシートIDを入力してください。", true); return; } await mutate({ action: "google.import", exhibitionId, revision: current().revision, sourceSpreadsheetId }, "既存回答を取り込みました。"); });
    root.querySelector<HTMLButtonElement>("[data-lightroom-create]")?.addEventListener("click", async () => await mutate({ action: "lightroom.create", exhibitionId, revision: current().revision }, "Lightroomアルバムに設定を反映しました。"));
    bindRoomControls(root);
    root.querySelectorAll<HTMLButtonElement>("[data-open-room-editor]").forEach(button=>button.addEventListener("click",()=>openRoomEditor(button.dataset.openRoomEditor as "floor"|"wall")));
    root.querySelector<HTMLButtonElement>("[data-output-boards]")?.addEventListener("click", () => outputDownload("boards"));
    root.querySelector<HTMLButtonElement>("[data-retry]")?.addEventListener("click", async () => await mutate({ action: "retry", exhibitionId, revision: current().revision }, "未送信のGoogleフォーム連携を再試行します。"));
    root.querySelectorAll<HTMLElement>("[data-board-editor]").forEach(editor=>{const submission=data!.submissions.find((item:AnyRecord)=>item.id===editor.dataset.boardEditor);if(submission?.content)bindTextValidation(editor,()=>boardContent(editor,submission));});
    root.querySelectorAll<HTMLButtonElement>("[data-save-board]").forEach(button => button.addEventListener("click", async () => {
      const submission = data!.submissions.find((item: AnyRecord) => item.id === button.dataset.saveBoard), editor = button.closest<HTMLElement>("[data-board-editor]");
      if (!submission || !editor) return;
      try {await ensureTextMeasurement();}catch{}const fullContent=boardContent(editor,submission);
      if(validateTextFields(editor,fullContent).length){message("タイトルボードの文字量を確認してください。",true);return;}
      const content: AnyRecord = { works: [] };
      editor.querySelectorAll<HTMLInputElement>("[data-board-common]").forEach(input => content[input.dataset.boardCommon!] = input.value);
      editor.querySelectorAll<HTMLElement>("[data-board-work]").forEach(fieldset => {
        const work: AnyRecord = { id: fieldset.dataset.boardWork };
        fieldset.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-board-key]").forEach(input => work[input.dataset.boardKey!] = input.value);
        content.works.push(work);
      });
      await mutate({ action: "submission.board", exhibitionId, revision: current().revision, submissionId: submission.id, submissionRevision: submission.revision, content }, "タイトルボードの内容を修正しました。");
    }));
    renderRoomModal();
    root.querySelectorAll<HTMLButtonElement>("[data-qr-submission]").forEach(button => button.addEventListener("click", async () => await mutate({ action: "qr", exhibitionId, revision: current().revision, submissionId: button.dataset.qrSubmission, ...(button.dataset.qrPortfolio ? { portfolioId: button.dataset.qrPortfolio } : {}) }, "Portfolio QRを確定しました。")));
  };
  const mutate = async (body: AnyRecord, success: string) => {
    if (boardDirty && body.action !== "submission.board") { message("編集中のタイトルボードを保存してください。", true); return; }
    if (["participation.publish", "google.create"].includes(body.action) && JSON.stringify(settingsDraft) !== savedSettings) { message("受付設定の変更を保存してから操作してください。", true); return; }
    message("保存しています…");
    try { const result = await api(body); if (body.action === "submission.board") boardDirty = false; await load(body.action !== "schema", body.action !== "rooms", body.action !== "settings"); message(result.imported?.issues?.length ? `${success}\n${result.imported.issues.join("\n")}` : success); return true; }
    catch (error) { message(error instanceof Error ? error.message : "保存できませんでした。", true); return false; }
  };
  const openSchemaPreview = () => {
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-total-work-limit], [data-section-limit]')) if (!input.reportValidity()) return;
    for (const section of schemaDraft!.sections) {
      const rule = section.limits;
      if (rule?.maxLongEdgeMm !== undefined && rule?.maxShortEdgeMm !== undefined && rule.maxLongEdgeMm < rule.maxShortEdgeMm) { message("長辺の上限は短辺の上限以上にしてください。", true); return; }
    }
    const draft = structuredClone(schemaDraft!);
    const dialog = document.createElement("dialog");
    dialog.className = "exhibition-confirm-dialog exhibition-page";
    dialog.setAttribute("aria-label", "保存前のフォームプレビュー");
    dialog.innerHTML = `<header class="exhibition-confirm-header"><h2>Preview</h2><button type="button" data-preview-close aria-label="戻って編集">×</button></header><p>保存後のフォームを確認してください。プレビュー内では入力できません。</p>${formPreviewHtml(current().title,draft as FormSchema)}<p data-preview-status role="status"></p><div class="exhibition-actions"><button type="button" data-confirm-schema>この内容で保存</button><button type="button" class="secondary" data-preview-close>戻って編集</button></div>`;
    document.body.append(dialog);
    const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";let saving=false;
    dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
    dialog.querySelectorAll<HTMLButtonElement>("[data-preview-close]").forEach(button => button.addEventListener("click", () => {if(!saving)dialog.close();}));
    dialog.addEventListener("close", () => { document.body.style.overflow=previousOverflow;dialog.remove(); root.querySelector<HTMLButtonElement>("[data-save-schema]")?.focus(); }, {once:true});
    dialog.querySelector<HTMLButtonElement>("[data-confirm-schema]")!.addEventListener("click", async event => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;saving=true; dialog.querySelector<HTMLElement>("[data-preview-status]")!.textContent = "保存しています…";
      if (await mutate({action:"schema",exhibitionId,revision:current().revision,schema:draft},"フォームを保存しました。作成済みのGoogleフォームにも設定を反映します。")) dialog.close();
      else { dialog.querySelector<HTMLElement>("[data-preview-status]")!.textContent = root.querySelector(".exhibition-status")?.textContent ?? "保存できませんでした。"; button.disabled = false;saving=false; }
    });
    dialog.showModal();
  };
  const load = async (preserveSchema = false, preserveRooms = false, preserveSettings = false) => {
    try {
      const response = await fetch(`/api/member/exhibitions/${exhibitionId}`), result = await readExhibitionResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message ?? "読み込めませんでした。");
      if (view === "layout") {
        const libraryResponse = await fetch("/api/member/exhibition-rooms"), library = await readExhibitionResponse(libraryResponse);
        if (!libraryResponse.ok || !library.ok) throw new Error(library.message ?? "保存済み展示室を読めませんでした。");
        roomTemplates = library.templates;
      }
      data = result; if (!preserveSettings) settingsDraft = { title: current().title, status: current().status, year: current().year ?? new Date(current().createdAt).getFullYear(), opensAt: localDateTime(current().opensAt), closesAt: localDateTime(current().closesAt), voteOpensAt: localDateTime(current().participation?.opensAt ?? ""), voteClosesAt: localDateTime(current().participation?.closesAt ?? ""), recipientIds: current().participation?.recipientIds ?? (data?.users ?? []).map((u: AnyRecord) => u.id) }; if (!preserveSchema) schemaDraft = structuredClone(current().schemas.at(-1)); if (!preserveRooms) roomsDraft = structuredClone(current().rooms); activeRoom = Math.min(activeRoom, Math.max(0, roomsDraft.length - 1));
      if (!preserveSettings) savedSettings = JSON.stringify(settingsDraft);
      if (!preserveSchema) savedSchema = JSON.stringify(schemaDraft);
      if (!preserveRooms) savedRooms = JSON.stringify(roomsDraft);
      if(view==="layout")await layoutSync?.connect();
      render();
    } catch (error) { root.innerHTML = `<p class="exhibition-status error">${escape(error instanceof Error ? error.message : "写真展を読み込めませんでした。")}</p>`; }
  };
  const noticePoll = window.setInterval(() => { if (data?.exhibition?.participation?.state === "publishing" && !isDirty()) void load(true, true, true); }, 5000);
  window.addEventListener("pagehide", () => window.clearInterval(noticePoll), { once: true });
  void load();
}
