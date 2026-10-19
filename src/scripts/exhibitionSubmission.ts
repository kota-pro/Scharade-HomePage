import { emptyWorkDetails, metadataStrings, prefectures } from "../lib/exhibitionText.ts";
import { bindTextValidation, ensureTextMeasurement, validateTextFields } from "./exhibitionTextValidation";
import { operationNotice } from "./siteNotice";
export {};
import { createSeriesEditor } from "./exhibitionSeriesEditor";
import { paperSizes, paperSizeId } from "../lib/exhibitionEditing.ts";
import { readExhibitionResponse } from "./exhibitionResponse";
import { describeSectionLimits, sectionWorkCount, submissionLimitIssues } from "../lib/exhibitionSubmissionLimits.ts";
import type { EffectiveSubmissionLimits, Work, PhotoLayout, SubmissionContent } from "../lib/exhibitionTypes.ts";
type AnyRecord = Record<string, any>;

const root = document.querySelector<HTMLElement>("#exhibition-submission");
if (root) {
  const exhibitionId = root.dataset.exhibitionId ?? "";
  let payload: AnyRecord | null = null;
  let token = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  let busy = false, savedContent = "";
  window.addEventListener("beforeunload", event => { if (payload?.submission && !payload.preview && (busy || JSON.stringify(content()) !== savedContent)) { event.preventDefault(); event.returnValue = ""; } });
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
  const status = (message: string, error = false, announce = true) => {
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
  const makeWork = (sectionId: string, kind: string, index: number) => ({ id: uuid(), sectionId, kind, title: "", caption: "", location: "", equipment: "", settings: "", photos: [makePhoto(index)], fields: {}, details: emptyWorkDetails() });
  const selectedSection = (sectionId: string) => content().sections.find((section: AnyRecord) => section.sectionId === sectionId);
  const normalizeSection = (section: AnyRecord) => {
    section.singles = Math.min(300, Math.max(0, Math.floor(number(String(section.singles)))));
    section.series = Math.min(100, Math.max(0, Math.floor(number(String(section.series)))));
    section.books = Math.min(100, Math.max(0, Math.floor(number(String(section.books)))));
    section.seriesPhotoCounts ??= [];
    section.fields ??= {};
    while (section.seriesPhotoCounts.length < section.series) section.seriesPhotoCounts.push(2);
    section.seriesPhotoCounts = section.seriesPhotoCounts.slice(0, section.series).map((count: unknown) => Math.max(1, Math.min(100, Math.floor(number(String(count), 2)))));
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
          const photoCount = kind === "series" ? section.seriesPhotoCounts[index] : 1;
          while (work.photos.length < photoCount) work.photos.push(makePhoto(work.photos.length));
          work.photos = work.photos.slice(0, photoCount);
          desired.push(work);
        }
        draft.works = draft.works.filter((work: AnyRecord) => !(work.sectionId === section.sectionId && work.kind === kind)).concat(desired);
      }
    }
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
      target.textContent = messages.join("\n"); target.hidden = !messages.length;
    });
    const submit = root.querySelector<HTMLButtonElement>("[data-submit]");
    if (submit) submit.disabled = busy || !!payload?.preview || !payload?.exhibition?.accepting || issues.length > 0;
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
    if (work.kind === "book") return `<div class="work-photo-row"><div>${preview}${chooser}</div></div>`;
    return `<div class="work-photo-row"><div>${preview}${chooser}</div>
      <label>写真サイズ<select data-photo-paper="${index}" data-work-id="${work.id}"><option value="custom" ${paperSizeId(photo as PhotoLayout) === "custom" ? "selected" : ""}>自由入力</option>${paperSizes.map(size => `<option value="${size.id}" ${paperSizeId(photo as PhotoLayout) === size.id ? "selected" : ""}>${"label" in size ? size.label : size.id} (${size.width}×${size.height}mm)</option>`).join("")}</select></label><label>紙の向き<select data-photo-orientation="${index}" data-work-id="${work.id}"><option value="portrait" ${photo.width <= photo.height ? "selected" : ""}>縦</option><option value="landscape" ${photo.width > photo.height ? "selected" : ""}>横</option></select></label>
      <label>幅mm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="width" type="number" min=".1" step=".1" value="${escape(photo.width)}"/></label>
      <label>高mm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="height" type="number" min=".1" step=".1" value="${escape(photo.height)}"/></label>
      <label>Xmm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="x" type="number" step=".1" value="${escape(photo.x)}"/></label>
      <label>Ymm<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="y" type="number" step=".1" value="${escape(photo.y)}"/></label>
      <label>回転°<input data-work-id="${work.id}" data-photo-index="${index}" data-photo-key="rotation" type="number" min="-360" max="360" step=".1" value="${escape(photo.rotation)}"/></label></div>`;
  };
  const seriesEditor = createSeriesEditor({ getWork: id => workById(id) as Work, assetUrl: id => `/api/exhibitions/${exhibitionId}/assets/${id}?preview=1`, change: () => render(), message: status, busy: () => busy || !!payload?.preview || !payload?.exhibition?.accepting, width: () => root.clientWidth });
  const seriesCanvas = (work: AnyRecord) => seriesEditor.html(work as Work);
  const metadataHtml = (work:AnyRecord) => {
    if(!work.details && [work.location,work.equipment,work.settings].some(Boolean)) return `${[["location","撮影場所"],["equipment","使用機材"],["settings","撮影設定"]].map(([key,label])=>`<label>${label}（既存の記述）<input data-work-id="${work.id}" data-work-key="${key}" value="${escape(work[key])}"/></label>`).join("")}<button type="button" class="secondary" data-split-metadata="${work.id}">撮影情報を分割入力に切り替える</button>`;
    work.details??=emptyWorkDetails();
    const input=(key:string,label:string,placeholder="")=>`<label>${label}<input data-work-id="${work.id}" data-work-detail="${key}" value="${escape(work.details[key])}" placeholder="${placeholder}"/></label>`;
    return `<fieldset class="exhibition-metadata"><legend>撮影場所（任意）</legend>${input("place","地名")}
      <label>都道府県<select data-work-id="${work.id}" data-work-detail="prefecture"><option value="">選択してください</option>${[...prefectures,"海外・その他"].map(v=>`<option ${work.details.prefecture===v?"selected":""}>${v}</option>`).join("")}</select></label><div data-region-field="${work.id}" ${work.details.prefecture==="海外・その他"?"":"hidden"}>${input("region","国・地域")}</div></fieldset>
      <fieldset class="exhibition-metadata"><legend>使用機材（任意）</legend>${input("camera","カメラ")}${input("lens","レンズ")}${input("film","フィルム（任意）")}</fieldset>
      <fieldset class="exhibition-metadata"><legend>撮影設定（任意）</legend>${input("shutterSpeed","シャッタースピード","1/250秒")}${input("iso","ISO感度","400")}${input("fNumber","F値","2.8")}</fieldset>`;
  };
  const workHtml = (work: AnyRecord, index: number) => {
    const kindName = ({ single: "単写真", series: "組写真", book: "ブック" } as AnyRecord)[work.kind];
    const photos = `<h5 class="${work.kind === "book" ? "" : "required"}">${work.kind === "book" ? "ブックの作品データ（任意・表紙や内容の画像）" : "写真"}（JPEG・PNG、各20MB以下）</h5>${work.photos.map((photo: AnyRecord, photoIndex: number) => photoHtml(work, photo, photoIndex)).join("")}${seriesCanvas(work)}`;
    const custom = fieldsFor("work", work.sectionId, work.kind).map((field: AnyRecord) => fieldControl(field, work.fields?.[field.id], "work", work.id)).join("");
    return `<article class="exhibition-work"><h4>${kindName} ${index + 1}</h4><p class="exhibition-limit-warning" data-limit-errors="work" data-limit-id="${work.id}" aria-live="polite" hidden></p><div class="exhibition-form">
      <label class="required">作品タイトル<input data-work-id="${work.id}" data-work-key="title" maxlength="300" value="${escape(work.title)}" /></label>
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
      ${section.series ? `<div class="exhibition-grid">${section.seriesPhotoCounts.map((count: number, index: number) => `<label>組写真 ${index + 1} の写真枚数<input data-series-count="${index}" type="number" min="1" max="100" value="${count}" /></label>`).join("")}</div>` : ""}${sectionFields}<div class="exhibition-list">${grouped}</div></fieldset>`;
  };
  const bind = () => {
    root.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-work-detail]").forEach(input=>input.addEventListener("input",()=>{
      const work=workById(input.dataset.workId!); if(!work) return;
      work.details??=emptyWorkDetails();work.details[input.dataset.workDetail!]=input.value;Object.assign(work,metadataStrings(work.details));
      const region=root.querySelector<HTMLElement>(`[data-region-field="${work.id}"]`); if(region) region.hidden=work.details.prefecture!=="海外・その他";
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-split-metadata]").forEach(button=>button.addEventListener("click",()=>{
      if(!confirm("既存の記述は自動分解できません。撮影情報の各欄へ入力し直しますか？ 保存済みの提出履歴は残ります。"))return;
      const work=workById(button.dataset.splitMetadata!);work.details=emptyWorkDetails();Object.assign(work,metadataStrings(work.details));render();
    }));
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-field-id]").forEach(element => element.addEventListener("change", () => updateCustomField(element)));
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
    root.querySelectorAll<HTMLInputElement>("[data-count]").forEach(element => element.addEventListener("change", () => { const section = selectedSection(element.closest<HTMLElement>("[data-section]")?.dataset.section ?? ""); if (section) { section[element.dataset.count ?? "singles"] = Math.max(0, Math.floor(number(element.value))); synchronizeWorks(); render(); } }));
    root.querySelectorAll<HTMLInputElement>("[data-series-count]").forEach(element => element.addEventListener("change", () => { const section = selectedSection(element.closest<HTMLElement>("[data-section]")?.dataset.section ?? ""); if (section) { section.seriesPhotoCounts[Number(element.dataset.seriesCount)] = Math.max(1, Math.floor(number(element.value, 1))); synchronizeWorks(); render(); } }));
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
    const form = new FormData(); form.set("token", token); form.set("assetId", assetId); form.set("file", file);
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
  const save = async (action: "save" | "submit") => {
    if (!payload?.submission || busy) return;
    if(action==="submit") {
      if (refreshLimits().length) { status("作品数・大きさの上限を超えている作品を修正してください。下書きは保存できます。", true); return; }
      try { await ensureTextMeasurement(); } catch { status("文字の表示確認を読み込めませんでした。再度お試しください。",true);return; }
      const issues=validateTextFields(root,content() as SubmissionContent);
      if(issues.length) {status("文字量の警告がある項目を修正してください。",true);root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();return;}
    }
    busy = true; root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button").forEach(control => control.disabled = true); status(action === "submit" ? "提出内容を確認しています…" : "下書きを保存しています…");
    try {
      const response = await fetch(`/api/exhibitions/${exhibitionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, token, revision: payload.submission.revision, content: serializableContent() }) });
      const data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok) {
        if (data.effectiveLimits) payload.effectiveLimits = data.effectiveLimits;
        throw new Error(data.message ?? "保存できませんでした。");
      }
      payload = data; synchronizeWorks(); savedContent = JSON.stringify(content()); status(action === "submit" ? "提出しました。Googleフォーム連携は運営側で同期されます。" : "下書きを保存しました。"); render();
    } catch (error) { status(error instanceof Error ? error.message : "保存できませんでした。", true); }
    finally { busy = false; render(); }
  };
  const render = () => {
    if (!payload) return;
    synchronizeWorks();
    const draft = content(), schema = payload.schema;
    const readOnly = !payload.exhibition.accepting;
    const common = fieldsFor("common").map((field: AnyRecord) => fieldControl(field, draft.fields?.[field.id], "common")).join("");
    const sectionChoices = schema.sections.map((section: AnyRecord) => `<label><input data-section-toggle="${section.id}" type="checkbox" ${selectedSection(section.id) ? "checked" : ""}/> ${escape(section.title)}</label>`).join(" ");
    root.innerHTML = `<header><h1>${escape(payload.exhibition.title)} 出展フォーム</h1><p>${payload.preview ? "運営用のフォームプレビューです。保存・写真添付・提出はできません。" : "下書きはログイン中のアカウントに保存します。別の端末からも再開できます。"}</p></header>
      <p class="exhibition-status" aria-live="polite"></p>${readOnly ? '<p class="exhibition-muted">入力期間外のため、保存内容の確認のみ可能です。</p>' : ""}

      <section class="exhibition-editor"><fieldset><legend>出展者情報</legend><div class="exhibition-form"><label class="required">名前<input data-common="name" maxlength="150" value="${escape(draft.name)}"/></label><label class="required">学年<input data-common="grade" maxlength="100" value="${escape(draft.grade)}"/></label><label class="required">作者名<input data-common="authorName" maxlength="150" value="${escape(draft.authorName)}"/></label><label>外部Portfolio URL（登録済みアカウントがない場合）<input data-common="portfolioUrl" type="url" placeholder="https://…" value="${escape(draft.portfolioUrl)}"/></label>${common}</div></fieldset>
      <fieldset><legend>参加する展示</legend><p>通常展示と企画展示の両方を選べます。選択した展示ごとに、少なくとも一つの作品を入力してください。</p><div class="exhibition-actions">${sectionChoices}</div></fieldset>
      <p class="exhibition-limit-summary" data-limit-total></p><p class="exhibition-limit-warning" data-limit-errors="total" aria-live="polite" hidden></p>
      ${draft.sections.map((section: AnyRecord) => sectionHtml(section, schema.sections.find((item: AnyRecord) => item.id === section.sectionId))).join("")}
      <div class="exhibition-actions"><button class="secondary" data-save>下書きを保存</button><button data-submit>提出する</button></div></section>`;
    root.querySelectorAll<HTMLInputElement>("[data-common]").forEach(input => input.addEventListener("input", () => { draft[input.dataset.common ?? ""] = input.value; }));
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
    refreshLimits();
    if (readOnly || payload.preview) root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>("input, textarea, select, button").forEach(control => control.disabled = true);
    status(currentStatus.message, currentStatus.error, false);
  };
  const load = async () => {
    try {
      const preview = new URLSearchParams(location.search).get("preview") === "1";
      const url = `/api/exhibitions/${exhibitionId}?${preview ? "preview=1" : token ? `token=${encodeURIComponent(token)}` : ""}`;
      const response = await fetch(url), data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok) throw new Error(data.message ?? "フォームを読み込めませんでした。");
      payload = data;
      if (data.submission) { token = ""; if(location.hash) history.replaceState(null,"",location.pathname + location.search); render(); savedContent = JSON.stringify(content()); return; }
      root.innerHTML = `<header><h1>${escape(data.exhibition.title)} 出展フォーム</h1></header><p>${escape(data.exhibition.accepting ? "出展を開始すると、下書きが自分のアカウントに保存されます。" : data.participation?.message || "現在は受付期間外です。")}</p><div class="exhibition-actions">${data.exhibition.accepting ? '<button data-begin>出展を開始する</button>' : ""}<a class="exhibition-button secondary" href="/Member/exhibitions/${exhibitionId}">参加投票・入力期間を確認</a></div><p class="exhibition-status" aria-live="polite"></p>`;
      root.querySelector<HTMLButtonElement>("[data-begin]")?.addEventListener("click", begin);
    } catch (error) { root.innerHTML = `<p class="exhibition-status error">${escape(error instanceof Error ? error.message : "フォームを読み込めませんでした。")}</p>`; }
  };
  const begin = async () => {
    if (busy) return;
    busy = true;
    status("出展フォームを準備しています…");
    try {
      const response = await fetch(`/api/exhibitions/${exhibitionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "begin", revision: 0 }) }), data = await readExhibitionResponse(response);
      if (!response.ok || !data.ok || !data.submission) throw new Error(data.message ?? "開始できませんでした。");
      token = ""; history.replaceState(null, "", location.pathname); payload = data; render(); savedContent = JSON.stringify(content()); status("自分のアカウントに出展フォームを作成しました。");
    } catch (error) { status(error instanceof Error ? error.message : "開始できませんでした。", true); }
    finally { busy = false; refreshLimits(); }
  };
  void load();
}
