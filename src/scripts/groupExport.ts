import { groupExportText, type GroupExportData } from "../lib/groupExport";
import { createGroupPng } from "./groupPng";
import { operationNotice } from "./siteNotice";
import { canCopyAppImage, copyAppImage } from "./mobileBridge";

document.querySelectorAll<HTMLElement>("[data-group-export]").forEach(root => {
  const data: GroupExportData = JSON.parse(root.dataset.groupExport!);
  const status = root.querySelector<HTMLElement>("[data-group-export-status]")!;
  const fallback = root.querySelector<HTMLButtonElement>("[data-group-download]")!;
  const textFallback = root.querySelector<HTMLElement>("[data-group-text-fallback]")!;
  const textArea = textFallback.querySelector<HTMLTextAreaElement>("textarea")!;
  const images = new Map<number | undefined, Promise<Blob>>();
  let busy = false, failedIndex: number | undefined;
  const message = (text: string, error = false) => { status.textContent = text; status.dataset.error = String(error); operationNotice(text, error, "group-export"); };
  function setBusy(value: boolean) {
    busy = value; root.setAttribute("aria-busy", String(value));
    root.querySelectorAll<HTMLButtonElement>("button").forEach(button => button.disabled = value);
  }
  function png(index?: number) {
    let promise = images.get(index);
    if (!promise) {
      promise = createGroupPng(data, index).catch(error => { images.delete(index); throw error; }); images.set(index, promise);
      // A browser may reject clipboard permission before it consumes the image promise.
      void promise.catch(() => {});
    }
    return promise;
  }
  async function download(index?: number) {
    if (busy) return; setBusy(true); message("PNGを作成しています…");
    try {
      const blob = await png(index), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${(data.title || "班分け").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0,100)}${index === undefined ? "" : `_${data.sections[index].number}班`}.png`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
      message("PNGのダウンロードを開始しました。");
    } catch { message("PNGを作成できませんでした。もう一度お試しください。", true); }
    finally { setBusy(false); }
  }
  async function copyImage(index: number) {
    if (busy) return; failedIndex = index; fallback.hidden = true; setBusy(true);
    try {
      if (canCopyAppImage()) await copyAppImage(await png(index));
      else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") throw new Error("Image clipboard unavailable");
        // Start the clipboard write inside the click, before rendering, to retain Safari user activation.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png(index) })]);
      }
      message(`${data.sections[index].number}班の画像をコピーしました。`);
    } catch {
      fallback.hidden = false; fallback.textContent = `${data.sections[index].number}班をPNGで保存`;
      message("画像をコピーできませんでした。PNGで保存してお使いください。", true);
    } finally { setBusy(false); }
  }
  root.querySelector("[data-group-png]")!.addEventListener("click", () => void download());
  fallback.addEventListener("click", () => void download(failedIndex));
  root.querySelectorAll<HTMLElement>("[data-copy-group]").forEach(card => card.addEventListener("click", event => {
    if (window.getSelection()?.toString() && !(event.target as Element).closest("button")) return;
    void copyImage(Number(card.dataset.copyGroup));
  }));
  root.querySelector("[data-group-txt]")!.addEventListener("click", async () => {
    if (busy) return; setBusy(true);
    const text = groupExportText(data.sections), focused = document.activeElement as HTMLElement | null;
    textArea.value = text;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        textFallback.hidden = false; textArea.focus(); textArea.select();
        if (!document.execCommand("copy")) throw new Error("Text clipboard unavailable");
      }
      textFallback.hidden = true; message("全班の名簿をTXTでコピーしました。");
    } catch {
      textFallback.hidden = false; textArea.focus(); textArea.select();
      message("コピーできませんでした。表示されたテキストを選択してコピーしてください。", true);
    } finally { setBusy(false); if (textFallback.hidden) focused?.focus({ preventScroll: true }); }
  });
});
