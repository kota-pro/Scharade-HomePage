import { env } from "./config.ts";
import { signedEnvelope } from "./signedEnvelope.ts";

export const clubFormsOwner = "contact@scharade.jp";
export const clubFormsRootId = "1iJ_g3gkRoGoIb1AigDBvoPOuRivX6pWl";
function gatewayUrl() {
  const url = new URL(env("CLUB_FORMS_GAS_URL"));
  if (
    url.protocol !== "https:" ||
    url.hostname !== "script.google.com" ||
    !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("Googleフォーム連携のURLを確認してください。");
  return url;
}
export function clubFormsConfigured() {
  try {
    gatewayUrl();
    return env("CLUB_FORMS_WEBHOOK_SECRET").length >= 32;
  } catch {
    return false;
  }
}
export async function postClubForms(
  value: object,
  timeout = 25000,
): Promise<Record<string, any>> {
  if (!clubFormsConfigured())
    throw new Error(
      "Googleフォーム連携が未設定です。管理者が連携を設定してください。",
    );
  const signal = AbortSignal.timeout(timeout);
  let url = gatewayUrl();
  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      signedEnvelope(value, env("CLUB_FORMS_WEBHOOK_SECRET")),
    ),
    redirect: "manual",
    signal,
  });
  for (
    let hops = 0;
    hops < 3 && [301, 302, 303].includes(response.status);
    hops++
  ) {
    const next = new URL(response.headers.get("location") ?? "", url);
    if (
      next.protocol !== "https:" ||
      next.hostname !== "script.googleusercontent.com" ||
      next.username ||
      next.password ||
      next.port
    )
      throw new Error("Google連携からの応答先を確認できませんでした。");
    url = next;
    response = await fetch(url, { method: "GET", redirect: "manual", signal });
  }
  if (!response.ok)
    throw new Error(
      "Google連携に接続できませんでした。時間をおいて再試行してください。",
    );
  const body = await response.text();
  if (body.length > 4_000_000)
    throw new Error("Google連携の応答が大きすぎます。");
  const data = JSON.parse(body);
  if (
    !data?.ok ||
    data.owner !== clubFormsOwner ||
    data.rootFolderId !== clubFormsRootId
  ) {
    const messages: Record<string, string> = {
      INVALID_SOURCE:
        "フォームまたは回答シートのURLと閲覧権限を確認してください。",
      INVALID_ROSTER: "名簿の見出し・回答日時・回答の形式を確認してください。",
      TEMPLATE_CHANGED:
        "参照フォームの構成が変わっています。テンプレート設定を確認してください。",
      OWNER_MISMATCH:
        "連携の実行アカウント・保存先がcontact@scharade.jpの設定と一致しません。",
      CONFLICT:
        "Google側の設定が更新されています。状態を確認して再試行してください。",
      RECONCILING:
        "Googleで作成済みのファイルを照合しています。重複作成せず再試行します。",
      UPLOAD_SETUP_REQUIRED:
        "Googleの編集画面で画像保存先の「復元」を行い、準備状態を確認してください。",
      UPLOAD_CHECK_FAILED:
        "画像保存先を確認できません。Google連携の権限・設定を確認して再試行してください。",
      FORM_DELETED: "このフォームは削除済み、または削除処理中です。",
      CAPACITY_TRIGGER_FAILED:
        "定員到達時の自動終了を設定できないため受付を開始できません。定員付きで受付中の不要なフォームを終了し、再試行してください。",
      DELETE_CHECK_FAILED:
        "削除対象の所有情報または権限を確認できません。Google Driveで確認してから再試行してください。",
    };
    throw new Error(
      messages[String(data?.code)] ??
        "Google連携の設定・権限を確認して再試行してください。",
    );
  }
  return data;
}

export function googleFileId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(value);
}
export function googleUrl(value: unknown, kind: "form" | "sheet" | "folder") {
  if (typeof value !== "string" || value.length > 1000) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      (kind === "folder"
        ? url.hostname === "drive.google.com" &&
          /^\/drive\/folders\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname)
        : url.hostname === "docs.google.com" &&
          (kind === "form"
            ? /^\/forms\/d\/(?:e\/)?[A-Za-z0-9_-]{20,200}\/(?:edit|viewform)$/.test(
                url.pathname,
              )
            : /^\/spreadsheets\/d\/[A-Za-z0-9_-]{20,200}\/edit$/.test(
                url.pathname,
              )))
    );
  } catch {
    return false;
  }
}
