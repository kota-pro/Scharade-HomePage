import { genderLabels, gradeLabels } from "../lib/activityTypes";
import type { GroupingParticipant, GroupingParticipantSource } from "../lib/groupingParticipants";
import { readApiResponse, apiErrorMessage } from "./apiResponse";
const key = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const display = (p: {name: string; lineName?: string}) => p.name + (p.lineName ? `（${p.lineName}）` : "");
type ImportPerson = { name: string; grade: string; gender: string; lineName?: string; participantId?: string };
document.querySelectorAll<HTMLElement>("[data-grouping-participants]").forEach(root => {
  const candidates: GroupingParticipant[] = JSON.parse(root.dataset.candidates || "[]");
  const form = root.querySelector<HTMLFormElement>('form[data-activity-action="run.save"]')!;
  const status = root.querySelector<HTMLElement>("[data-participant-status]")!;
  const preview = root.querySelector<HTMLElement>("[data-participant-preview]")!;
  const rows = root.querySelector<HTMLElement>("[data-participant-rows]")!;
  const url = root.querySelector<HTMLInputElement>("[data-participant-url]")!;
  const mapping = root.querySelector<HTMLElement>("[data-participant-mapping]")!;
  const importControls = root.querySelector<HTMLElement>(".grouping-participant-import")!;
  const eventSelect = root.querySelector<HTMLSelectElement>("[data-participant-event]");
  const groups = [...rows.querySelectorAll<HTMLElement>("[data-import-group]")];
  const pending = new Map<string, GroupingParticipant>();
  const sources = new Map<string, GroupingParticipantSource>(Object.entries(JSON.parse(form.dataset.participantSources || "{}")));
  let loadedUrl = "", busy = false;
  function message(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function clearRows(source?: GroupingParticipantSource) {
    for (const group of groups) {
      if (source && group.dataset.importGroup !== source) continue;
      group.querySelector("[data-import-group-rows]")!.replaceChildren();
      group.hidden = true;
    }
    preview.hidden = groups.every(group => group.hidden);
  }
  function addRow(person: ImportPerson, source: GroupingParticipantSource, rowNumber?: number) {
    const row = document.createElement("fieldset"); row.className = "grouping-import-row";
    row.dataset.importSource = source;
    const checkLabel = document.createElement("label"), check = document.createElement("input");
    check.type = "checkbox"; check.checked = true; check.dataset.importSelected = "";
    checkLabel.append(check, source === "event" ? `${person.name}を追加`
      : rowNumber ? `シートの${rowNumber}行目を追加` : "入力した参加者を追加");
    const fields = document.createElement("div"); fields.className = "grouping-import-fields";
    for (const [field, label] of [["name", "名前"], ["grade", "学年"], ["gender", "性別"], ["lineName", "LINE名（任意）"]] as const) {
      const wrapper = document.createElement("label"); wrapper.append(label);
      let control: HTMLInputElement | HTMLSelectElement;
      if (field === "gender" || field === "grade") {
        control = document.createElement("select"); control.add(new Option("選択してください", ""));
        Object.entries(field === "gender" ? genderLabels : gradeLabels).forEach(([value,text]) => (control as HTMLSelectElement).add(new Option(text,value)));
      } else { control = document.createElement("input"); control.maxLength = 200; }
      control.dataset.importField = field; control.value = person[field] || ""; control.required = field !== "lineName";
      wrapper.append(control); fields.append(wrapper);
    }
    const matchLabel = document.createElement("label"), match = document.createElement("select");
    matchLabel.append("同じ参加者の確認"); match.dataset.importMatch = ""; match.required = true;
    function matchOptions() {
      const name = row.querySelector<HTMLInputElement>('[data-import-field="name"]')!.value;
      const lineName = row.querySelector<HTMLInputElement>('[data-import-field="lineName"]')!.value;
      const exact = name === person.name && lineName === (person.lineName || "") && person.participantId
        ? candidates.find(candidate => candidate.id === person.participantId) : undefined;
      const matches = candidates.filter(p => p.id === exact?.id || key(p.name) === key(name) || !!lineName && !!p.lineName && key(p.lineName) === key(lineName));
      match.replaceChildren(new Option(matches.length > 1 ? "同姓同名の候補があります。選択してください" : "選択してください", ""), new Option("新しい参加者として追加", "new"));
      matches.forEach(p => match.add(new Option(`${display(p)}（${gradeLabels[p.grade]}・${genderLabels[p.gender]}）`, p.id)));
      match.value = exact?.id ?? (matches.length === 1 && source !== "event" ? matches[0].id : matches.length ? "" : "new");
      updateFields();
    }
    function updateFields() {
      const existing = candidates.find(p => p.id === match.value);
      fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-import-field]").forEach(c => {
        // Name remains editable to correct mistaken identity suggestions.
        c.disabled = !!existing && c.dataset.importField !== "name" && c.dataset.importField !== "lineName";
      });
    }
    match.addEventListener("change", updateFields);
    matchLabel.append(match);
    row.append(checkLabel, fields, matchLabel);
    const group = groups.find(group => group.dataset.importGroup === source)!;
    group.querySelector("[data-import-group-rows]")!.append(row);
    group.hidden = false;
    fields.querySelectorAll<HTMLInputElement>('[data-import-field="name"], [data-import-field="lineName"]').forEach(c => c.addEventListener("change", matchOptions));
    matchOptions();
    const sameRows = [...rows.querySelectorAll<HTMLElement>(".grouping-import-row")].filter(r => key(r.querySelector<HTMLInputElement>('[data-import-field="name"]')!.value) === key(person.name));
    if (sameRows.length > 1) for (const other of sameRows) {
      const choice = other.querySelector<HTMLSelectElement>("[data-import-match]")!;
      if (choice.value === "new") { choice.value = ""; choice.options[0].textContent = "同じ名前の行があります。別人として追加するか、不要な行のチェックを外してください"; }
    }
    preview.hidden = false;
  }
  async function load(remap: boolean) {
    if (busy) return;
    if (!url.value.trim() || !url.reportValidity()) { message("gidを含むスプレッドシートURLを入力してください。", true); return; }
    if (rows.querySelector('[data-import-source="sheet"]') && !window.confirm("スプレッドシートの確認欄を読み込んだ内容に置き換えますか？")) return;
    const selectedColumns = Object.fromEntries([...mapping.querySelectorAll<HTMLSelectElement>("[data-participant-column]")].map(c => [c.dataset.participantColumn!, Number(c.value)]));
    const inputUrl = url.value.trim();
    await readPreview({ action: "participants.preview", url: inputUrl, ...(remap && inputUrl === loadedUrl ? { columns: selectedColumns } : {}) }, result => {
      loadedUrl = inputUrl;
      mapping.hidden = false;
      root.querySelector<HTMLElement>("[data-participant-source]")!.textContent = `${result.title} ／ ${result.sheetTitle}`;
      mapping.querySelectorAll<HTMLSelectElement>("[data-participant-column]").forEach(c => {
        c.replaceChildren(new Option("読み込まない・未検出", "-1"));
        result.headers.forEach((header: string, i: number) => c.add(new Option(`${i+1}列目：${header || "見出しなし"}`, String(i))));
        c.value = String(result.columns[c.dataset.participantColumn!]);
      });
      clearRows("sheet");
      result.rows.forEach((p: ImportPerson & { row: number }) => addRow(p, "sheet", p.row));
      message(result.columns.name < 0 ? "名前の列を選択して読み直してください。" : `${result.rows.length}人を読み込みました。内容を確認して追加してください。`);
    });
  }
  async function readPreview(payload: Record<string, unknown>, update: (result: Awaited<ReturnType<typeof readApiResponse>>) => void) {
    if (busy) return;
    busy = true;
    message("参加者を読み込んでいます…");
    const controls = [...importControls.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")].filter(c => !c.disabled);
    controls.forEach(control => control.disabled = true);
    try {
      const response = await fetch("/api/member/grouping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message || "参加者を読み込めませんでした。");
      update(result);
    } catch (error) { message(apiErrorMessage(error), true); }
    finally { busy = false; controls.forEach(c => c.disabled = false); }
  }
  root.querySelector("[data-participant-event-load]")?.addEventListener("click", () => {
    const eventId = eventSelect?.value;
    if (!eventId) { message("企画を選択してください。", true); return; }
    if (rows.querySelector('[data-import-source="event"]') && !window.confirm("企画の参加投票の確認欄を読み込んだ内容に置き換えますか？")) return;
    void readPreview({ action: "participants.event", eventId }, result => {
      clearRows("event");
      result.rows.forEach((person: ImportPerson) => addRow(person, "event"));
      message(result.rows.length
        ? `${result.title}の参加回答を${result.rows.length}人分読み込みました。学年・性別が空欄の人は入力してください。`
        : "この企画に「参加」と回答した人はまだいません。");
    });
  });
  root.querySelector("[data-participant-load]")!.addEventListener("click", () => void load(false));
  root.querySelector("[data-participant-remap]")!.addEventListener("click", () => void load(true));
  root.querySelector("[data-participant-manual-add]")!.addEventListener("click", () => {
    const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-guest-field]")];
    const values = Object.fromEntries(inputs.map(c => [c.dataset.guestField!, c.value.trim()]));
    if (!values.name || !values.grade || !values.gender) { message("名前・学年・性別を入力してください。", true); return; }
    addRow(values as ImportPerson, "manual"); inputs.forEach(c => c.value = ""); message("確認一覧に追加しました。同じ参加者の確認後、参加者に追加してください。");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-preview-select]").forEach(button => button.addEventListener("click", () => rows.querySelectorAll<HTMLInputElement>("[data-import-selected]").forEach(c => c.checked = button.dataset.previewSelect === "all")));
  root.querySelector("[data-participant-clear]")!.addEventListener("click", () => { clearRows(); message(""); });
  root.querySelector("[data-participant-confirm]")!.addEventListener("click", () => {
    const additions: { person: GroupingParticipant; source: GroupingParticipantSource }[] = [];
    for (const row of rows.querySelectorAll<HTMLElement>(".grouping-import-row")) {
      if (!row.querySelector<HTMLInputElement>("[data-import-selected]")!.checked) continue;
      const match = row.querySelector<HTMLSelectElement>("[data-import-match]")!;
      const source = row.dataset.importSource as GroupingParticipantSource;
      if (!match.reportValidity()) return;
      const existing = candidates.find(p => p.id === match.value);
      if (existing) { additions.push({ person: existing, source }); continue; }
      const inputs = [...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-import-field]")];
      if (inputs.some(c => !c.reportValidity())) return;
      const values = Object.fromEntries(inputs.map(c => [c.dataset.importField!, c.value.trim()]));
      if (!values.name) { message("名前を入力してください。", true); return; }
      const person = { ...values, id: `guest-${crypto.randomUUID()}`, inputSource: source } as GroupingParticipant;
      additions.push({ person, source });
    }
    const selected = [...form.querySelectorAll<HTMLInputElement>('[name="participantIds"]:checked')].map(c => c.value);
    if (!additions.length) { message("追加する人を選択してください。", true); return; }
    if (new Set([...selected, ...additions.map(({person}) => person.id)]).size > 200) { message("参加者は200人以内にしてください。", true); return; }
    const picker = form.querySelector<HTMLElement>(".activity-recipients")!;
    for (const { person, source } of additions) {
      if (!sources.has(person.id)) sources.set(person.id, source);
      const options = picker.querySelector<HTMLElement>(`[data-recipient-group="${sources.get(person.id)}"] .activity-recipient-options`)!;
      let input = [...picker.querySelectorAll<HTMLInputElement>('[name="participantIds"]')].find(c => c.value === person.id);
      if (!input) {
        candidates.push(person); pending.set(person.id, person);
        const label = document.createElement("label"); label.className = "activity-check";
        label.dataset.recipientName = display(person); label.dataset.recipientGrade = person.grade;
        input = document.createElement("input"); input.type = "checkbox"; input.name = "participantIds"; input.value = person.id; input.dataset.recipientId = person.id;
        label.append(input, `${display(person)}（${gradeLabels[person.grade]}）`); options.append(label);
      } else {
        options.append(input.closest("label")!);
      }
      input.checked = true;
    }
    form.dataset.extraParticipants = JSON.stringify([...pending.values()]);
    form.dataset.participantSources = JSON.stringify(Object.fromEntries(sources));
    form.dataset.dirty = "true";
    picker.dispatchEvent(new Event("recipients:updated"));
    clearRows();
    message(`${new Set(additions.map(({person}) => person.id)).size}人を選択しました。下の保存ボタンで参加者を保存してください。`);
  });
});
