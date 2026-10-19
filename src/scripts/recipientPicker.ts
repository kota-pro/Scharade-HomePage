const normalize = (value: string) => value.normalize("NFKC").replace(/\s/g, "").toLocaleLowerCase("ja");

export function bindRecipientPicker(section: HTMLElement, changed?: (ids: string[]) => void) {
  let choices: HTMLInputElement[] = [];
  let labels: HTMLElement[] = [];
  const search = section.querySelector<HTMLInputElement>("[data-recipient-search]");
  const grade = section.querySelector<HTMLSelectElement>("[data-recipient-grade]");
  const refresh = () => {
    choices = [...section.querySelectorAll<HTMLInputElement>("[data-recipient-id]")];
    labels = [...section.querySelectorAll<HTMLElement>("[data-recipient-name]")];
    const query = normalize(search?.value ?? ""), group = grade?.value ?? "";
    for (const label of labels) label.hidden = !!(group && label.dataset.recipientGrade !== group) || !normalize(label.dataset.recipientName ?? "").includes(query);
    const count = section.querySelector<HTMLElement>("[data-recipient-count]");
    if (count) count.textContent = `選択中 ${choices.filter(c => c.checked).length}人 / ${choices.length}人（表示 ${labels.filter(l => !l.hidden).length}人）`;
  };
  const change = () => {
    const form = section.closest("form");
    if (form) form.dataset.dirty = "true";
    changed?.(choices.filter(c => c.checked).map(c => c.dataset.recipientId!));
    refresh();
  };
  section.addEventListener("change", event => { if ((event.target as HTMLElement).matches("[data-recipient-id]")) change(); });
  section.addEventListener("recipients:updated", refresh);
  section.querySelectorAll<HTMLButtonElement>("[data-select-recipients]").forEach(button => button.addEventListener("click", () => {
    const action = button.dataset.selectRecipients!, grouped = action.startsWith("grade-");
    if (grouped && !grade?.value) return;
    for (const choice of choices) {
      if (choice.matches(":disabled") || (grouped && choice.closest<HTMLElement>("[data-recipient-name]")?.dataset.recipientGrade !== grade?.value)) continue;
      choice.checked = action === "all" || action === "grade-all";
    }
    change();
  }));
  search?.addEventListener("input", refresh);
  grade?.addEventListener("change", refresh);
  refresh();
}
