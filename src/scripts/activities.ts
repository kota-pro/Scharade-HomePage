import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice, flashNotice } from "./siteNotice";
import { bindRecipientPicker } from "./recipientPicker";
import type { Participant } from "../lib/activityTypes";
import { selectedGroups, setupGroupBoard } from "./groupBoard";
import { setupPersonPicker, createPersonPicker } from "./groupPersonPicker";
import { setupEventEditor } from "./activityEventEditor";
import { initRichBodyEditor } from "./richBodyEditor";

async function send(
  payload: Record<string, unknown>,
  endpoint = "/api/member/activities",
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: payload.action === "notification.read",
    body: JSON.stringify(payload),
  });
  const result = await readApiResponse(response);
  if (!response.ok || !result.ok)
    throw new Error(result.message || "保存できませんでした。");
  return result;
}
function selectPeople(
  people: { id: string; name: string }[],
  current = "",
  name?: string,
) {
  const select = document.createElement("select");
  select.required = true;
  if (name) select.name = name;
  select.add(new Option("選択してください", ""));
  people.forEach((p) =>
    select.add(new Option(p.name, p.id, false, p.id === current)),
  );
  return select;
}
document
  .querySelectorAll<HTMLFormElement>("form[data-activity-action]")
  .forEach((form) => {
    const action = form.dataset.activityAction!;
    const status = form.querySelector<HTMLElement>("[data-status]")!;
    const richFields = new Map([...form.querySelectorAll<HTMLElement>("[data-body-field]")]
      .map(root => [root.dataset.bodyField!, initRichBodyEditor(root)] as const));
    const eventEditor = action === "event.save" ? setupEventEditor(form, richFields) : null;
    let busy = false;
    form.addEventListener("input", (event) => {
      if ((event.target as HTMLElement).hasAttribute("data-person-search"))
        return;
      form.dataset.dirty = "true";
    });
    form.addEventListener("change", (event) => {
      if ((event.target as HTMLElement).hasAttribute("data-person-search"))
        return;
      form.dataset.dirty = "true";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      if (![...richFields.values()].every(editor => editor.validate())) return;
      if (eventEditor && !eventEditor.beforeSave()) return;
      status.textContent = "";
      status.dataset.error = "false";
      const dirtyRules = document.querySelector<HTMLFormElement>(
        'form[data-activity-action="groups.rules"][data-dirty="true"]',
      );
      const dirtyParticipants = document.querySelector<HTMLFormElement>(
        'form[data-activity-action="run.save"][data-dirty="true"]',
      );
      const dirtyGroups = document.querySelector<HTMLFormElement>(
        'form[data-activity-action="groups.save"][data-dirty="true"]',
      );
      if (
        (["groups.generate", "groups.save", "groups.publish"].includes(
          action,
        ) &&
          (dirtyRules || dirtyParticipants)) ||
        (action === "groups.publish" && dirtyGroups)
      ) {
        status.textContent =
          "編集中の参加者・条件・班案を先に保存してください。";
        status.dataset.error = "true";
        return;
      }
      if (
        form.dataset.publishConfirm &&
        !window.confirm(form.dataset.publishConfirm)
      )
        return;
      const fd = new FormData(form);
      const payload: Record<string, unknown> = {
        ...Object.fromEntries(fd),
        action,
      };
      delete payload.headerFile;
      for (const [name, editor] of richFields) payload[`${name}Html`] = editor.html();
      for (const key of ["id", "eventId", "draftId", "runId", "userId", "source"] as const)
        if (form.dataset[key]) payload[key] = form.dataset[key];
      if (form.dataset.revision)
        payload.revision = Number(form.dataset.revision);
      if (action === "notification.send" || action === "event.save")
        payload.recipientIds = fd.getAll("recipientIds");
      if (action === "event.save")
        for (const key of ["startsAt", "endsAt", "deadline"])
          payload[key] = `${fd.get(key)}:00+09:00`;
      if (eventEditor) payload.notifyMembers = eventEditor.notifyMembers();
      if (action === "run.save") {
        const participantIds = fd.getAll("participantIds");
        payload.participantIds = participantIds;
        payload.extraParticipants = (JSON.parse(form.dataset.extraParticipants || "[]") as Participant[])
          .filter(person => participantIds.includes(person.id));
        payload.participantSources = JSON.parse(form.dataset.participantSources || "{}");
      }
      if (action === "groups.rules")
        payload.rules = {
          count: Number(fd.get("count")),
          min: Number(fd.get("min")),
          max: Number(fd.get("max")),
          leaders: fd.getAll("leader"),
          ...Object.fromEntries(
            ["together", "apart"].map((key) => [
              key,
              [
                ...form.querySelectorAll(`[data-pairs="${key}"] [data-pair]`),
              ].map((row) =>
                [...row.querySelectorAll("select")].map((s) => s.value),
              ),
            ]),
          ),
        };
      if (action === "groups.save") payload.groups = selectedGroups(form);
      if (action === "roster.link")
        payload.bindings = Object.fromEntries(
          [
            ...form.querySelectorAll<HTMLSelectElement>("[data-roster-user]"),
          ].map((select) => [select.dataset.rosterUser!, select.value]),
        );
      if (action === "roster.preview") {
        payload.url = fd.get("url");
        if (fd.get("mode") === "term") payload.year = Number(fd.get("year"));
      }
      if (action === "roster.apply") {
        payload.previewId = fd.get("previewId");
        payload.confirm = fd.get("confirm") === "on";
      }
      busy = true;
      form.dataset.busy = "true";
      eventEditor?.setBusy(true, "保存しています…");
      const dialog = form.closest<HTMLDialogElement>("dialog");
      if (dialog) dialog.dataset.busy = "true";
      const controls = [
        ...(dialog || form).querySelectorAll<
          | HTMLInputElement
          | HTMLButtonElement
          | HTMLSelectElement
          | HTMLTextAreaElement
        >("input,button,select,textarea"),
      ].filter((c) => !c.disabled);
      controls.forEach((c) => {
        c.disabled = true;
      });
      richFields.forEach(editor => editor.setDisabled(true));
      status.textContent =
        action === "groups.generate"
          ? "条件を確認し、班を生成しています…"
          : "保存しています…";
      operationNotice(status.textContent || "保存しています…",false,"activity-save");
      try {
        const result = await send(payload, form.dataset.endpoint);
        const destination = new URL(
          (form.dataset.redirect || location.href)
            .replace("{eventId}", result.eventId || "")
            .replace("{previewId}", result.previewId || "")
            .replace("{runId}", result.runId || ""),
          location.href,
        );
        destination.searchParams.set(action === "notification.edit" ? "edited" : "saved", "1");
        destination.searchParams.delete("preview");
        if (action === "event.save" && form.dataset.released !== "true")
          destination.searchParams.set("preview", "1");
        form.dataset.dirty = "false";
        flashNotice("保存しました。");
        if (
          destination.pathname === location.pathname &&
          destination.search === location.search
        ) {
          // A same-document hash navigation does not fetch the updated revision.
          history.replaceState(null, "", destination.href);
          location.reload();
        } else {
          location.assign(destination.href);
        }
      } catch (error) {
        status.textContent =
          apiErrorMessage(error);
        status.dataset.error = "true";
        operationNotice(status.textContent || "保存できませんでした。",true,"activity-save");
        eventEditor?.setBusy(
          false,
          status.textContent || "保存できませんでした。",
        );
        if (dialog) dialog.dataset.busy = "false";
        richFields.forEach(editor => editor.setDisabled(false));
        controls.forEach((c) => {
          c.disabled = form.dataset.advisoryClosed === "true";
        });
        busy = false;
        form.dataset.busy = "false";
      }
    });
    if (action === "roster.link") {
      form.querySelectorAll<HTMLElement>("[data-person-picker]").forEach(picker => {
        const select = picker.querySelector<HTMLSelectElement>("[data-roster-user]")!;
        setupPersonPicker(picker, [...select.options].filter(option => option.value).map(option => ({ id: option.value, name: option.textContent || "" })));
      });
      const section = form.closest("section")!, input = section.querySelector<HTMLInputElement>("[data-roster-account-search]")!, count = section.querySelector<HTMLElement>("[data-roster-account-count]")!;
      const rows = [...form.querySelectorAll<HTMLElement>("[data-roster-account-name]")];
      const key = (s:string) => s.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("ja");
      input.addEventListener("input", () => {
        const query = key(input.value);
        rows.forEach(row => { row.hidden = !key(row.dataset.rosterAccountName || "").includes(query); });
        const visible = rows.filter(row => !row.hidden).length;
        count.textContent = visible ? `${visible} / ${rows.length}人のアカウントを表示` : "一致するアカウントが見つかりません。";
      });
    }
    if (action === "groups.rules") {
      const people: Participant[] = JSON.parse(form.dataset.people!);
      form
        .querySelectorAll<HTMLElement>("[data-person-picker]")
        .forEach((picker) => setupPersonPicker(picker, people));
      const count = form.querySelector<HTMLInputElement>('[name="count"]')!,
        leaders = form.querySelector<HTMLElement>("[data-leaders]")!;
      count.addEventListener("change", () => {
        const values = [...leaders.querySelectorAll("select")].map(
          (s) => s.value,
        );
        const total = Math.max(1, Math.min(200, Number(count.value) || 1));
        leaders.replaceChildren(
          ...Array.from({ length: total }, (_, i) => {
            const label = document.createElement("label");
            label.textContent = `${i + 1}班のリーダー`;
            const select = selectPeople(people, values[i], "leader");
            select.setAttribute("aria-label", label.textContent);
            label.append(select);
            return label;
          }),
        );
      });
      form.querySelectorAll<HTMLElement>("[data-pairs]").forEach((section) => {
        const label = section.querySelector("legend")!.textContent!;
        const numberPairs = () => {
          section
            .querySelectorAll<HTMLElement>("[data-pair]")
            .forEach((row, index) => {
              const title = `${label}のペア${index + 1}`;
              row.querySelector<HTMLElement>("[data-pair-title]")!.textContent =
                `ペア${index + 1}`;
              row
                .querySelectorAll<HTMLElement>("[data-person-picker]")
                .forEach((picker, personIndex) => {
                  const person = `${title}の${personIndex + 1}人目`;
                  picker
                    .querySelector("[data-person-search]")!
                    .setAttribute("aria-label", `${person}を検索`);
                  picker
                    .querySelector("[data-person-select]")!
                    .setAttribute("aria-label", person);
                });
              row
                .querySelector("[data-remove-pair]")!
                .setAttribute("aria-label", `${title}を削除`);
            });
        };
        section
          .querySelector("[data-add-pair]")
          ?.addEventListener("click", () => {
            const row = document.createElement("fieldset");
            row.className = "activity-pair";
            row.dataset.pair = "";
            const title = document.createElement("legend");
            title.dataset.pairTitle = "";
            const members = document.createElement("div");
            members.className = "activity-pair-people";
            for (let i = 1; i <= 2; i++) {
              members.append(createPersonPicker(people, `${label}の${i}人目`));
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.dataset.removePair = "";
            remove.textContent = "ペアを削除";
            row.append(title, members, remove);
            section.querySelector("[data-pair-list]")!.append(row);
            numberPairs();
            form.dataset.dirty = "true";
          });
        section.addEventListener("click", (e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-remove-pair]")) {
            target.closest("[data-pair]")?.remove();
            numberPairs();
            form.dataset.dirty = "true";
          }
        });
      });
    }
    if (action === "groups.save") setupGroupBoard(form);
  });
document.querySelectorAll<HTMLElement>(".activity-recipients").forEach(section => bindRecipientPicker(section));
const notice = document.querySelector<HTMLElement>("[data-notification-id]");
if (notice) {
  send({
    action: "notification.read",
    id: notice.dataset.notificationId,
  }).catch(() => {
    notice.querySelector<HTMLElement>("[data-read-status]")!.textContent =
      "既読を保存できませんでした。再読み込みしてください。";
    notice.querySelector<HTMLElement>("[data-read-status]")!.dataset.error = "true";
  });
}
