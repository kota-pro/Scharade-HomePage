import { operationNotice } from "./siteNotice";
import { canCopyAppImage, copyAppImage } from "./mobileBridge";
export {};
const dialog = document.querySelector<HTMLDialogElement>("#portfolio-share-dialog");
if (dialog) {
  const url = dialog.dataset.shareUrl!;
  const link = dialog.querySelector<HTMLInputElement>("#portfolio-share-url")!;
  const qrButton = dialog.querySelector<HTMLButtonElement>(".portfolio-share-qr")!;
  const qrImage = qrButton.querySelector("img")!;
  const qrArea = dialog.querySelector<HTMLElement>(".portfolio-share-qr-area")!;
  const loading = dialog.querySelector<HTMLElement>(".portfolio-share-loading")!;
  const download = dialog.querySelector<HTMLAnchorElement>("#portfolio-share-download")!;
  const status = dialog.querySelector<HTMLElement>(".portfolio-share-status")!;
  const retry = dialog.querySelector<HTMLButtonElement>(".portfolio-share-retry")!;
  let qrBlob: Blob | null = null;
  let objectUrl = "";
  let generating = false;
  let copying = false;
  let opener: HTMLButtonElement | null = null;
  const notify = (message: string, error = false) => { status.textContent = message; status.dataset.error = String(error); operationNotice(message,error,"portfolio-share"); };

  async function prepareQr() {
    if (qrBlob || generating) return;
    generating = true; loading.dataset.error = "false";
    qrArea.setAttribute("aria-busy", "true");
    retry.hidden = true;
    loading.hidden = false;
    loading.textContent = "QRコードを準備しています…";
    try {
      const { createPortfolioQr } = await import("./portfolioQr");
      qrBlob = await createPortfolioQr(url);
      objectUrl = URL.createObjectURL(qrBlob);
      qrImage.src = objectUrl;
      await qrImage.decode();
      qrImage.hidden = false;
      qrButton.disabled = false;
      download.href = objectUrl;
      download.setAttribute("aria-disabled", "false");
      loading.hidden = true;
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      qrBlob = null;
      loading.textContent = "QRコードを作成できませんでした。再生成をお試しください。"; loading.dataset.error = "true";
      retry.hidden = false;
      notify("QRコードを作成できませんでした。再生成をお試しください。リンクは引き続きコピーできます。", true);
    } finally {
      generating = false;
      qrArea.setAttribute("aria-busy", "false");
    }
  }

  async function copyLink() {
    if (copying) return;
    copying = true;
    link.select();
    link.setSelectionRange(0, link.value.length);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else if (!document.execCommand("copy")) throw new Error("Copy unavailable");
      notify("リンクをコピーしました。");
    } catch {
      notify("コピーできませんでした。表示中のリンクを長押し、または選択してコピーしてください。", true);
    } finally { copying = false; }
  }
  link.addEventListener("click", () => void copyLink());
  link.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); void copyLink(); }
  });
  dialog.querySelector("#portfolio-share-copy-link")!.addEventListener("click", () => void copyLink());
  qrButton.addEventListener("click", async () => {
    if (!qrBlob || copying) return;
    if (!canCopyAppImage() && (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")) {
      notify("このブラウザではQR画像をコピーできません。ダウンロードしてお使いください。");
      return;
    }
    copying = true;
    try {
      // Start the write in the click handler to preserve Safari's user activation.
      if (canCopyAppImage()) await copyAppImage(qrBlob);
      else await navigator.clipboard.write([new ClipboardItem({ "image/png": qrBlob })]);
      notify("QR画像をコピーしました。");
    } catch {
      notify("QR画像をコピーできませんでした。ダウンロードしてお使いください。", true);
    } finally { copying = false; }
  });
  download.addEventListener("click", event => {
    if (!qrBlob) { event.preventDefault(); return; }
    // Browsers expose download initiation, not completion of the user's save dialog.
    download.querySelector<HTMLElement>(".share-download-icon")!.hidden = true;
    download.querySelector<HTMLElement>(".share-saved-icon")!.hidden = false;
    notify("ダウンロードを開始しました。");
  });
  retry.addEventListener("click", () => { notify(""); void prepareQr(); });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-portfolio-share-open]")) {
    button.hidden = false;
    button.addEventListener("click", () => {
      if (dialog.open) return;
      opener = button;
      notify("");
      dialog.showModal();
      void prepareQr();
    });
  }
  dialog.querySelector(".portfolio-share-close")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    const visibleOpener = opener?.getClientRects().length ? opener :
      Array.from(document.querySelectorAll<HTMLButtonElement>("[data-portfolio-share-open]"))
        .find(button => button.getClientRects().length);
    visibleOpener?.focus({ preventScroll: true });
  });
  window.addEventListener("pagehide", event => {
    if (!event.persisted && objectUrl) URL.revokeObjectURL(objectUrl);
  });
}
