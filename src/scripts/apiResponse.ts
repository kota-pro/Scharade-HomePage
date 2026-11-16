import { describeSiteError, formatSiteError, isSiteErrorCode } from '../lib/siteErrors.ts';
import { isExhibitionErrorCode } from '../lib/exhibitionErrors.ts';
import { reportSiteError } from './siteErrorReports.ts';

const unknownResult = "処理結果を確認できませんでした。入力内容は保持しています。保存・送信先の状態を確認してください。";

/** A proxy error or a login page is not an API result; never automatically resend. */
export async function readApiResponse(response: Response, message = unknownResult): Promise<Record<string, any>> {
  const data: unknown = await response.json().catch(() => null);
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const body = data as Record<string, any>;
    if (!response.ok || body.ok === false) {
      const detail = describeSiteError(typeof body.message === 'string' ? body.message : '', response.status, body.errorCode ?? body.code);
      reportSiteError(detail.code, { status: response.status, detail: body.errorDetail });
      return { ...body, ok: false, errorCode: detail.code, message: formatSiteError(detail.message, detail.code) };
    }
    return body;
  }
  let loginRedirect = false;
  try { loginRedirect = response.redirected && new URL(response.url).pathname === "/Login"; } catch {}
  if (response.status === 401 || loginRedirect) throw new Error(formatSiteError("ログインの有効期限が切れました。入力内容を控えて、再度ログインしてください。", 'SITE-002'));
  const code = response.headers.get('X-Error-Code');
  if (isSiteErrorCode(code) || isExhibitionErrorCode(code)) {
    if (response.status >= 500) reportSiteError(code, { status: response.status });
    throw new Error(formatSiteError(describeSiteError('', response.status, code).message, code));
  }
  // Expected denials can also be plain text or HTML (e.g. a reverse proxy limit).
  if (response.status >= 400 && response.status < 500) {
    const detail = describeSiteError('', response.status);
    throw new Error(formatSiteError(detail.message, detail.code));
  }
  reportSiteError('SITE-009', { reason: 'invalid-response', status: response.status });
  throw new Error(formatSiteError(message, 'SITE-009'));
}

export function apiErrorMessage(error: unknown, fallback = unknownResult) {
  return formatSiteError(error instanceof Error && !["TypeError", "SyntaxError", "AbortError", "TimeoutError"].includes(error.name) && error.message
    ? error.message : fallback);
}
