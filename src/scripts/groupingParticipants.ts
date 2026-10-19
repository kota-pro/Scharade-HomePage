import { genderLabels, gradeLabels, type Participant } from "../lib/activityTypes";
import { readApiResponse, apiErrorMessage } from "./apiResponse";
const key = (value: string) => value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
const display = (p: {name: string; lineName?: string}) => p.name + (p.lineName ? `（${p.lineName}）` : "");
document.querySelectorAll<HTMLElement>("[data-grouping-participants]").forEach(root => {
  const candidates: Participant[] = JSON.parse(root.dataset.candidates || "[]");
  const form = root.querySelector<HTMLFormElement>('form[data-activity-action="run.save"]')!;
  const status = root.querySelector<HTMLElement>("[data-participant-status]")!;
  const preview = root.querySelector<HTMLElement>("[data-participant-preview]")!;
  const rows = root.querySelector<HTMLElement>("[data-participant-rows]")!;
  const url = root.querySelector<HTMLInputElement>("[data-participant-url]")!;
  const mapping = root.querySelector<HTMLElement>("[data-participant-mapping]")!;
  const importControls = root.querySelector<HTMLElement>(".grouping-participant-import")!;
  const pending = new Map<string, Participant>();
  let loadedUrl = "", busy = false;
  function message(text: string, error = false) { status.textContent = text; status.dataset.error = String(error); }
  function addRow(person: { name: string; grade: string; gender: string; lineName?: string }, rowNumber?: number) {
    const row = document.createElement("fieldset"); row.className = "grouping-import-row";
    const checkLabel = document.createElement("label"), check = document.createElement("input");
    check.type = "checkbox"; check.checked = true; check.dataset.importSelected = "";
    checkLabel.append(check, rowNumber ? `シートの${rowNumber}行目を追加` : "入力した参加者を追加");
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
      const matches = candidates.filter(p => key(p.name) === key(name) || !!lineName && !!p.lineName && key(p.lineName) === key(lineName));
      match.replaceChildren(new Option(matches.length > 1 ? "同姓同名の候補があります。選択してください" : "選択してください", ""), new Option("新しい参加者として追加", "new"));
      matches.forEach(p => match.add(new Option(`${display(p)}（${gradeLabels[p.grade]}・${genderLabels[p.gender]}）`, p.id)));
      match.value = matches.length === 1 ? matches[0].id : matches.length ? "" : "new";
      updateFields();
    }
    function updateFields() {
      const existing = candidates.find(p => p.id === match.value);
      fields.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-import-field]").forEach(c => {
        // Name remains editable to correct mistaken identity suggestions.
        c.disabled = !!existing && c.dataset.importField !== "name" && c.dataset.importField !== "lineName";
      });
    }
    match.addEventListener("change", updateFields); matchLabel.append(match); row.append(checkLabel,fields,matchLabel); rows.append(row);
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
    if (rows.children.length && !window.confirm("確認一覧を読み込んだシートの内容に置き換えます。まだ追加していない入力は失われます。よろしいですか？")) return;
    const selectedColumns = Object.fromEntries([...mapping.querySelectorAll<HTMLSelectElement>("[data-participant-column]")].map(c => [c.dataset.participantColumn!, Number(c.value)]));
    const inputUrl = url.value.trim();
    busy = true; message("参加者を読み込んでいます…");
    const controls = [...importControls.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select")].filter(c => !c.disabled);
    controls.forEach(c => c.disabled = true);
    try {
      const response = await fetch("/api/member/grouping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "participants.preview", url: inputUrl, ...(remap && inputUrl === loadedUrl ? { columns: selectedColumns } : {}) }) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok) throw new Error(result.message || "シートを読み込めませんでした。");
      loadedUrl = inputUrl;
      mapping.hidden = false;
      root.querySelector<HTMLElement>("[data-participant-source]")!.textContent = `${result.title} ／ ${result.sheetTitle}`;
      mapping.querySelectorAll<HTMLSelectElement>("[data-participant-column]").forEach(c => {
        c.replaceChildren(new Option("読み込まない・未検出", "-1"));
        result.headers.forEach((header: string, i: number) => c.add(new Option(`${i+1}列目：${header || "見出しなし"}`, String(i))));
        c.value = String(result.columns[c.dataset.participantColumn!]);
      });
      rows.replaceChildren(); preview.hidden = true;
      result.rows.forEach((p: any) => addRow(p, p.row));
      message(result.columns.name < 0 ? "名前の列を選択して読み直してください。" : `${result.rows.length}人を読み込みました。内容を確認して追加してください。`);
    } catch (error) { message(apiErrorMessage(error), true); }
    finally { busy = false; controls.forEach(c => c.disabled = false); }
  }
  root.querySelector("[data-participant-load]")!.addEventListener("click", () => void load(false));
  root.querySelector("[data-participant-remap]")!.addEventListener("click", () => void load(true));
  root.querySelector("[data-participant-manual-add]")!.addEventListener("click", () => {
    const inputs = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-guest-field]")];
    const values = Object.fromEntries(inputs.map(c => [c.dataset.guestField!, c.value.trim()]));
    if (!values.name || !values.grade || !values.gender) { message("名前・学年・性別を入力してください。", true); return; }
    addRow(values as any); inputs.forEach(c => c.value = ""); message("確認一覧に追加しました。同じ参加者の確認後、参加者に追加してください。");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-preview-select]").forEach(button => button.addEventListener("click", () => rows.querySelectorAll<HTMLInputElement>("[data-import-selected]").forEach(c => c.checked = button.dataset.previewSelect === "all")));
  root.querySelector("[data-participant-clear]")!.addEventListener("click", () => { rows.replaceChildren(); preview.hidden = true; message(""); });
  root.querySelector("[data-participant-confirm]")!.addEventListener("click", () => {
    const additions: Participant[] = [];
    for (const row of rows.querySelectorAll<HTMLElement>(".grouping-import-row")) {
      if (!row.querySelector<HTMLInputElement>("[data-import-selected]")!.checked) continue;
      const match = row.querySelector<HTMLSelectElement>("[data-import-match]")!;
      if (!match.reportValidity()) return;
      const existing = candidates.find(p => p.id === match.value);
      if (existing) { additions.push(existing); continue; }
      const inputs = [...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-import-field]")];
      if (inputs.some(c => !c.reportValidity())) return;
      const values = Object.fromEntries(inputs.map(c => [c.dataset.importField!, c.value.trim()]));
      if (!values.name) { message("名前を入力してください。", true); return; }
      additions.push({ ...values, id: `guest-${crypto.randomUUID()}` } as Participant);
    }
    const selected = [...form.querySelectorAll<HTMLInputElement>('[name="participantIds"]:checked')].map(c => c.value);
    if (!additions.length) { message("追加する人を選択してください。", true); return; }
    if (new Set([...selected, ...additions.map(p => p.id)]).size > 200) { message("参加者は200人以内にしてください。", true); return; }
    const picker = form.querySelector<HTMLElement>(".activity-recipients")!, options = picker.querySelector<HTMLElement>(".activity-recipient-options")!;
    for (const person of additions) {
      let input = [...options.querySelectorAll<HTMLInputElement>('[name="participantIds"]')].find(c => c.value === person.id);
      if (!input) {
        candidates.push(person); pending.set(person.id, person);
        const label = document.createElement("label"); label.className = "activity-check";
        label.dataset.recipientName = display(person); label.dataset.recipientGrade = person.grade;
        input = document.createElement("input"); input.type = "checkbox"; input.name = "participantIds"; input.value = person.id; input.dataset.recipientId = person.id;
        label.append(input, `${display(person)}（${gradeLabels[person.grade]}）`); options.append(label);
      }
      input.checked = true;
    }
    form.dataset.extraParticipants = JSON.stringify([...pending.values()]); form.dataset.dirty = "true";
    picker.dispatchEvent(new Event("recipients:updated")); rows.replaceChildren(); preview.hidden = true;
    message(`${new Set(additions.map(p => p.id)).size}人を選択しました。下の保存ボタンで参加者を保存してください。`);
  });
});
