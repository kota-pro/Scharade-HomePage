import { readApiResponse, apiErrorMessage } from "./apiResponse";

const dialog = document.querySelector<HTMLDialogElement>(
  "[data-management-delete-dialog]",
);
if (dialog) {
  const form = dialog.querySelector<HTMLFormElement>(
    "[data-management-delete-form]",
  )!;
  const status = dialog.querySelector<HTMLElement>(
    "[data-management-delete-status]",
  )!;
  const controls = [
    ...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input,button",
    ),
  ];
  let trigger: HTMLButtonElement | null = null,
    busy = false,
    overflow = "";
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-delete-item], [data-management-delete]",
  )) {
    button.addEventListener("click", () => {
      if (busy || button.closest('[aria-busy="true"]')) return;
      trigger = button;
      dialog.querySelector("[data-management-delete-title]")!.textContent =
        button.dataset.deleteTitle || button.dataset.deleteLabel + "を削除";
      dialog.querySelector("[data-management-delete-question]")!.textContent =
        button.dataset.deleteName || button.dataset.deleteQuestion || "質問未入力の下書き";
      dialog.querySelector(
        "[data-management-delete-description]",
      )!.textContent =
        button.dataset.deleteDescription || (button.dataset.deleteKind === "notification"
          ? "この通知を全員の通知一覧から削除します。企画・投票などの内容や回答は残ります。端末へ配信済みの通知は取り消せません。"
          : "質問・選択肢・回答・添付ファイル・関連するサイト内通知を削除します。共有リンクからも閲覧できなくなります。この操作は取り消せません。");
      form.reset();
      status.setAttribute("role", "status");
      status.textContent = "";
      overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      dialog.showModal();
    });
    button.disabled = false;
  }
  const close = () => {
    if (!busy) dialog.close();
  };
  dialog
    .querySelector("[data-management-delete-cancel]")!
    .addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("close", () => {
    document.body.style.overflow = overflow;
    trigger?.focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !trigger || !form.reportValidity()) return;
    const data = new FormData(form);
    busy = true;
    dialog.setAttribute("aria-busy", "true");
    controls.forEach((control) => (control.disabled = true));
    status.setAttribute("role", "status");
    status.textContent = "削除しています…";
    try {
      const notification = trigger.dataset.deleteKind === "notification";
      const response = await fetch(
        trigger.dataset.deleteEndpoint || (notification
          ? "/api/member/activities"
          : `/api/member/tools/${trigger.dataset.deleteItem}`),
        {
          method: notification ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            confirmation: data.get("confirmation"),
            ...(trigger.dataset.deleteUpdatedAt ? { updatedAt: trigger.dataset.deleteUpdatedAt } : { revision: Number(trigger.dataset.deleteRevision) }),
            ...(notification
              ? {
                  action: "notification.delete",
                  id: trigger.dataset.deleteItem,
                }
              : {}),
          }),
        },
      );
      const result = await readApiResponse(response);
      if (!response.ok || !result?.ok)
        throw new Error(
          result.message || "削除できませんでした。もう一度お試しください。",
        );
      location.assign(
        trigger.dataset.deleteRedirect || (notification
          ? "/Member/manage/notifications?deleted=1"
          : "/Member/manage/tools?deleted=1"),
      );
    } catch (error) {
      status.setAttribute("role", "alert");
      status.textContent = apiErrorMessage(
        error,
        "削除できませんでした。もう一度お試しください。",
      );
      busy = false;
      dialog.removeAttribute("aria-busy");
      controls.forEach((control) => (control.disabled = false));
    }
  });
}
