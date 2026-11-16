import { operationNotice } from "./siteNotice";
const dialog = document.querySelector<HTMLDialogElement>("#activity-share-dialog");
if (dialog) {
  const input = dialog.querySelector<HTMLInputElement>("#activity-share-url")!;
  const name = dialog.querySelector<HTMLElement>(".portfolio-share-name")!;
  const status = dialog.querySelector<HTMLElement>(".portfolio-share-status")!;
  let opener: HTMLButtonElement | null = null;
  let copying = false;
  async function copyLink() {
    if (copying) return;
    copying = true;
    input.focus();
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(input.value);
      else if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      status.dataset.error = "false"; status.textContent = "リンクをコピーしました。"; operationNotice(status.textContent,false,"activity-share");
    } catch {
      status.dataset.error = "true"; status.textContent = "コピーできませんでした。表示中のリンクを長押し、または選択してコピーしてください。"; operationNotice(status.textContent,true,"activity-share");
    } finally { copying = false; }
  }
  document.querySelectorAll<HTMLButtonElement>("[data-activity-share-open]").forEach(button => {
    button.hidden = false;
    button.addEventListener("click", () => {
      opener = button;
      input.value = button.dataset.shareUrl!;
      name.textContent = button.dataset.shareTitle!;
      status.textContent = "";
      dialog.querySelector<HTMLElement>("#activity-share-help")!.textContent = button.dataset.shareKind === "events"
        ? "リンクをタップしてコピー。企画詳細・回答人数・参加予定者の名前はログインなしで閲覧できます。参加投票にはログインが必要です。"
        : button.dataset.shareKind === "tools" ? "質問の公開設定に応じて閲覧できます。回答には通知先メンバーのログインが必要です。結果は公開範囲と期間に従って表示されます。"
        : button.dataset.shareKind === "exhibitions" ? "リンクをタップしてコピー。閲覧・回答にはログインが必要です。"
        : "リンクをタップしてコピー。通知先のメンバーがログインして閲覧できます。";
      dialog.showModal();
    });
  });
  input.addEventListener("click", copyLink);
  input.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void copyLink(); } });
  dialog.querySelector("[data-copy-link]")!.addEventListener("click", copyLink);
  dialog.querySelector(".portfolio-share-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => opener?.focus({ preventScroll: true }));
}
