import { describeSiteError, formatSiteError, siteErrorBody } from './siteErrors.ts';

/** A page failure must remain readable even when the application cannot render its layout. */
export function siteFailurePage(status = 503) {
  const detail = describeSiteError('', status);
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>一時的に表示できません</title></head><body><main><h1>一時的に表示できません</h1><p role="alert">エラー番号：${detail.code}</p><p>${detail.message}</p><p><a href="/">ホームへ戻る</a> ／ <a href="/Errors">エラー番号の案内</a> ／ <a href="/Contact">お問い合わせ</a></p></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-Error-Code': detail.code } });
}

/** Include local route serializers and early middleware failures without touching success/streaming bodies. */
export async function numberErrorResponse(response: Response): Promise<Response> {
  const type = response.headers.get('Content-Type') ?? '';
  if ([204, 205, 304].includes(response.status) || response.status < 400 && !type.includes('application/json')) return response;
  let body: string, code: string;
  if (type.includes('application/json')) {
    let malformed = false;
    const value = await response.clone().json().catch(() => { malformed = true; return null; });
    if (malformed && response.status < 400) {
      const headers = new Headers(response.headers); headers.delete('Content-Length'); headers.delete('Content-Encoding');
      return numberErrorResponse(Response.json({ ok: false, errorCode: 'SITE-009' }, { status: 502, headers }));
    }
    if (response.status < 400 && (!value || value.ok !== false)) return response;
    const numbered = siteErrorBody(value, response.status) as Record<string, unknown>;
    body = JSON.stringify(numbered); code = String(numbered.errorCode ?? 'SITE-011');
  } else if (type.includes('text/plain')) {
    const detail = describeSiteError(await response.clone().text(), response.status);
    body = formatSiteError(detail.message, detail.code); code = detail.code;
  } else {
    if (response.status < 400) return response;
    const headers = new Headers(response.headers);
    if (response.status >= 500 && type.includes('text/html')) {
      const page = siteFailurePage(response.status);
      headers.delete('Content-Length'); headers.delete('Content-Encoding');
      page.headers.forEach((value, key) => headers.set(key, value));
      return new Response(page.body, { status: response.status, statusText: response.statusText, headers });
    }
    headers.set('X-Error-Code', describeSiteError('', response.status).code);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const headers = new Headers(response.headers);
  headers.delete('Content-Length'); headers.delete('Content-Encoding');
  headers.set('X-Error-Code', code);
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}
