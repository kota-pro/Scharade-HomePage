const unknownResult = "処理結果を確認できませんでした。入力内容は保持しています。保存・送信先の状態を確認してください。";

/** A proxy error or a login page is not an API result; never automatically resend. */
export async function readApiResponse(response: Response, message = unknownResult): Promise<Record<string, any>> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, any>;
  let loginRedirect = false;
  try { loginRedirect = response.redirected && new URL(response.url).pathname === "/Login"; } catch {}
  if (response.status === 401 || loginRedirect) throw new Error("ログインの有効期限が切れました。入力内容を控えて、再度ログインしてください。");
  throw new Error(message);
}

export function apiErrorMessage(error: unknown, fallback = unknownResult) {
  return error instanceof Error && !["TypeError", "SyntaxError", "AbortError", "TimeoutError"].includes(error.name) && error.message
    ? error.message : fallback;
}
