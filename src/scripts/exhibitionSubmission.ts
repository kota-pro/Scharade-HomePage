import {watchAdvisoryClock,paintDeadlineWarning} from './advisoryDeadlineUi.ts';
import {deadlinePassed} from '../lib/advisoryWarnings.ts';
import { photoExifEditor, bindPhotoExifEditor } from "./photoExifEditor";
import {titleBoardFieldsHtml,bindTitleBoardFields} from './exhibitionTitleBoardFields.ts';
import { exhibitionGradeOptionsHtml, normalizeExhibitionGrade } from "../lib/exhibitionGrades.ts";
import { exhibitionNotesLimit } from "../lib/exhibitionNotes.ts";
import { createDraftSync, DraftSaveError, type DraftSyncState } from "./exhibitionDraftSync.ts";
import { emptyWorkDetails, metadataStrings, prefectures } from "../lib/exhibitionText.ts";
import { bindTextValidation, ensureTextMeasurement, validateTextFields, metadataLineHint, setServerTextIssues } from "./exhibitionTextValidation";
import { formatExhibitionError, type ExhibitionErrorCode } from '../lib/exhibitionErrors.ts';
import { operationNotice } from "./siteNotice";
export {};
import { createSeriesDialog as createSeriesEditor } from "./exhibitionSeriesDialog";
import { paperSizes, paperSizeId } from "../lib/exhibitionEditing.ts";
import { readExhibitionResponse } from "./exhibitionResponse";
import {overdueWarningHtml,warningMark} from '../lib/advisoryWarnings.ts';
import { describeSectionLimits, sectionWorkCount, submissionLimitIssues } from "../lib/exhibitionSubmissionLimits.ts";
import type { EffectiveSubmissionLimits, Work, PhotoLayout, SubmissionContent } from "../lib/exhibitionTypes.ts";
type AnyRecord = Record<string, any>;

