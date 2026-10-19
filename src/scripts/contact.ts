import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
export {};
const form = document.querySelector<HTMLFormElement>("#contact-form")!;
const preview = document.querySelector<HTMLElement>("#contact-preview")!;
const mask = form.querySelector<HTMLElement>(".mask")!;
const result = document.querySelector<HTMLElement>("#contact-result")!;
const status = preview.querySelector<HTMLElement>(".send-status")!;
const send = document.querySelector<HTMLButtonElement>("#contact-send")!;
const back = document.querySelector<HTMLButtonElement>("#close-preview")!;
const unknownContactResult = "送信結果を確認できませんでした。入力内容は保持しています。受付メールや担当者への到着状況を確認してください。";
let content: Record<string, FormDataEntryValue> = {};
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
function closePreview() {
  if (send.disabled) return;
  preview.classList.add("is-hidden");
  mask.classList.add("is-hidden");
  document.body.style.overflow = previousOverflow;
  previousFocus?.focus();
}
form.addEventListener("submit", event => {
  event.preventDefault();
  if (send.disabled || !preview.classList.contains("is-hidden") || !form.reportValidity()) return;
  content = Object.fromEntries(new FormData(form));
  if (content.inquiry === "その他" && !String(content.message).trim()) {
    result.textContent = "お問い合わせ詳細を入力してください。";
    form.querySelector("textarea")?.focus(); return;
  }
  for (const key of ["name","furigana","institution","faculty","grade","email","inquiry","message"]) {
    const element = preview.querySelector(`#preview-${key}`);
    if (element) element.textContent = String(content[key] || "（なし）");
  }
  result.textContent = status.textContent = "";
  previousFocus = document.activeElement as HTMLElement;
  previousOverflow = document.body.style.overflow;
  preview.classList.remove("is-hidden"); mask.classList.remove("is-hidden");
  document.body.style.overflow = "hidden"; back.focus();
});
back.addEventListener("click", closePreview);
mask.addEventListener("click", closePreview);
document.addEventListener("keydown", event => {
  if (preview.classList.contains("is-hidden")) return;
  if (event.key === "Escape") {event.preventDefault(); closePreview();}
  if (event.key === "Tab") {
    event.preventDefault();
    if (!send.disabled) (document.activeElement === back ? send : back).focus();
  }
});
send.addEventListener("click", async () => {
  if (send.disabled) return;
  send.disabled = back.disabled = true;
  status.textContent = "送信中…"; operationNotice(status.textContent,false,"contact");
  try {
    const response = await fetch("/api/contact", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(content),signal:AbortSignal.timeout(60000)});
    const data = await readApiResponse(response, unknownContactResult);
    if (!response.ok) throw new Error(data.message || unknownContactResult);
    if (typeof data.message !== "string" || !data.message) throw new Error(unknownContactResult);
    send.disabled = back.disabled = false; closePreview(); form.reset();
    result.textContent = data.message; operationNotice(data.message,false,"contact");
  } catch (error) {
    status.textContent = apiErrorMessage(error, unknownContactResult); operationNotice(status.textContent,true,"contact");
  } finally {send.disabled = back.disabled = false;}
});

// Preserve the original confirmation-to-field editing and kana conversion.
preview.querySelectorAll<HTMLElement>(".preview-item-content").forEach(element => {
 element.addEventListener("click", () => {
  if(send.disabled) return;
  const key=element.id.replace("preview-", "");
  const field=form.querySelector<HTMLElement>(`[name="${key}"]`);
  closePreview();
  requestAnimationFrame(() => {field?.scrollIntoView({block:"center",behavior:"smooth"}); field?.focus({preventScroll:true});});
 });
});
const kana = form.querySelector<HTMLInputElement>('[name="furigana"]');
kana?.addEventListener("input", event => {
 if ((event as InputEvent).isComposing) return;
 kana.value=kana.value.replace(/[\u3041-\u3096]/g, value => String.fromCharCode(value.charCodeAt(0)+0x60));
});
kana?.addEventListener("compositionend", () => {kana.value=kana.value.replace(/[\u3041-\u3096]/g, value => String.fromCharCode(value.charCodeAt(0)+0x60));});
