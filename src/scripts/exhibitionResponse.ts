/** Keep HTML error pages and expired-login redirects out of the UI's JSON errors. */
export async function readExhibitionResponse(response: Response): Promise<Record<string, any>> {
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/Login")) {
      throw new Error("ログインの有効期限が切れました。再度ログインしてください。");
    }
    throw new Error("写真展の処理結果を確認できませんでした。画面を再読み込みして、もう一度お試しください。");
  }
  return data as Record<string, any>;
}
