import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice, flashNotice } from "./siteNotice";
import { welcomeFormTitle } from "../lib/clubFormTitle";

const root = document.querySelector<HTMLElement>("[data-club-root]");
let dirty = false,
  busy = false,
  confirming = false;
const deleteDialog = root?.querySelector<HTMLDialogElement>(
  "[data-club-delete-dialog]",
);
deleteDialog
  ?.querySelector<HTMLButtonElement>("[data-club-delete-cancel]")
  ?.addEventListener("click", () => deleteDialog.close("cancel"));
deleteDialog
  ?.querySelector<HTMLButtonElement>("[data-club-delete-confirm]")
  ?.addEventListener("click", () => deleteDialog.close("delete"));
function confirmDeletion(card: HTMLElement | null) {
  if (!deleteDialog || !card || deleteDialog.open)
    return Promise.resolve(false);
  deleteDialog.querySelector<HTMLElement>(
    "[data-club-delete-target]",
  )!.textContent = card.querySelector("h4")?.textContent?.trim() ?? "";
  deleteDialog.returnValue = "";
  confirming = true;
  return new Promise<boolean>((resolve) => {
    deleteDialog.addEventListener(
      "close",
      () => {
        confirming = false;
        resolve(deleteDialog.returnValue === "delete");
      },
      { once: true },
    );
    deleteDialog.showModal();
  });
}
const iso = (value: FormDataEntryValue | null, required = true) => {
  if (!value && !required) return "";
  const date = new Date(`${String(value)}+09:00`);
  if (!Number.isFinite(date.getTime()))
    throw new Error("日時を入力してください。");
  return date.toISOString();
};
async function send(payload: Record<string, unknown>) {
  const response = await fetch("/api/admin/club-forms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readApiResponse(response);
  if (!response.ok || !data.ok)
    throw new Error(data.message || "操作を完了できませんでした。");
  return data;
}
function welcomeTitle(form: HTMLFormElement) {
  const kind = form.querySelector<HTMLSelectElement>("[data-club-kind]");
  const name = form.querySelector<HTMLInputElement>('[name="eventName"]');
  if (!kind || !name) return;
  name.placeholder = welcomeFormTitle(
    kind.value,
    form.querySelector<HTMLInputElement>('[name="startsAt"]')?.value,
    form.querySelector<HTMLInputElement>('[name="place"]')?.value,
  );
}
function welcomeFields(form: HTMLFormElement) {
  const select = form.querySelector<HTMLSelectElement>("[data-club-kind]");
  const group = form.querySelector<HTMLElement>("[data-club-welcome]");
  if (!select || !group) return;
  const show = select.value.startsWith("welcome_");
  const capacity = form.querySelector<HTMLInputElement>('[name="capacity"]');
  if (capacity) {
    form.querySelector<HTMLElement>("[data-club-capacity]")!.hidden =
      select.value === "continuation";
    capacity.disabled =
      select.value === "continuation" ||
      Boolean(form.querySelector<HTMLFieldSetElement>("fieldset")?.disabled);
  }
  group.hidden = !show;
  for (const input of group.querySelectorAll<HTMLInputElement>("input")) {
    input.disabled =
      !show ||
      Boolean(form.querySelector<HTMLFieldSetElement>("fieldset")?.disabled);
    input.required =
      show && input.name !== "endsAt" && input.name !== "eventName";
  }
  welcomeTitle(form);
  const options = form.querySelector<HTMLElement>("[data-club-fee-options]");
  const flag = form.querySelector<HTMLInputElement>('[name="feeOnDay"]');
  const fee = form.querySelector<HTMLInputElement>('[name="fee"]');
  if (!options || !flag || !fee) return;
  const disabled = Boolean(
    form.querySelector<HTMLFieldSetElement>("fieldset")?.disabled,
  );
  const onDay = show && flag.value === "true";
  options.hidden = !show;
  flag.disabled = !show || disabled;
  fee.disabled = onDay || disabled;
  fee.required = !onDay;
  form.querySelector<HTMLElement>("[data-club-fee-amount]")!.hidden = onDay;
  form
    .querySelector<HTMLButtonElement>("[data-club-fee-on-day]")!
    .setAttribute("aria-pressed", String(onDay));
  form.querySelector<HTMLButtonElement>("[data-club-fee-fixed]")!.hidden =
    !onDay;
  form.querySelector<HTMLElement>("[data-club-fee-hint]")!.hidden = !onDay;
}
root
  ?.querySelectorAll<HTMLFormElement>("form[data-club-action]")
  .forEach((form) => {
    let operationId = crypto.randomUUID(),
      createId = crypto.randomUUID();
    const select = form.querySelector<HTMLSelectElement>("[data-club-kind]");
    select?.addEventListener("change", () => welcomeFields(form));
    for (const [selector, value] of [
      ["[data-club-fee-on-day]", "true"],
      ["[data-club-fee-fixed]", "false"],
    ])
      form
        .querySelector<HTMLButtonElement>(selector)
        ?.addEventListener("click", () => {
          form.querySelector<HTMLInputElement>('[name="feeOnDay"]')!.value =
            value;
          dirty = true;
          welcomeFields(form);
        });
    welcomeFields(form);
    form.addEventListener("input", () => {
      dirty = true;
      welcomeTitle(form);
    });
    form.addEventListener("change", () => {
      dirty = true;
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const status = form.querySelector<HTMLElement>("[data-status]")!,
        card = form.closest<HTMLElement>("[data-club-card]");
      if (
        form.dataset.clubAction === "delete" &&
        !(await confirmDeletion(card))
      )
        return;
      try {
        const fd = new FormData(form),
          action = form.dataset.clubAction!;
        const payload: Record<string, unknown> = {
          action,
          operationId,
          id: card?.dataset.clubId ?? createId,
          revision: Number(card?.dataset.revision),
        };
        if (action === "create" || action === "update")
          payload.input = {
            year: Number(fd.get("year")),
            season: fd.get("season"),
            kind: fd.get("kind"),
            fee: Number(fd.get("fee")),
            ...(fd.get("feeOnDay") === "true" ? { feeOnDay: true } : {}),
            ...(fd.get("capacity")
              ? { capacity: Number(fd.get("capacity")) }
              : {}),
            deadline: iso(fd.get("deadline")),
            eventName: String(fd.get("eventName") ?? ""),
            startsAt: iso(fd.get("startsAt"), false),
            endsAt: iso(fd.get("endsAt"), false),
            place: String(fd.get("place") ?? ""),
          };
        if (action === "open") payload.deadline = iso(fd.get("deadline"));
        if (action === "delete") payload.confirm = true;
        busy = true;
        const controls = [
          ...form.querySelectorAll<
            HTMLButtonElement | HTMLInputElement | HTMLSelectElement
          >("button,input,select"),
        ].filter((input) => !input.disabled);
        controls.forEach((input) => {
          input.disabled = true;
        });
        status.textContent = "保存しています…";
        status.dataset.error = "false";
        try {
          await send(payload);
          dirty = false;
          flashNotice(
            action === "delete"
              ? "削除を予約しました。完了すると一覧から消えます。"
              : action === "retry"
                ? "再試行を予約しました。"
                : action === "refresh"
                  ? "Googleの準備状態を確認しました。"
                  : "操作を保存しました。Googleへの反映を待っています。",
          );
          location.reload();
        } finally {
          busy = false;
          controls.forEach((input) => {
            input.disabled = false;
          });
          welcomeFields(form);
        }
      } catch (error) {
        status.textContent = apiErrorMessage(error);
        status.dataset.error = "true";
        operationNotice(status.textContent, true, "club-form-save");
        // A rejected validation can be corrected; uncertain transport retries retain the same operation ID.
        if (
          error instanceof Error &&
          !/通信|接続|fetch|保存できません/.test(error.message)
        )
          operationId = crypto.randomUUID();
      }
    });
  });
root
  ?.querySelectorAll<HTMLButtonElement>("[data-create-club-kind]")
  .forEach((button) =>
    button.addEventListener("click", () => {
      const form = root.querySelector<HTMLFormElement>(
          'form[data-club-action="create"]',
        )!,
        select = form.querySelector<HTMLSelectElement>("[data-club-kind]")!;
      select.value = button.dataset.createClubKind!;
      welcomeFields(form);
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      select.focus();
    }),
  );
root
  ?.querySelector<HTMLButtonElement>("[data-club-health]")
  ?.addEventListener("click", async (event) => {
    const button = event.currentTarget as HTMLButtonElement,
      status = root.querySelector<HTMLElement>("[data-club-global-status]")!;
    button.disabled = true;
    try {
      const result = await send({ action: "health" });
      status.textContent = result.ready
        ? "Google連携と締切の自動終了を確認しました。"
        : "Googleには接続できました。管理者が締切の自動終了を設定してください。";
    } catch (error) {
      status.textContent = apiErrorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
root
  ?.querySelector<HTMLButtonElement>("[data-club-reload]")
  ?.addEventListener("click", () => location.reload());
async function poll() {
  if (!root || document.hidden || busy || confirming) return;
  try {
    const response = await fetch("/api/admin/club-forms", {
      cache: "no-store",
    });
    const data = await readApiResponse(response);
    if (!response.ok || !data.ok || !Array.isArray(data.forms)) return;
    const fingerprint = JSON.stringify(
      data.forms.map((form: any) => [
        form.id,
        form.revision,
        form.state,
        form.delivery,
        form.statusError,
        form.remote?.formId,
        form.remote?.uploadReady,
        form.remote?.responseCount,
        form.remote?.closedReason,
        form.deleteRequestedAt,
        form.deleteBlockedReason,
        data.operations.find((job: any) => job.formId === form.id)?.error,
      ]),
    );
    if (fingerprint === root.dataset.fingerprint) return;
    if (dirty)
      root.querySelector<HTMLElement>("[data-club-updated]")!.hidden = false;
    else location.reload();
  } catch {
    /* Keep unsaved inputs and retry without interrupting the operator. */
  }
}
if (root)
  window.setInterval(() => {
    void poll();
  }, 10000);
