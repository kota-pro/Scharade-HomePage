import { exhibitionErrorCode, formatExhibitionError, isExhibitionErrorCode } from '../lib/exhibitionErrors.ts';
import { describeSiteError, formatSiteError, isSiteErrorCode } from '../lib/siteErrors.ts';
import { reportSiteError } from './siteErrorReports.ts';

/** Keep HTML error pages and expired-login redirects out of the UI's JSON errors. */
export async function readExhibitionResponse(response: Response): Promise<Record<string, any>> {
  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    if (response.status === 401 || (response.redirected && new URL(response.url).pathname === "/Login")) {
      throw new Error(formatExhibitionError("ログインの有効期限が切れました。再度ログインしてください。", 'EXH-009'));
    }
    const code = response.headers.get('X-Error-Code');
    if (isSiteErrorCode(code) || isExhibitionErrorCode(code)) {
      if (response.status >= 500) reportSiteError(code, { status: response.status });
      throw new Error(formatSiteError(describeSiteError('', response.status, code).message, code));
    }
    if (response.status >= 400 && response.status < 500) throw new Error(formatExhibitionError('', exhibitionErrorCode('', response.status)));
    reportSiteError('EXH-018', { reason: 'invalid-response', status: response.status });
    throw new Error(formatExhibitionError('', 'EXH-018'));
  }
  if (!response.ok || (data as Record<string, unknown>).ok === false) {
    const body = data as Record<string, any>;
    const message = typeof body.message === 'string' ? body.message : '';
    const supplied = isSiteErrorCode(body.errorCode) || isExhibitionErrorCode(body.errorCode) ? body.errorCode : body.code;
    if (isSiteErrorCode(supplied)) {
      const detail = describeSiteError(message, response.status, supplied);
      reportSiteError(detail.code, { status: response.status, detail: body.errorDetail });
      return { ...body, ok: false, errorCode: detail.code, message: formatSiteError(detail.message, detail.code) };
    }
    const code = isExhibitionErrorCode(supplied) ? supplied : exhibitionErrorCode(message, response.status);
    const detail = describeSiteError(message, response.status, code);
    reportSiteError(code, { status: response.status, detail: body.errorDetail });
    return { ...body, ok: false, code: body.code ?? code, errorCode: code, message: formatExhibitionError(detail.message, code) };
  }
  return data as Record<string, any>;
}
