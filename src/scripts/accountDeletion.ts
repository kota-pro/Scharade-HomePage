import { operationNotice, flashNotice } from "./siteNotice";
export {};
const dialog = document.querySelector<HTMLDialogElement>(
  "#account-delete-dialog",
);
const opener = document.querySelector<HTMLButtonElement>(
  "#account-delete-open",
);
const form = document.querySelector<HTMLFormElement>("#account-delete-form");
if (dialog && opener && form) {
  const input = form.querySelector<HTMLInputElement>("#account-delete-email")!;
  const cancel = form.querySelector<HTMLButtonElement>(
    "#account-delete-cancel",
  )!;
  const submit = form.querySelector<HTMLButtonElement>(
    "#account-delete-submit",
  )!;
  const status = form.querySelector<HTMLElement>("#account-delete-status")!;
  let busy = false;
  const matches = () =>
    input.value.trim().toLowerCase() ===
    form.dataset.email!.trim().toLowerCase();
  opener.disabled = false;
  opener.addEventListener("click", () => {
    form.reset();
    status.textContent = "";
    status.dataset.error = "false";
    submit.disabled = true;
    dialog.showModal();
  });
  cancel.addEventListener("click", () => {
    if (!busy) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  dialog.addEventListener("close", () => opener.focus());
  input.addEventListener("input", () => {
    submit.disabled = busy || !matches();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !matches()) return;
    const confirmationEmail = input.value;
    busy = true;
    input.disabled = cancel.disabled = submit.disabled = true;
    status.dataset.error = "false";
    status.textContent = "削除しています…"; operationNotice(status.textContent,false,"account-delete");
    let message =
      "削除結果を確認できませんでした。一覧を確認し、アカウントが残っている場合は再試行してください。";
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(form.dataset.accountId!)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revision: form.dataset.revision,
            confirmationEmail,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        message = result.message || message;
        throw new Error();
      }
      flashNotice("アカウントを削除しました。");
      location.assign("/Admin/accounts?deleted=1");
    } catch {
      status.textContent = message; operationNotice(message,true,"account-delete");
      status.dataset.error = "true";
      busy = false;
      input.disabled = cancel.disabled = false;
      submit.disabled = !matches();
    }
  });
}
