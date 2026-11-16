import { operationNotice, flashNotice } from "./siteNotice";
export {};
const form = document.querySelector<HTMLFormElement>("#account-editor");
if (form) {
  const status = document.querySelector<HTMLElement>("#account-editor-status")!;
  const button = form.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  const fields = form.querySelector<HTMLFieldSetElement>("fieldset")!;
  const notify = (message: string, error = false) => {
    operationNotice(message,error,"account-editor");
    status.textContent = message;
    status.dataset.error = String(error);
  };
  button.disabled = false;
  let busy = false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(form);
    busy = true;
    fields.disabled = true;
    button.disabled = true;
    notify("保存しています…");
    let errorMessage =
      "保存できませんでした。通信状態を確認して再度お試しください。";
    try {
      const response = await fetch(
        `/api/admin/accounts/${encodeURIComponent(form.dataset.accountId!)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: values.get("name"),
            email: values.get("email"),
            portfolioName: values.get("portfolioName"),
            role: values.get("role"),
            revision: form.dataset.revision,
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok) {
        errorMessage =
          result.message ||
          "保存できませんでした。ログイン状態を確認してください。";
        throw new Error(errorMessage);
      }
      const destination = `${location.pathname}?saved=1`;
      const next =
        result.roleChanged && !["executive", "admin"].includes(String(values.get("role")))
          ? "/"
          : destination;
      const reason = result.roleChanged ? "role-updated" : "email-updated";
      flashNotice(result.rosterSync === "linked" ? "登録内容を保存し、名簿を再読み込みして対応しました。" : result.rosterSync ? "登録内容を保存しました。名簿の対応はやることリストで確認できます。" : "登録内容を保存しました。");
      location.assign(
        result.reauthenticate
          ? `/Login?reason=${reason}&next=${encodeURIComponent(next)}`
          : destination,
      );
    } catch {
      notify(errorMessage, true);
      fields.disabled = false;
      button.disabled = false;
      busy = false;
    }
  });
}
