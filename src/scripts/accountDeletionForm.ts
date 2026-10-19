export {};
const root = document.querySelector<HTMLElement>("[data-deletion-form]");
if (root) {
  const emailForm = root.querySelector<HTMLFormElement>(
      "[data-deletion-email]",
    ),
    confirmForm = root.querySelector<HTMLFormElement>(
      "[data-deletion-confirm]",
    ),
    status = root.querySelector<HTMLElement>("[data-deletion-status]")!;
  let token = "",
    busy = false;
  async function send(body: Record<string, unknown>) {
    const response = await fetch("/api/account-deletion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok)
      throw new Error(
        data?.message || "通信できませんでした。再試行してください。",
      );
    return data;
  }
  function disabled(value: boolean) {
    busy = value;
    root!
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = value));
  }
  emailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    disabled(true);
    status.textContent = "確認メールを送信しています…";
    try {
      const data = await send({
        action: "request-code",
        email: String(new FormData(emailForm).get("email")),
      });
      token = data.verificationToken;
      emailForm.hidden = true;
      confirmForm!.hidden = false;
      status.textContent = "確認コードを送信しました。有効期限は10分です。";
      confirmForm!.querySelector<HTMLInputElement>("[name=code]")?.focus();
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      disabled(false);
    }
  });
  confirmForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    disabled(true);
    status.textContent = "削除申請を送信しています…";
    try {
      const data = await send({
        action: "submit",
        verificationToken: token,
        code: String(new FormData(confirmForm).get("code")),
      });
      token = "";
      confirmForm.hidden = true;
      status.textContent = `削除申請を受け付けました。${new Date(data.request.dueAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}（日本時間）までに運営が処理し、完了をメールでお知らせします。`;
    } catch (error) {
      status.textContent = (error as Error).message;
    } finally {
      disabled(false);
    }
  });
  root
    .querySelector("[data-deletion-restart]")
    ?.addEventListener("click", () => {
      if (busy) return;
      token = "";
      confirmForm!.hidden = true;
      emailForm!.hidden = false;
      status.textContent = "再送には60秒以上の間隔を空けてください。";
    });
}
