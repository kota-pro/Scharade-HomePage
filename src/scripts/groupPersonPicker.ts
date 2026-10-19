type Person = { id: string; name: string };
const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
export function setupPersonPicker(container: HTMLElement, people: Person[]) {
  const input = container.querySelector<HTMLInputElement>(
    "[data-person-search]",
  )!;
  const select = container.querySelector<HTMLSelectElement>(
    "[data-person-select]",
  )!;
  const status = container.querySelector<HTMLElement>("[data-person-matches]")!;
  const emptyLabel = select.options[0]?.textContent || "選択してください";
  const update = () => {
    const query = normalize(input.value),
      current = select.value;
    const matches = people.filter((p) => normalize(p.name).includes(query));
    const options = matches.map(
      (p) => new Option(p.name, p.id, false, p.id === current),
    );
    // Filtering never clears an already chosen person or selects a different person.
    const selected = people.find((p) => p.id === current);
    if (selected && !matches.some((p) => p.id === current))
      options.unshift(
        new Option(`${selected.name}（選択中）`, current, false, true),
      );
    select.replaceChildren(
      new Option(emptyLabel, "", false, !current),
      ...options,
    );
    select.value = current;
    status.textContent = query
      ? `${matches.length}人が一致${selected && !matches.some((p) => p.id === current) ? "・選択中の人も表示しています" : ""}`
      : "";
  };
  input.addEventListener("input", update);
  input.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) event.preventDefault(); });
  select.addEventListener("change", update);
}
export function createPersonPicker(
  people: Person[],
  title: string,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "activity-person-picker";
  container.dataset.personPicker = "";
  const input = document.createElement("input");
  input.type = "search";
  input.dataset.personSearch = "";
  input.setAttribute("aria-label", `${title}を検索`);
  input.placeholder = "氏名・LINE名で検索";
  input.autocomplete = "off";
  const select = document.createElement("select");
  select.required = true;
  select.dataset.personSelect = "";
  select.setAttribute("aria-label", title);
  select.add(new Option("選択してください", ""));
  people.forEach((p) => select.add(new Option(p.name, p.id)));
  const status = document.createElement("small");
  status.dataset.personMatches = "";
  status.setAttribute("aria-live", "polite");
  container.append(input, select, status);
  setupPersonPicker(container, people);
  return container;
}
