import {
  genderLabels,
  type Participant,
  type Group,
  type GroupRules,
} from "../lib/activityTypes";
import {
  groupGrade,
  groupGradeLabel,
  groupGradeLabels,
} from "../lib/groupingGrade";
import {
  validateGroups,
  groupScore,
  groupPairs,
  groupPreferenceWarnings,
} from "../lib/grouping";
import {
  displayName,
  sortGroupPeople,
  personLabel,
  warningText,
} from "../lib/groupPresentation";

export function selectedGroups(form: HTMLFormElement): Group[] {
  const rules: GroupRules = JSON.parse(form.dataset.rules!);
  return Array.from({ length: rules.count }, (_, i) => ({
    leaderId: rules.leaders[i] || "",
    memberIds: [...form.querySelectorAll<HTMLInputElement>("[data-assignment]")]
      .filter((input) => input.value !== "" && Number(input.value) === i)
      .map((input) => input.dataset.assignment!),
  }));
}
export function setupGroupBoard(form: HTMLFormElement) {
  const people: Participant[] = JSON.parse(form.dataset.people!);
  const rules: GroupRules = JSON.parse(form.dataset.rules!);
  const history = groupPairs(JSON.parse(form.dataset.history || "[]"));
  const board = form.querySelector<HTMLElement>("[data-group-board]")!;
  const summary = form.querySelector<HTMLElement>("[data-group-summary]")!;
  const status = form.querySelector<HTMLElement>("[data-swap-status]")!;
  const cancel = form.querySelector<HTMLButtonElement>("[data-cancel-swap]")!;
  const inputs = new Map(
    [...form.querySelectorAll<HTMLInputElement>("[data-assignment]")].map(
      (input) => [input.dataset.assignment!, input],
    ),
  );
  const buttons = new Map(
    [...board.querySelectorAll<HTMLButtonElement>("[data-person-id]")].map(
      (button) => [button.dataset.personId!, button],
    ),
  );
  let selected = "";
  const update = () => {
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.personId
        : undefined;
    const groups = selectedGroups(form),
      problems = validateGroups(people, rules, groups);
    const warnings = groupPreferenceWarnings(groups, rules, history);
    const flagged = new Set(warnings.flatMap((w) => w.ids));
    const placed = new Set(groups.flatMap((g) => g.memberIds));
    board
      .querySelectorAll<HTMLElement>("[data-group-index]")
      .forEach((card) => {
        const index = card.dataset.groupIndex!;
        const group = index === "" ? undefined : groups[Number(index)];
        const members = sortGroupPeople(
          people.filter((p) =>
            group ? group.memberIds.includes(p.id) : !placed.has(p.id),
          ),
          group?.leaderId || "",
        );
        card.hidden = index === "" && !members.length;
        card.querySelector("[data-member-count]")!.textContent =
          `${members.length}人`;
        const items = members.map((p) => {
          const button = buttons.get(p.id)!;
          const leader = group?.leaderId === p.id;
          button.dataset.warning = String(flagged.has(p.id));
          button.setAttribute("aria-pressed", String(selected === p.id));
          button.setAttribute("aria-label", personLabel(p, leader));
          const meta = button.querySelector<HTMLElement>(".group-person-meta")!;
          meta.textContent = groupGradeLabel(p.grade);
          if (leader) {
            const badge = document.createElement("span");
            badge.className = "group-leader";
            badge.textContent = "リーダー";
            meta.append(badge);
          }
          return button.closest("li")!;
        });
        card.querySelector("[data-group-members]")!.replaceChildren(...items);
        const move = card.querySelector<HTMLButtonElement>("[data-move-to]");
        if (move)
          move.hidden = !selected || inputs.get(selected)?.value === index;
      });
    cancel.hidden = !selected;
    board.querySelector<HTMLElement>("[data-preference-warnings]")!.hidden =
      !warnings.length;
    board.querySelector("[data-warning-list]")!.replaceChildren(
      ...warnings.map((w) => {
        const li = document.createElement("li");
        li.textContent = warningText(w, people);
        return li;
      }),
    );
    const lines = groups.map((g, i) => {
      const members = people.filter((p) => g.memberIds.includes(p.id));
      const composition = [
        ...Object.entries(genderLabels)
          .filter(([v]) => members.some((p) => p.gender === v))
          .map(
            ([v, label]) =>
              `${label}${members.filter((p) => p.gender === v).length}人`,
          ),
        ...Object.entries(groupGradeLabels)
          .filter(([v]) => members.some((p) => groupGrade(p.grade) === v))
          .map(
            ([v, label]) =>
              `${label}${members.filter((p) => groupGrade(p.grade) === v).length}人`,
          ),
      ];
      return `${i + 1}班：${members.length}人（${composition.join("、")}）`;
    });
    lines.push(`前回と同班のペア：${groupScore(people, groups, history)[1]}組`);
    summary.querySelector<HTMLElement>(
      "[data-group-composition]",
    )!.textContent = lines.join("\n");
    summary.querySelector<HTMLElement>("[data-group-errors]")!.hidden =
      !problems.length;
    summary.querySelector<HTMLElement>("[data-group-valid]")!.hidden =
      problems.length > 0;
    summary.querySelector("[data-group-error-list]")!.replaceChildren(
      ...problems.map((problem) => {
        const li = document.createElement("li");
        li.textContent = problem;
        return li;
      }),
    );
    if (focused) buttons.get(focused)?.focus({ preventScroll: true });
  };
  const name = (id: string) => displayName(people.find((p) => p.id === id)!);
  board.addEventListener("click", (event) => {
    if (form.dataset.busy === "true" || !(event.target instanceof Element))
      return;
    const person = event.target.closest<HTMLElement>("[data-person-id]");
    if (person) {
      const id = person.dataset.personId!;
      if (!selected) {
        selected = id;
        status.textContent = `${name(id)}を選択しました。入れ替える2人目を選択してください。`;
      } else if (selected === id) {
        selected = "";
        status.textContent =
          "選択を解除しました。入れ替える1人目を選択してください。";
      } else {
        const a = inputs.get(selected)!,
          b = inputs.get(id)!;
        if (a.value === b.value) {
          status.textContent =
            "同じ班のため入れ替えは不要です。別の班の人を選択してください。";
          return;
        }
        [a.value, b.value] = [b.value, a.value];
        status.textContent = `${name(selected)}と${name(id)}を入れ替えました。班案を保存してください。`;
        selected = "";
        form.dataset.dirty = "true";
      }
      update();
      return;
    }
    const move = event.target.closest<HTMLElement>("[data-move-to]");
    if (move && selected) {
      inputs.get(selected)!.value = move.dataset.moveTo!;
      status.textContent = `${name(selected)}を${Number(move.dataset.moveTo) + 1}班へ移動しました。班案を保存してください。`;
      const moved = selected;
      selected = "";
      form.dataset.dirty = "true";
      update();
      buttons.get(moved)?.focus({ preventScroll: true });
    }
  });
  const clear = () => {
    if (form.dataset.busy === "true") return;
    selected = "";
    status.textContent =
      "選択を解除しました。入れ替える1人目を選択してください。";
    update();
  };
  cancel.addEventListener("click", clear);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selected) {
      event.preventDefault();
      const id = selected;
      clear();
      buttons.get(id)?.focus();
    }
  });
  update();
}
