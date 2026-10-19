export {};
const root = document.querySelector<HTMLElement>("[data-deletion-admin]");
if (root) {
  const status = root.querySelector<HTMLElement>(
    "[data-deletion-admin-status]",
  )!;
  let busy = false;
  async function send(body: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    const buttons = [...root!.querySelectorAll<HTMLButtonElement>("button")];
    const prior = buttons.map((button) => button.disabled);
    buttons.forEach((button) => (button.disabled = true));
    status.textContent = "処理しています…";
    try {
      const response = await fetch(
        `/api/admin/account-deletion-requests/${root!.dataset.deletionAdmin}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok)
        throw new Error(
          data?.message ||
            "処理に失敗しました。再読み込みして再試行してください。",
        );
      location.reload();
    } catch (error) {
      status.textContent = (error as Error).message;
      buttons.forEach((button, index) => (button.disabled = prior[index]));
    } finally {
      busy = false;
    }
  }
  root.querySelector("[data-deletion-start]")?.addEventListener("click", () => {
    if (
      confirm(
        "対象者のログインと通知を停止し、ローカルの提出写真などを削除します。削除処理を開始しますか？",
      )
    )
      void send({ action: "start" });
  });
  root
    .querySelector<HTMLFormElement>("[data-deletion-complete]")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      if (
        confirm(
          "関連データの削除確認を確定し、アカウント・Portfolioを削除します。元に戻せません。",
        )
      )
        void send({
          action: "complete",
          confirmationEmail: form.get("confirmationEmail"),
          checks: form.getAll("checks"),
        });
    });
}
