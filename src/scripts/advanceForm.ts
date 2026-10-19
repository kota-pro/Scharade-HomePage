import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
export {};
const form = document.querySelector<HTMLFormElement>("#advance-form");
const button = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
const status = document.querySelector<HTMLElement>("#advance-status");
const preview = document.querySelector<HTMLDialogElement>("#advance-preview");
const send = document.querySelector<HTMLButtonElement>("#advance-send");
const receiptFile = document.querySelector<HTMLInputElement>("#receipt-file");
const receiptUrl = document.querySelector<HTMLInputElement>("#receipt-url");
const receiptSelection = document.querySelector<HTMLElement>("#receipt-selection");
const receiptRemove = document.querySelector<HTMLButtonElement>("#receipt-remove");
const receiptImage = document.querySelector<HTMLImageElement>("#receipt-preview-image");
const sendStatus = document.querySelector<HTMLElement>("#advance-send-status");
const refundMethod = document.querySelector<HTMLSelectElement>("#refund-method");
if (form && button && status && preview && send && sendStatus && receiptFile && receiptUrl && receiptSelection && receiptRemove && receiptImage && refundMethod) {
  let requestKey = crypto.randomUUID();
  let submittedBody: Record<string, unknown> | null = null;
  let previewBody: Record<string, unknown> | null = null;
  let pending = false;
  let previousOverflow = "";
  let legacyRetry = false;
  const refundLabels: Record<string, string> = { bank: "口座振込", paypay: "PayPay", cash: "現金手渡し" };
  const updateRefundFields = () => {
    for (const row of document.querySelectorAll<HTMLElement>("[data-refund-for]")) {
      const active = !legacyRetry && row.dataset.refundFor === refundMethod.value;
      row.hidden = !active;
      for (const field of row.querySelectorAll<HTMLInputElement>("input")) {
        field.disabled = !active;
        field.required = active;
        if (!active) field.setCustomValidity("");
      }
    }
  };
  const resetLegacyRetry = () => {
    legacyRetry = false;
    refundMethod.disabled = false;
    refundMethod.required = true;
    refundMethod.querySelector('option[value="legacy"]')?.remove();
  };
  type Attachment = { uploadKey: string; name: string; size: number; url?: string; };
  let attachment: Attachment | null = null;
  let imageUrl = "";
  const comparable = (body: Record<string, unknown>) => JSON.stringify(Object.keys(body).sort().map(key => [key, body[key]]));
  const sizeLabel = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.ceil(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
  const updateAttachment = () => {
    receiptSelection.textContent = attachment ? `${attachment.name}（${sizeLabel(attachment.size)}）` : receiptUrl.value ? "前回の申請で指定した領収書を保持しています。" : "ファイルは選択されていません。";
    receiptRemove.hidden = !attachment && !receiptUrl.value;
    receiptFile.disabled = receiptRemove.disabled = Boolean(submittedBody);
  };
  const clearImage = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = "";
    receiptImage.removeAttribute("src");
    receiptImage.hidden = true;
  };
  const storageKey = `scharade-advance:${form.dataset.userId}`;
  const uncertainMessage = "受付結果を確認できませんでした。同じ内容でもう一度送信してください。";
  const showStatus = (element: HTMLElement, message: string, error = false) => {
    element.hidden = false;
    element.dataset.error = String(error);
    operationNotice(message,error,"advance-form");
    element.textContent = message;
  };
  const closePreview = (target: HTMLElement = button) => {
    if (pending || !preview.open) return;
    preview.close();
    document.body.style.overflow = previousOverflow;
    previewBody = null;
    target.focus({ preventScroll: true });
  };
  const persist = (body: Record<string, unknown>) => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ key: requestKey, body, attachment, pendingSubmission: Boolean(submittedBody) })); } catch {}
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
    if (saved?.body && typeof saved.key === "string") {
      requestKey = saved.key;
      submittedBody = saved.pendingSubmission === false ? null : saved.body;
      attachment = saved.attachment ?? null;
      for (const [key, value] of Object.entries(saved.body)) {
        const field = form.elements.namedItem(key);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = String(value);
      }
      // Old accepted submissions must retry their original payload and fingerprint.
      if (submittedBody && !saved.body.refundMethod) {
        legacyRetry = true;
        refundMethod.add(new Option("前回の申請（返金方法未指定）", "legacy"));
        refundMethod.value = "legacy";
        refundMethod.disabled = true;
        refundMethod.required = false;
      }
      showStatus(status, submittedBody ? "前回の送信内容を復元しました。同じ内容でもう一度送信すると、受付結果を確認できます。" : "前回の入力と添付ファイル情報を復元しました。内容を確認して送信を再試行してください。");
    }
  } catch { /* sessionStorage may be unavailable; keep the retry key in memory. */ }

  updateAttachment();
  updateRefundFields();
  refundMethod.addEventListener("change", updateRefundFields);
  receiptFile.addEventListener("change", () => {
    if (submittedBody) return;
    clearImage();
    const file = receiptFile.files?.[0];
    receiptFile.setCustomValidity("");
    if (!file) { updateAttachment(); return; }
    if (!file.size || file.size > 10 * 1024 * 1024 || !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) {
      receiptFile.setCustomValidity("JPEG・PNG・WebP・PDFの、空でない10MB以下のファイルを選んでください。");
      receiptFile.reportValidity();
      return;
    }
    const retryKey = attachment && !attachment.url && attachment.name === file.name && attachment.size === file.size ? attachment.uploadKey : crypto.randomUUID();
    attachment = { uploadKey: retryKey, name: file.name, size: file.size };
    receiptUrl.value = "";
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) imageUrl = URL.createObjectURL(file);
    updateAttachment();
  });
  receiptRemove.addEventListener("click", () => {
    if (pending || submittedBody) return;
    attachment = null;
    receiptFile.value = receiptUrl.value = "";
    receiptFile.setCustomValidity("");
    clearImage();
    updateAttachment();
  });
  form.addEventListener("input", event => {
    if (event.target instanceof HTMLInputElement) event.target.setCustomValidity("");
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (pending || preview.open || button.disabled) return;
    for (const field of form.querySelectorAll<HTMLInputElement>('input[required][type="text"]:not(:disabled)')) {
      if (["bankBranchCode", "bankAccountNumber"].includes(field.name)) field.value = field.value.trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
      field.setCustomValidity(field.value.trim() ? "" : "この項目を入力してください。");
    }
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form));
    const body: Record<string, unknown> = { ...values, amount: Number(values.amount) };
    if (submittedBody && comparable(submittedBody) !== comparable(body)) {
      showStatus(status, "前回の受付結果が未確認です。重複を防ぐため、前回の内容に戻して送信してください。内容の変更は会計担当者へご連絡ください。", true);
      status.focus();
      return;
    }
    // Send this exact snapshot only after the member confirms it.
    previewBody = body;
    for (const element of preview.querySelectorAll<HTMLElement>("[data-preview-field]")) {
      const key = element.dataset.previewField!;
      let value = String(body[key] ?? "").trim();
      if (key === "receiptUrl" && attachment) value = `${attachment.name}（${sizeLabel(attachment.size)}）`;
      if (key === "amount") value = `${Number(body.amount).toLocaleString("ja-JP")} 円`;
      if (key === "refundMethod") value = legacyRetry ? "未指定（前回の申請内容を再送）" : refundLabels[value] || "";
      if (key === "expenseDate") {
        const [year, month, day] = value.split("-");
        value = `${year}年${Number(month)}月${Number(day)}日`;
      }
      element.dataset.empty = String(!value);
      element.textContent = value || "（未入力）";
    }
    receiptImage.hidden = !imageUrl;
    if (imageUrl) receiptImage.src = imageUrl;
    status.hidden = sendStatus.hidden = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    preview.showModal();
    preview.querySelector(".advance-preview-body")?.scrollTo(0, 0);
  });
  preview.querySelector("#advance-close")?.addEventListener("click", () => closePreview());
  preview.querySelector("#advance-back")?.addEventListener("click", () => closePreview());
  preview.addEventListener("cancel", event => { event.preventDefault(); closePreview(); });
  preview.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = Array.from(preview.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")).filter(control => !control.closest("[hidden]"));
    if (!controls.length) { event.preventDefault(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  preview.addEventListener("click", event => {
    if (event.target !== preview) return;
    const rect = preview.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closePreview();
  });
  preview.querySelectorAll<HTMLButtonElement>("[data-edit-field]").forEach(edit => {
    edit.addEventListener("click", () => {
      if (pending) return;
      const field = document.getElementById(edit.dataset.editField!);
      if (!field) return;
      closePreview(field);
      field.scrollIntoView({ block: "center" });
    });
  });
  send.addEventListener("click", async () => {
    if (pending || !preview.open || !previewBody) return;
    const body = previewBody;
    persist(body);
    pending = true;
    button.disabled = true;
    preview.querySelectorAll("button").forEach(control => { control.disabled = true; });
    showStatus(sendStatus, attachment && !attachment.url ? "領収書を保存しています…" : "申請を送信しています…");
    sendStatus.focus();
    try {
      if (attachment && !attachment.url) {
        const upload = new FormData();
        upload.append("uploadKey", attachment.uploadKey);
        const file = receiptFile.files?.[0];
        if (file) upload.append("file", file);
        const response = await fetch("/api/member/receipts/upload", { method: "POST", body: upload, signal: AbortSignal.timeout(75000) });
        const result = await readApiResponse(response, uncertainMessage);
        if (!response.ok || !result.ok || !result.receipt?.url) throw new Error(result.message || "領収書を保存できませんでした。同じ内容でもう一度送信してください。");
        attachment.url = result.receipt.url;
        receiptUrl.value = result.receipt.url;
        body.receiptUrl = result.receipt.url;
      }
      submittedBody = body;
      persist(body);
      showStatus(sendStatus, "申請を送信しています…");
      const response = await fetch("/api/member/advances", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, idempotencyKey: requestKey }), signal: AbortSignal.timeout(60000),
      });
      const result = await readApiResponse(response, uncertainMessage);
      if (!response.ok || !result.ok) {
        if ([400, 401, 403, 413, 429].includes(response.status)) {
          submittedBody = null;
          if (legacyRetry) { resetLegacyRetry(); refundMethod.value = ""; updateRefundFields(); }
          try { sessionStorage.removeItem(storageKey); } catch {}
        }
        throw new Error(result.message || uncertainMessage);
      }
      showStatus(status, `${result.message}\n受付番号：${result.requestId}`);
      form.reset();
      resetLegacyRetry();
      updateRefundFields();
      receiptUrl.value = "";
      submittedBody = null;
      attachment = null;
      clearImage();
      requestKey = crypto.randomUUID();
      try { sessionStorage.removeItem(storageKey); } catch {}
      pending = false;
      closePreview(status);
    } catch (error) {
      const message = apiErrorMessage(error, uncertainMessage);
      showStatus(sendStatus, message, true);
      showStatus(status, message, true);
      sendStatus.focus();
    } finally {
      pending = false;
      button.disabled = false;
      preview.querySelectorAll("button").forEach(control => { control.disabled = false; });
      updateAttachment();
    }
  });
}