const root = document.querySelector<HTMLElement>("#exhibition-submission");
if (root) {
  const exhibitionId = root.dataset.exhibitionId ?? "";
  let payload: AnyRecord | null = null;
  const deadlineClock=watchAdvisoryClock(()=>paintDeadlineWarning(root.querySelector('[data-submission-deadline]'),!!payload?.exhibition.accepting&&deadlinePassed(payload?.exhibition.closesAt)),()=>[payload?.exhibition.closesAt]);
  let token = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const ownerId = root.dataset.ownerId ?? "";
  let busy = false, composing = false;
  let draftSync: ReturnType<typeof createDraftSync<AnyRecord>> | undefined;
  let syncState: DraftSyncState = { kind: "saved", local: false };
  window.addEventListener("beforeunload", event => {
    if (payload?.submission && !payload.preview && (busy || draftSync?.dirty() && !draftSync.persist())) { event.preventDefault(); event.returnValue = ""; }
  });
  window.addEventListener("pagehide", () => draftSync?.persist());
  window.addEventListener("online", () => void draftSync?.resume());
  window.addEventListener("pageshow", event => { if (event.persisted) void draftSync?.resume(); });
  root.addEventListener("compositionstart", () => { composing = true; });
  root.addEventListener("compositionend", () => { composing = false; draftSync?.touch(); });
  for (const event of ["input", "change"]) root.addEventListener(event, () => draftSync?.touch());
  let currentStatus = { message: "", error: false };

  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
  const uuid = () => crypto.randomUUID();
  const emptyContent = () => ({ name: "", grade: "", authorName: "", portfolioUrl: "", fields: {}, sections: [], works: [] as AnyRecord[] });
  const content = (): AnyRecord => {
    if (!payload?.submission) return emptyContent();
    const draft = payload.submission.draft;
    draft.fields ??= {}; draft.sections ??= []; draft.works ??= [];
    return draft;
  };
  const status = (message: string, error = false, announce = true, code?: ExhibitionErrorCode) => {
    if (error) message = formatExhibitionError(message, code);
    if(announce) operationNotice(message,error,"exhibition-submission");
    currentStatus = { message, error };
    const target = root.querySelector<HTMLElement>(".exhibition-status");
    if (target) { target.textContent = message; target.className = `exhibition-status${error ? " error" : message ? " success" : ""}`; }
  };
  const number = (value: string, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const fieldApplies = (field: AnyRecord, scope: string, sectionId?: string, kind?: string) => field.scope === scope && (!field.sectionId || field.sectionId === sectionId) && (!field.kinds?.length || field.kinds.includes(kind));
  const fieldsFor = (scope: string, sectionId?: string, kind?: string) => (payload?.schema?.fields ?? []).filter((field: AnyRecord) => fieldApplies(field, scope, sectionId, kind));
  const fieldControl = (field: AnyRecord, value: any, scope: string, workId = "", sectionId = "") => {
    const key = `data-field-scope="${scope}" data-field-id="${field.id}" data-work-id="${workId}" data-section-id="${sectionId}"`;
    const label = `<label class="exhibition-field ${field.required ? "required" : ""}">${escape(field.label)}${field.description ? `<small class="exhibition-muted">${escape(field.description)}</small>` : ""}`;
    if (field.type === "paragraph") return `${label}<textarea ${key}>${escape(value ?? "")}</textarea></label>`;
    if (field.type === "select") return `${label}<select ${key}><option value="">選択してください</option>${field.options.map((option: string) => `<option ${value === option ? "selected" : ""} value="${escape(option)}">${escape(option)}</option>`).join("")}</select></label>`;
    if (field.type === "checkbox") return `<fieldset class="exhibition-field"><legend>${escape(field.label)}</legend>${field.description ? `<small class="exhibition-muted">${escape(field.description)}</small>` : ""}<span>${field.options.map((option: string) => `<label><input type="checkbox" ${key} value="${escape(option)}" ${(value ?? []).includes(option) ? "checked" : ""}/> ${escape(option)}</label>`).join(" ")}</span></fieldset>`;
    const type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    return `${label}<input ${key} type="${type}" value="${escape(value ?? "")}" /></label>`;
  };
  const makePhoto = (index = 0) => ({ assetId: "", x: index * 55, y: 0, width: 120, height: 80, rotation: 0 });
  const makeWork = (sectionId: string, kind: string, index: number) => ({ id: uuid(), sectionId, kind, title: "", caption: "", location: "", equipment: "", settings: "", photos: [makePhoto(index)], fields: {}, details: emptyWorkDetails(), titleBoard:{quoted:false,rubyEnabled:false,ruby:[]} });
  const selectedSection = (sectionId: string) => content().sections.find((section: AnyRecord) => section.sectionId === sectionId);
  const normalizeSection = (section: AnyRecord) => {
    section.singles = Math.min(300, Math.max(0, Math.floor(number(String(section.singles)))));
    section.series = Math.min(100, Math.max(0, Math.floor(number(String(section.series)))));
    section.books = Math.min(100, Math.max(0, Math.floor(number(String(section.books)))));
    section.fields ??= {};
  };
  const synchronizeWorks = () => {
    const draft = content();
    for (const section of draft.sections) {
      normalizeSection(section);
      for (const kind of ["single", "series", "book"]) {
        const count = section[kind === "single" ? "singles" : kind === "series" ? "series" : "books"];
        const current = draft.works.filter((work: AnyRecord) => work.sectionId === section.sectionId && work.kind === kind);
        const desired: AnyRecord[] = [];
        for (let index = 0; index < count; index++) {
          const work = current[index] ?? makeWork(section.sectionId, kind, index);
          work.fields ??= {}; work.photos ??= [];
          if (kind !== "series") {
            while (work.photos.length < 1) work.photos.push(makePhoto(work.photos.length));
            work.photos = work.photos.slice(0, 1);
          }
          desired.push(work);
        }
        draft.works = draft.works.filter((work: AnyRecord) => !(work.sectionId === section.sectionId && work.kind === kind)).concat(desired);
      }
    }
    for (const section of draft.sections) section.seriesPhotoCounts = draft.works.filter((work: AnyRecord) => work.sectionId === section.sectionId && work.kind === "series").map((work: AnyRecord) => work.photos.length);
    draft.works = draft.works.filter((work: AnyRecord) => draft.sections.some((section: AnyRecord) => section.sectionId === work.sectionId));
  };
  const workById = (id: string) => content().works.find((work: AnyRecord) => work.id === id);
  const limits = (): EffectiveSubmissionLimits => payload?.effectiveLimits ?? { sections: {} };
  const refreshLimits = () => {
    const draft = content() as SubmissionContent, rules = limits(), issues = submissionLimitIssues(draft, rules);
    const total = root.querySelector<HTMLElement>("[data-limit-total]");
    if (total) total.textContent = `作品数の合計（ブックを除く）：${draft.sections.reduce((sum, section) => sum + sectionWorkCount(section), 0)}${rules.maxWorks === undefined ? "（上限なし）" : ` / ${rules.maxWorks}作品` }。単写真1枚・組写真1組を各1作品として数えます。ブックは作品数・寸法の上限の対象外です。`;
    root.querySelectorAll<HTMLElement>("[data-limit-section]").forEach(target => {
      const id = target.dataset.limitSection!, rule = rules.sections[id], section = draft.sections.find(s => s.sectionId === id);
      const descriptions = rule ? describeSectionLimits(rule) : [];
      target.textContent = `この展示：${section ? sectionWorkCount(section) : 0}作品（ブックを除く）。${descriptions.length ? descriptions.join("。") + "。作品数・寸法の上限は単写真・組写真が対象で、寸法は全体外寸で判定します。ブックは対象外です。" : "作品数・大きさの上限なし。"}`;
    });
    root.querySelectorAll<HTMLElement>("[data-limit-errors]").forEach(target => {
      const scope = target.dataset.limitErrors!, id = target.dataset.limitId;
      const messages = issues.filter(issue => scope === "total" ? !issue.sectionId : scope === "section" ? issue.sectionId === id && !issue.workId : issue.workId === id).map(issue => issue.message);
      target.innerHTML = messages.map(message => `<span class="advisory-warning">${warningMark('制限超過')}<span>${escape(message)} このまま提出できます。</span></span>`).join(""); target.hidden = !messages.length;
    });
    const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
    if (submit) submit.disabled = busy || !!payload?.preview || !payload?.exhibition?.accepting;
    const preview=root.querySelector<HTMLButtonElement>("[data-preview-boards]");
    if(preview)preview.disabled=busy||!!payload?.preview||!draft.works.length;
    return issues;
  };
  const updateCustomField = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const fieldId = element.dataset.fieldId ?? "", scope = element.dataset.fieldScope ?? "";
    let answers: AnyRecord | undefined;
    if (scope === "common") answers = content().fields;
    else if (scope === "section") answers = selectedSection(element.dataset.sectionId ?? "")?.fields;
    else answers = workById(element.dataset.workId ?? "")?.fields;
    if (!answers) return;
    if (element instanceof HTMLInputElement && element.type === "checkbox") {
      const controls = [...root.querySelectorAll<HTMLInputElement>(`input[data-field-scope="${scope}"][data-field-id="${fieldId}"][data-work-id="${element.dataset.workId ?? ""}"][data-section-id="${element.dataset.sectionId ?? ""}"]`)];
      answers[fieldId] = controls.filter(control => control.checked).map(control => control.value);
    } else answers[fieldId] = element instanceof HTMLInputElement && element.type === "number" && element.value !== "" ? Number(element.value) : element.value;
  };
  const setWorkText = (element: HTMLInputElement | HTMLTextAreaElement) => {
    const work = workById(element.dataset.workId ?? "");
    const key = element.dataset.workKey ?? "";
    if (work && key) work[key] = element.value;
  };
  const setPhotoNumber = (element: HTMLInputElement) => {
    const work = workById(element.dataset.workId ?? ""), photo = work?.photos?.[number(element.dataset.photoIndex ?? "", -1)];
    const key = element.dataset.photoKey ?? "";
    if (photo && key) photo[key] = number(element.value, key === "width" || key === "height" ? .1 : 0);
  };
  const photoHtml = (work: AnyRecord, photo: AnyRecord, index: number) => {
    const asset = (payload?.assets ?? []).find((item: AnyRecord) => item.id === photo.assetId);
    const preview = asset ? `<img alt="添付済み写真" src="/api/exhibitions/${exhibitionId}/assets/${asset.id}?preview=1&token=${encodeURIComponent(token)}"/>` : "<span class=\"exhibition-muted\">未添付</span>";
    const size=(bytes:number)=>bytes<1048576?`${Math.max(1,Math.ceil(bytes/1024))} KB`:`${(bytes/1048576).toFixed(1)} MB`;
    const chooser=`<label class="exhibition-file-button">${asset?"ファイルを変更":"ファイルを選択"}<input class="exhibition-file-input" aria-label="${work.kind==="book"?"ブックの作品データ":`写真 ${index+1}`}" data-upload-work="${work.id}" data-upload-index="${index}" type="file" accept="image/jpeg,image/png"/></label><p class="exhibition-file-info" data-file-info="${work.id}:${index}">${asset?`${escape(asset.name)}（${size(asset.bytes)}）`:"ファイル未選択"}</p>`;
    if (work.kind === "book") return `<div class="work-photo-row"><div>${preview}${chooser}${photoExifEditor(work as Work, photo as PhotoLayout, index, asset?.photoMetadata)}</div></div>`;
    return `<div class="work-photo-row"><div>${work.kind === "series" ? `<strong>写真 ${index + 1}</strong><button type="button" class="secondary" data-remove-series-photo="${index}" data-work-id="${work.id}" aria-label="写真 ${index + 1}を削除">この写真を削除</button>` : ""}${preview}${chooser}${photoExifEditor(work as Work, photo as PhotoLayout, index, asset?.photoMetadata)}</div>
      <label>写真サイズ<select data-photo-paper="${index}" data-work-id="${work.id}"><option value="custom" ${paperSizeId(photo as PhotoLayout) === "custom" ? "selected" : ""}>自由入力</option>${paperSizes.map(size => `<option value="${size.id}" ${paperSizeId(photo as PhotoLayout) === size.id ? "selected" : ""}>${"label" in size ? size.label : size.id} (${size.width}×${size.height}mm)</option>`).join("")}</select></label><label>紙の向き<select data-photo-orientation="${index}" data-work-id="${work.id}"><option value="portrait" ${photo.width <= photo.height ? "selected" : ""}>縦</option><option value="landscape" ${photo.width > photo.height ? "selected" : ""}>横</option></select></label>
      <label>幅mm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="width" type="number" min=".1" step=".1" value="${escape(photo.width)}"/></label>
      <label>高mm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="height" type="number" min=".1" step=".1" value="${escape(photo.height)}"/></label>
      <label>Xmm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="x" type="number" step=".1" value="${escape(photo.x)}"/></label>
      <label>Ymm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="y" type="number" step=".1" value="${escape(photo.y)}"/></label>
      <label>回転°<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="rotation" type="number" min="-360" max="360" step=".1" value="${escape(photo.rotation)}"/></label></div>`;
  };
  const seriesEditor = createSeriesEditor({ getWork: id => workById(id) as Work, assetUrl: id => `/api/exhibitions/${exhibitionId}/assets/${id}?preview=1`, change: () => { synchronizeWorks(); draftSync?.touch(); refreshLimits(); }, closed: () => render(), message: status, busy: () => busy || !!payload?.preview || !payload?.exhibition?.accepting, width: () => root.clientWidth });
  const seriesCanvas = (work: AnyRecord) => seriesEditor.html(work as Work);
  const metadataHtml = (work:AnyRecord) => {
    if(!work.details && [work.location,work.equipment,work.settings].some(Boolean)) return `${[["location","撮影場所"],["equipment","使用機材"],["settings","撮影設定"]].map(([key,label])=>`<label>${label}（既存の記述）<textarea rows="1" data-metadata-input data-work-id="${work.id}" data-work-key="${key}">${escape(work[key])}</textarea></label>`).join("")}${metadataLineHint(work.id)}<button type="button" class="secondary" data-split-metadata="${work.id}">撮影情報を分割入力に切り替える</button>`;
    work.details??=emptyWorkDetails();
    const input=(key:string,label:string,placeholder="")=>`<label>${label}<textarea rows="1" data-metadata-input data-work-id="${work.id}" data-work-detail="${key}" placeholder="${placeholder}">${escape(work.details[key])}</textarea></label>`;
    return `<fieldset class="exhibition-metadata"><legend>撮影場所（任意）</legend>${input("place","地名")}
      <label>都道府県<select data-work-id="${work.id}" data-work-detail="prefecture"><option value="">選択してください</option>${[...prefectures,"海外・その他"].map(v=>`<option ${work.details.prefecture===v?"selected":""}>${v}</option>`).join("")}</select></label><div data-region-field="${work.id}" ${work.details.prefecture==="海外・その他"?"":"hidden"}>${input("region","国・地域")}</div></fieldset>
      <fieldset class="exhibition-metadata"><legend>使用機材（任意）</legend>${input("camera","カメラ")}${input("lens","レンズ")}${input("film","フィルム（任意）")}</fieldset>
      <fieldset class="exhibition-metadata"><legend>撮影設定（任意）</legend>${input("shutterSpeed","シャッタースピード","1/250秒")}${input("iso","ISO感度","400")}${input("fNumber","F値","2.8")}</fieldset>${metadataLineHint(work.id)}`;
  };
  const workHtml = (work: AnyRecord, index: number) => {
    const kindName = ({ single: "単写真", series: "組写真", book: "ブック" } as AnyRecord)[work.kind];
    const photos = `<h5 class="${work.kind === "book" ? "" : "required"}">${work.kind === "book" ? "ブックの作品データ（任意・表紙や内容の画像）" : "写真"}（JPEG・PNG、各20MB以下）</h5>${work.photos.map((photo: AnyRecord, photoIndex: number) => photoHtml(work, photo, photoIndex)).join("")}${work.kind === "series" ? `<div class="exhibition-actions"><span data-series-photo-count="${work.id}">${work.photos.length}枚 / 100枚まで</span><button type="button" class="secondary" data-add-series-photo="${work.id}" ${work.photos.length >= 100 ? "disabled" : ""}>＋ 写真を追加</button></div><p class="exhibition-muted">写真を1枚ずつ追加し、不要な写真は「この写真を削除」で取り除いてください。提出時は1枚以上の写真が必要です。</p>` : ""}${seriesCanvas(work)}`;
    const custom = fieldsFor("work", work.sectionId, work.kind).map((field: AnyRecord) => fieldControl(field, work.fields?.[field.id], "work", work.id)).join("");
    return `<article class="exhibition-work"><h4>${kindName} ${index + 1}</h4><p class="exhibition-limit-warning" data-limit-errors="work" data-limit-id="${work.id}" aria-live="polite" hidden></p><div class="exhibition-form">
      <label>作品タイトル（任意）<input data-work-id="${work.id}" data-work-key="title" maxlength="300" value="${escape(work.title)}" /></label>
      ${titleBoardFieldsHtml(work as Work)}
      <label>${escape(payload?.schema?.captionLabel ?? "キャプション")}<textarea data-work-id="${work.id}" data-work-key="caption">${escape(work.caption)}</textarea></label>
      ${metadataHtml(work)}${custom}</div>${photos}</article>`;
  };
  const sectionHtml = (section: AnyRecord, schemaSection: AnyRecord) => {
    const sectionFields = fieldsFor("section", section.sectionId).map((field: AnyRecord) => fieldControl(field, section.fields?.[field.id], "section", "", section.sectionId)).join("");
    const works = content().works.filter((work: AnyRecord) => work.sectionId === section.sectionId);
    const grouped = ["single", "series", "book"].map(kind => works.filter((work: AnyRecord) => work.kind === kind).map((work: AnyRecord, index: number) => workHtml(work, index)).join("")).join("");
    return `<fieldset data-section="${section.sectionId}"><legend>${escape(schemaSection.title)}</legend>${schemaSection.description ? `<p>${escape(schemaSection.description)}</p>` : ""}
      <p class="exhibition-limit-summary" data-limit-section="${section.sectionId}"></p><p class="exhibition-limit-warning" data-limit-errors="section" data-limit-id="${section.sectionId}" aria-live="polite" hidden></p>
      <div class="exhibition-grid"><label>単写真枚数<input data-count="singles" type="number" min="0" max="300" value="${section.singles}" /></label><label>組写真作品数<input data-count="series" type="number" min="0" max="100" value="${section.series}" /></label><label>ブック冊数<input data-count="books" type="number" min="0" max="100" value="${section.books}" /></label></div>
      ${sectionFields}<div class="exhibition-list">${grouped}</div></fieldset>`;
  };
  const bind = () => {
    root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>("[data-work-detail]").forEach(input=>input.addEventListener("input",()=>{
      const work=workById(input.dataset.workId!); if(!work) return;
      work.details??=emptyWorkDetails();work.details[input.dataset.workDetail!]=input.value;Object.assign(work,metadataStrings(work.details));
      const region=root.querySelector<HTMLElement>(`[data-region-field="${work.id}"]`); if(region) region.hidden=work.details.prefecture!=="海外・その他";
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-split-metadata]").forEach(button=>button.addEventListener("click",()=>{
      if(!confirm("既存の記述は自動分解できません。撮影情報の各欄へ入力し直しますか？ 保存済みの提出履歴は残ります。"))return;
      const work=workById(button.dataset.splitMetadata!);work.details=emptyWorkDetails();Object.assign(work,metadataStrings(work.details));render();
    }));
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-field-id]").forEach(element => { for (const event of ["input", "change"]) element.addEventListener(event, () => updateCustomField(element)); });
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-work-key]").forEach(element => element.addEventListener("input", () => { setWorkText(element); refreshLimits(); }));
    root.querySelectorAll<HTMLInputElement>("[data-photo-key]").forEach(element => {
      element.addEventListener("input", () => { setPhotoNumber(element); refreshLimits(); });
      element.addEventListener("change", () => { setPhotoNumber(element); const work = workById(element.dataset.workId ?? ""); if (work?.kind === "series") render(); else refreshLimits(); });
    });
    root.querySelectorAll<HTMLSelectElement>("[data-photo-paper], [data-photo-orientation]").forEach(input => input.addEventListener("change", () => {
      const work = workById(input.dataset.workId ?? ""), index = Number(input.dataset.photoPaper ?? input.dataset.photoOrientation), photo = work?.photos[index]; if(!photo) return;
      if(input.dataset.photoPaper !== undefined) { const size = paperSizes.find(s => s.id === input.value); if(size) { const landscape = photo.width > photo.height; photo.width = landscape ? size.height : size.width; photo.height = landscape ? size.width : size.height; } }
      else { const width = Math.min(photo.width,photo.height), height = Math.max(photo.width,photo.height); photo.width = input.value === "landscape" ? height : width; photo.height = input.value === "landscape" ? width : height; }
      render();
    }));
    root.querySelectorAll<HTMLInputElement>("[data-count]").forEach(element => { element.addEventListener("input", () => { const section = selectedSection(element.closest<HTMLElement>("[data-section]")?.dataset.section ?? ""); if(section) { section[element.dataset.count ?? "singles"] = Math.max(0,Math.floor(number(element.value))); synchronizeWorks(); refreshLimits(); } }); element.addEventListener("change", () => { const section = selectedSection(element.closest<HTMLElement>("[data-section]")?.dataset.section ?? ""); if (section) { section[element.dataset.count ?? "singles"] = Math.max(0, Math.floor(number(element.value))); synchronizeWorks(); render(); } }); });
    const changeSeriesPhotos = (work: AnyRecord, index?: number) => {
      if (busy || payload?.preview || !payload?.exhibition?.accepting || work.kind !== "series") return;
      if (index === undefined) {
        if (work.photos.length >= 100) return;
        work.photos.push(makePhoto(work.photos.length));
      } else {
        if (!Number.isInteger(index) || index < 0 || index >= work.photos.length) return;
        work.photos.splice(index, 1);
      }
      seriesEditor.reset(work.id);
      render();
      root.querySelector<HTMLButtonElement>(`[data-add-series-photo="${work.id}"]`)?.focus({ preventScroll: true });
    };
    root.querySelectorAll<HTMLButtonElement>("[data-add-series-photo]").forEach(button => button.addEventListener("click", () => {
      const work = workById(button.dataset.addSeriesPhoto!);
      if (work) changeSeriesPhotos(work);
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-remove-series-photo]").forEach(button => button.addEventListener("click", () => {
      const work = workById(button.dataset.workId!);
      if (work) changeSeriesPhotos(work, Number(button.dataset.removeSeriesPhoto));
    }));
    root.querySelectorAll<HTMLInputElement>("[data-upload-work]").forEach(element => element.addEventListener("change", () => uploadPhoto(element)));
    root.querySelectorAll<HTMLInputElement>("[data-section-toggle]").forEach(element => element.addEventListener("change", () => {
      const sectionId = element.dataset.sectionToggle ?? "", draft = content();
      if (element.checked && !selectedSection(sectionId)) draft.sections.push({ sectionId, singles: 0, series: 0, books: 0, seriesPhotoCounts: [], fields: {} });
      if (!element.checked) { draft.sections = draft.sections.filter((section: AnyRecord) => section.sectionId !== sectionId); draft.works = draft.works.filter((work: AnyRecord) => work.sectionId !== sectionId); }
      synchronizeWorks(); render();
    }));
    root.querySelector<HTMLButtonElement>("[data-copy-link]")?.addEventListener("click", async () => { try { await navigator.clipboard.writeText(location.href); status("編集リンクをコピーしました。第三者に共有しないでください。"); } catch { status("このページのURLをコピーして保管してください。", true); } });
    root.querySelector<HTMLButtonElement>("[data-save]")?.addEventListener("click", () => save("save"));
    root.querySelector<HTMLButtonElement>("[data-submit]")?.addEventListener("click", () => save("submit"));
    root.querySelector<HTMLButtonElement>("[data-preview-boards]")?.addEventListener("click", openBoardPreview);
    bindTitleBoardFields(root,{work:id=>workById(id) as Work,change:()=>{draftSync?.touch();validateTextFields(root,content() as SubmissionContent);},disabled:()=>busy||!!payload?.preview||!payload?.exhibition?.accepting});
    bindPhotoExifEditor(root, id => workById(id) as Work, () => draftSync?.touch(), () => busy || !!payload?.preview || !payload?.exhibition?.accepting, id => payload?.assets?.find((a: AnyRecord) => a.id === id)?.photoMetadata ?? {});
    seriesEditor.bind(root);
    bindTextValidation(root,()=>content() as SubmissionContent);
  };
  const uploadPhoto = async (input: HTMLInputElement) => {
    const file = input.files?.[0], work = workById(input.dataset.uploadWork ?? ""), index = Number(input.dataset.uploadIndex);
    if (!file || !work?.photos?.[index] || busy) return;
    if (!/^image\/(jpeg|png)$/.test(file.type) || file.size > 20 * 1024 * 1024) { status("写真は20MB以下のJPEG・PNGを選んでください。", true); input.value = ""; return; }
    const label=root.querySelector<HTMLElement>(`[data-file-info="${work.id}:${index}"]`);
    if(label) label.textContent=`${file.name}（${(file.size/1048576).toFixed(2)} MB）・アップロード中`;
    const assetId = uuid();
    const form = new FormData(); form.set("token", token); form.set("assetId", assetId); form.set("file", file); form.set("ownerId",ownerId); form.set("submissionId",payload!.submission.id);
    busy = true; root.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button").forEach(control => control.disabled = true); status(`写真 ${index + 1} を保存しています…`);
    try {
      const response = await fetch(`/api/exhibitions/${exhibitionId}/upload`, { method: "POST", body: form }), data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.message ?? "写真を保存できませんでした。");
      work.photos[index].assetId = assetId;
      const latest = payload as AnyRecord;
      latest.assets = [...(latest.assets ?? []).filter((item: AnyRecord) => item.id !== data.asset.id), data.asset]; status("写真を保存しました。"); render();
    } catch (error) { status(error instanceof Error ? error.message : "写真を保存できませんでした。", true); }
    finally { busy = false; render(); }
  };
  const serializableContent = () => {
    synchronizeWorks();
    return structuredClone(content());
  };
  const openBoardPreview = () => {
    if(!payload?.submission||payload.preview||busy||!content().works.length)return;
    const snapshot=structuredClone(content()),previousFocus=root.querySelector<HTMLButtonElement>("[data-preview-boards]");
    const dialog=document.createElement("dialog");
    dialog.className="exhibition-confirm-dialog exhibition-page board-preview-dialog";
    dialog.setAttribute("aria-label","自分のタイトルボードのプレビュー");
    const options=payload.schema.sections.map((section:AnyRecord)=>{
      const works=snapshot.works.filter((work:AnyRecord)=>work.sectionId===section.id);
      return works.length?`<optgroup label="${escape(section.title)}">${works.map((work:AnyRecord,index:number)=>`<option value="${escape(work.id)}">${index+1}. ${escape(({single:"単写真",series:"組写真",book:"ブック"} as AnyRecord)[work.kind])}・${escape(work.title||"無題")}</option>`).join("")}</optgroup>`:"";
    }).join("");
    dialog.innerHTML=`<header class="exhibition-confirm-header"><h2>Title board</h2><button type="button" class="layout-close" data-board-preview-close aria-label="プレビューを閉じる"><span></span><span></span></button></header><p>現在の入力内容を表示します。この操作では保存・提出されません。</p><label class="exhibition-field">確認する作品<select data-board-preview-work>${options}</select></label><div class="exhibition-actions board-preview-navigation"><button type="button" data-board-preview-prev>前の作品</button><span data-board-preview-position></span><button type="button" data-board-preview-next>次の作品</button></div><p data-board-preview-status role="status" aria-live="polite"></p><figure class="board-preview-card"><img data-board-preview-image alt="タイトルボード" hidden/><figcaption data-board-preview-caption></figcaption></figure><ul class="board-preview-issues" data-board-preview-issues role="alert" hidden></ul><p><a data-board-preview-qr target="_blank" rel="noopener noreferrer" hidden>QRコードのリンクを確認</a></p><div class="exhibition-actions"><button type="button" data-board-preview-refresh>プレビューを更新</button><button type="button" data-board-preview-close>フォームに戻る</button></div>`;
    document.body.append(dialog);
    const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    const select=dialog.querySelector<HTMLSelectElement>("[data-board-preview-work]")!,image=dialog.querySelector<HTMLImageElement>("[data-board-preview-image]")!;
    const message=dialog.querySelector<HTMLElement>("[data-board-preview-status]")!,issues=dialog.querySelector<HTMLUListElement>("[data-board-preview-issues]")!,caption=dialog.querySelector<HTMLElement>("[data-board-preview-caption]")!,qr=dialog.querySelector<HTMLAnchorElement>("[data-board-preview-qr]")!;
    let pending:AbortController|undefined;
    const show = async () => {
      pending?.abort();const controller=new AbortController();pending=controller;
      const work=snapshot.works.find((work:AnyRecord)=>work.id===select.value);if(!work)return;
      const index=[...select.options].findIndex(option=>option.value===select.value);
      dialog.querySelector<HTMLElement>("[data-board-preview-position]")!.textContent=`${index+1} / ${select.options.length}`;
      dialog.querySelector<HTMLButtonElement>("[data-board-preview-prev]")!.disabled=index<=0;
      dialog.querySelector<HTMLButtonElement>("[data-board-preview-next]")!.disabled=index>=select.options.length-1;
      message.textContent="プレビューを作成しています…";image.hidden=true;issues.hidden=true;issues.replaceChildren();caption.textContent="";qr.hidden=true;
      const refresh=dialog.querySelector<HTMLButtonElement>("[data-board-preview-refresh]")!;refresh.disabled=true;
      const timeout=window.setTimeout(()=>controller.abort(),30000);
      try {
        const response=await fetch(`/api/exhibitions/${exhibitionId}`,{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({action:"boards.preview",token,ownerId,content:{name:snapshot.name,authorName:snapshot.authorName,grade:snapshot.grade,portfolioUrl:snapshot.portfolioUrl,work}})});
        const result=await readExhibitionResponse(response);
        if(!response.ok||!result.ok)throw new Error(result.message??"プレビューを作成できませんでした。");
        if(typeof result.image!=="string"||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(result.image))throw new Error("プレビュー画像を読み込めませんでした。");
        if(controller.signal.aborted||!dialog.isConnected)return;
        image.src=result.image;image.alt=`「${result.title||"無題"}」のタイトルボード`;await image.decode();
        if(controller.signal.aborted||!dialog.isConnected)return;
        image.hidden=false;caption.textContent=`${result.sectionTitle} ／ ${result.title||"無題"} ／ キャプション ${result.fontSize}pt`;
        for(const warning of result.issues??[]){const item=document.createElement("li");item.textContent=formatExhibitionError(String(warning));issues.append(item);}
        issues.hidden=!issues.childElementCount;
        if(result.qrUrl){qr.href=result.qrUrl;qr.hidden=false;}
        message.textContent="105 × 74.25 mm（A4の8分の1）の仕上がりイメージです。";
      } catch(error) {
        if(pending!==controller||!dialog.isConnected)return;
        message.textContent=formatExhibitionError(controller.signal.aborted?"":error instanceof Error?error.message:"", 'EXH-016');
      } finally {window.clearTimeout(timeout);if(pending===controller&&dialog.isConnected)refresh.disabled=false;}
    };
    select.addEventListener("change",()=>void show());
    for(const [name,step] of [["prev",-1],["next",1]] as const)dialog.querySelector<HTMLButtonElement>(`[data-board-preview-${name}]`)!.addEventListener("click",()=>{select.selectedIndex+=step;void show();});
    dialog.querySelector<HTMLButtonElement>("[data-board-preview-refresh]")!.addEventListener("click",()=>void show());
    dialog.querySelectorAll<HTMLButtonElement>("[data-board-preview-close]").forEach(button=>button.addEventListener("click",()=>dialog.close()));
    dialog.addEventListener("close",()=>{pending?.abort();dialog.remove();document.body.style.overflow=previousOverflow;previousFocus?.isConnected&&previousFocus.focus({preventScroll:true});},{once:true});
    dialog.showModal();void show();
  };
  const syncDisplay = () => {
    const box = root.querySelector<HTMLElement>("[data-draft-sync]"); if (!box) return;
    box.hidden = !draftSync || !!payload?.preview; box.dataset.kind = syncState.kind;
    const suffix = syncState.local ? "入力はこの端末に一時保存しています。" : "端末への一時保存ができません。保存が完了するまでこの画面を閉じないでください。";
    const messages: Record<DraftSyncState["kind"],string> = {
      saved: "自動保存済み", pending: "変更を保存します…", saving: "自動保存中…",
      offline: `${formatExhibitionError('', 'EXH-013')} 接続後に再送します。${suffix}`,
      auth: formatExhibitionError(`ログインの有効期限が切れたか、アカウントが変更されました。元のアカウントで再ログインしてください。${suffix}`, 'EXH-009'),
      conflict: formatExhibitionError(`別の画面で下書きが変更されています。「この端末の入力を保存」か「サーバーの下書きを使う」を選んでください。${suffix}`, 'EXH-012'),
      blocked: `${formatExhibitionError(syncState.message || "保存を再開するには入力内容・受付期間を確認してください。")} ${suffix}`,
    };
    box.querySelector<HTMLElement>("[data-draft-sync-status]")!.textContent = syncState.kind === "pending" && !payload?.exhibition.accepting ? formatExhibitionError(`入力期間が終了しているため、未送信の入力はサーバーに保存できません。${suffix}`, 'EXH-011') : messages[syncState.kind] + (!syncState.local ? ` ${formatExhibitionError('', 'EXH-017')}` : '');
    box.querySelector<HTMLElement>("[data-draft-login]")!.hidden = syncState.kind !== "auth";
    box.querySelector<HTMLElement>("[data-draft-retry]")!.hidden = !["offline","auth","blocked","conflict"].includes(syncState.kind);
    box.querySelector<HTMLElement>("[data-draft-conflict]")!.hidden = syncState.kind !== "conflict";
  };
  const checkedResponse = async (response: Response) => {
    let data: AnyRecord;
    try { data = await readExhibitionResponse(response); }
    catch(error) { throw new DraftSaveError(error instanceof Error ? error.message : "保存結果を確認できませんでした。",response.status >= 400 ? response.status : response.redirected ? 401 : 0); }
    if (!response.ok || !data.ok) {
      if (data.effectiveLimits && payload) payload.effectiveLimits = data.effectiveLimits;
      if (Array.isArray(data.issues)) setServerTextIssues(root, content() as SubmissionContent, data.issues);
      throw new DraftSaveError(data.message ?? "保存できませんでした。",response.status);
    }
    return data;
  };
  const applyInitialGrade = () => {
    const suggested = normalizeExhibitionGrade(payload?.initialGrade), draft = payload?.submission?.draft;
    if (draft && !draft.grade?.trim() && suggested) { draft.grade = suggested; return true; }
    return false;
  };
  const setupSync = (initialContent?: AnyRecord) => {
    draftSync?.dispose(); draftSync = undefined;
    if (!payload?.submission || payload.preview) return;
    const submissionId = payload.submission.id;
    // Each document owns its backup key, including duplicated browser tabs.
    let storage: Storage | null = null; const tab = uuid();
    try { storage = localStorage; } catch {}
    const snapshot = (data: AnyRecord) => {
      if (data.viewerId !== ownerId) throw new DraftSaveError("元のアカウントでログインし直してください。",401);
      if (data.submission?.id !== submissionId) throw new DraftSaveError("提出先が変更されました。運営に確認してください。",403);
      return { revision: data.submission.revision, content: data.submission.draft };
    };
    draftSync = createDraftSync<AnyRecord>({
      initial: { ...snapshot(payload), ...(initialContent ? { content: initialContent } : {}) }, storage, tab, prefix: `scharade:exhibition-draft:v1:${ownerId}:${exhibitionId}:${submissionId}:${payload.schema.version}:`,
      read: serializableContent,
      restore: value => { payload!.submission.draft = value; render(); },
      enabled: () => !busy && !composing && !!payload?.exhibition.accepting,
      state: state => { syncState = state; syncDisplay(); },
      send: async (value,revision) => {
        const response = await fetch(`/api/exhibitions/${exhibitionId}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"save",token,ownerId,submissionId,revision,content:value}),signal:AbortSignal.timeout(20000)});
        const data = await checkedResponse(response), result = snapshot(data);
        payload!.submission.revision = result.revision;payload!.exhibition=data.exhibition;deadlineClock.refresh();
        return result;
      },
      fetch: async () => {
        const data = await checkedResponse(await fetch(`/api/exhibitions/${exhibitionId}`,{signal:AbortSignal.timeout(15000)})), result = snapshot(data);
        payload!.submission.revision = result.revision; payload!.exhibition = data.exhibition;
        payload!.assets = data.assets; payload!.effectiveLimits = data.effectiveLimits;
        return result;
      },
    });
    draftSync.restore();
    if (applyInitialGrade()) render();
    draftSync.touch(); syncDisplay();
  };
  const save = async (action: "save" | "submit") => {
    if (!payload?.submission || busy || !draftSync) return;
    busy = true; root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button").forEach(control => control.disabled = true);
    let focusInvalid = false;
    status(action === "submit" ? "提出内容を確認しています…" : "下書きを保存しています…");
    try {
      if(action === "submit") {
        refreshLimits();
        try { await ensureTextMeasurement(); } catch { /* The server always verifies the actual print layout. */ }
        if(validateTextFields(root,content() as SubmissionContent).length) { status("文字量の警告がある項目の文字数や改行を減らしてください。",true,true,'EXH-004');focusInvalid=true;return; }
      }
      await draftSync.flush(true);
      if (action === "submit") {
        const response = await fetch(`/api/exhibitions/${exhibitionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, signal:AbortSignal.timeout(20000), body: JSON.stringify({ action, token, ownerId, submissionId:payload.submission.id, revision: draftSync.revision(), content: serializableContent() }) });
        const data = await checkedResponse(response);
        draftSync.dispose(); draftSync = undefined; payload = data; synchronizeWorks(); render(); setupSync();
        document.dispatchEvent(new CustomEvent('help:statechange'));
        if (payload.exhibition.shiftsEnabled) operationNotice("出展フォームを提出しました。続けてシフトフォームも提出してください。",false,"exhibition-next-step");
      }
      status(action === "submit" ? "提出しました。Googleフォーム連携は運営側で同期されます。" : "下書きを保存しました。");
    } catch (error) { status(error instanceof Error ? error.message : "保存できませんでした。", true); focusInvalid = true; }
    finally { busy = false; render(); if (focusInvalid) root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
  };
  const render = () => {
    if (!payload) return;
    queueMicrotask(()=>deadlineClock.refresh());
    synchronizeWorks();
    const draft = content(), schema = payload.schema;
    const readOnly = !payload.exhibition.accepting;
    const common = fieldsFor("common").map((field: AnyRecord) => fieldControl(field, draft.fields?.[field.id], "common")).join("");
    const sectionChoices = schema.sections.map((section: AnyRecord) => `<label><input data-section-toggle="${section.id}" type="checkbox" ${selectedSection(section.id) ? "checked" : ""}/> ${escape(section.title)}</label>`).join(" ");
    root.innerHTML = `<header><h1>${escape(payload.exhibition.title)} 出展フォーム</h1><p>${payload.preview ? "運営用のフォームプレビューです。保存・写真添付・提出はできません。" : "入力内容は変更後に自動保存します。ログイン切れ・通信失敗時の未送信の入力はこの端末に一時保存し、再ログイン後に復元します。提出は最後の「提出する」ボタンで行ってください。"}</p></header>
      <p class="exhibition-status" aria-live="polite"></p><div data-submission-deadline>${payload.exhibition.submissionOverdue?overdueWarningHtml():""}</div>${readOnly ? '<p class="exhibition-muted">入力期間外のため、保存内容の確認のみ可能です。</p>' : ""}

      <section class="exhibition-editor"><fieldset><legend>出展者情報</legend><div class="exhibition-form"><label class="required">名前<input data-common="name" maxlength="150" value="${escape(draft.name)}"/></label><label class="required">学年<select data-common="grade" required>${exhibitionGradeOptionsHtml(draft.grade ?? "")}</select></label><label class="required">作者名<input data-common="authorName" maxlength="150" value="${escape(draft.authorName)}"/></label><label>外部Portfolio・SNS URL<input data-common="portfolioUrl" type="url" placeholder="https://…" value="${escape(draft.portfolioUrl)}"/><small>入力したURLをタイトルボードのQRコードに使用します。空欄の場合はアカウントのPortfolioを使用します。</small></label>${common}</div></fieldset>
      <fieldset><legend>参加する展示</legend><p>通常展示と企画展示の両方を選べます。選択した展示ごとに、少なくとも一つの作品を入力してください。</p><div class="exhibition-actions">${sectionChoices}</div></fieldset>
      <p class="exhibition-limit-summary" data-limit-total></p><p class="exhibition-limit-warning" data-limit-errors="total" aria-live="polite" hidden></p>
      ${draft.sections.map((section: AnyRecord) => sectionHtml(section, schema.sections.find((item: AnyRecord) => item.id === section.sectionId))).join("")}
      <fieldset class="exhibition-notes-field"><legend>その他ご意見、ご要望など</legend><label for="exhibition-notes">ご意見・ご要望（任意）</label><textarea id="exhibition-notes" data-submission-notes rows="8" maxlength="${exhibitionNotesLimit}" aria-describedby="exhibition-notes-help exhibition-notes-count">${escape(draft.notes ?? "")}</textarea><small id="exhibition-notes-help">運営への連絡事項を自由にご記入ください。タイトルボードには印刷されません。</small><small id="exhibition-notes-count" data-notes-count>${(draft.notes ?? "").length.toLocaleString("ja-JP")} / ${exhibitionNotesLimit.toLocaleString("ja-JP")}文字</small></fieldset>
      <aside class="exhibition-draft-sync" data-draft-sync hidden><p data-draft-sync-status role="status" aria-live="polite"></p><div class="exhibition-actions"><a data-draft-login href="/Login?next=${encodeURIComponent(`/Exhibition/${exhibitionId}`)}" hidden>ログインし直す</a><button type="button" class="secondary" data-draft-retry hidden>保存状態を確認・再送</button><span class="exhibition-actions" data-draft-conflict hidden><button type="button" class="secondary" data-draft-resolve="local">この端末の入力を保存</button><button type="button" class="secondary" data-draft-resolve="server">サーバーの下書きを使う</button></span></div></aside>
      <div class="exhibition-actions"><button class="secondary" data-save>下書きを保存</button><button data-submit>提出する</button><button type="button" class="secondary" data-preview-boards>タイトルボードをプレビュー</button>${payload.exhibition.shiftsEnabled && payload.submission?.versions?.length ? `<a class="exhibition-button" href="/Member/exhibitions/${exhibitionId}/shifts">シフトフォームへ進む</a>` : ""}</div></section>`;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-common]").forEach(input => { const update = () => { draft[input.dataset.common ?? ""] = input.value; }; input.addEventListener("input", update); input.addEventListener("change", update); });
    root.querySelector<HTMLTextAreaElement>("[data-submission-notes]")?.addEventListener("input", event => {
      draft.notes = (event.target as HTMLTextAreaElement).value;
      root.querySelector("[data-notes-count]")!.textContent = `${draft.notes.length.toLocaleString("ja-JP")} / ${exhibitionNotesLimit.toLocaleString("ja-JP")}文字`;
    });
    root.querySelectorAll<HTMLLabelElement>(".exhibition-form > label").forEach(label => {
      const control = label.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
      if (!control || control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)) return;
      const caption = document.createElement("span"); caption.className = "exhibition-label";
      [...label.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => caption.append(node));
      const description = label.querySelector("small"); if (description) caption.append(description);
      if (label.classList.contains("required")) { const badge = document.createElement("span"); badge.className = "exhibition-required"; badge.textContent = "必須"; caption.append(badge); }
      label.prepend(caption); label.classList.add("exhibition-row");
    });
    bind();
    root.querySelector<HTMLButtonElement>("[data-draft-retry]")?.addEventListener("click", () => void draftSync?.resume());
    root.querySelectorAll<HTMLButtonElement>("[data-draft-resolve]").forEach(button => button.addEventListener("click", () => void draftSync?.resolve(button.dataset.draftResolve as "local" | "server").catch(error => status(error.message,true))));
    refreshLimits();
    if (readOnly || payload.preview) root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button:not([data-preview-boards])").forEach(control => control.disabled = true);
    status(currentStatus.message, currentStatus.error, false);
    draftSync?.touch(); syncDisplay();
  };
  const load = async () => {
    try {
      const preview = new URLSearchParams(location.search).get("preview") === "1";
      const url = `/api/exhibitions/${exhibitionId}?${preview ? "preview=1" : token ? `token=${encodeURIComponent(token)}` : ""}`;
      const response = await fetch(url), data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.message ?? "フォームを読み込めませんでした。");
      payload = data;
      if (data.submission) { const saved = structuredClone(data.submission.draft); applyInitialGrade(); token = ""; if(location.hash) history.replaceState(null,"",location.pathname + location.search); render(); setupSync(saved); return; }
      root.innerHTML = `<header><h1>${escape(data.exhibition.title)} 出展フォーム</h1></header><p>${escape(data.exhibition.accepting ? "出展を開始すると、下書きが自分のアカウントに保存されます。" : data.participation?.message || "現在は受付期間外です。")}</p><div class="exhibition-actions">${data.exhibition.accepting ? '<button data-begin>出展を開始する</button>' : ""}<a class="exhibition-button secondary" href="/Member/exhibitions/${exhibitionId}">参加投票・入力期間を確認</a></div><p class="exhibition-status" aria-live="polite"></p>`;
      root.querySelector<HTMLButtonElement>("[data-begin]")?.addEventListener("click", begin);
    } catch (error) { root.innerHTML = `<p class="exhibition-status error" role="alert">${escape(formatExhibitionError(error instanceof Error ? error.message : "フォームを読み込めませんでした。"))}</p>`; }
  };
  const begin = async () => {
    if (busy) return;
    busy = true;
    status("出展フォームを準備しています…");
    try {
      const response = await fetch(`/api/exhibitions/${exhibitionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", ownerId, revision: 0 }) }), data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok || !data.submission) throw new Error(data.message ?? "開始できませんでした。");
      token = ""; history.replaceState(null, "", location.pathname); payload = data; render(); setupSync(); status("自分のアカウントに出展フォームを作成しました。");
    } catch (error) { status(error instanceof Error ? error.message : "開始できませんでした。", true); }
    finally { busy = false; refreshLimits(); draftSync?.touch(); }
  };
  void load();
}
