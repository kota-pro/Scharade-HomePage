import type { APIRoute } from 'astro';
import { boundedBody, json, isSameOrigin, HttpInputError } from '../../lib/http.ts';
import { normalizeErrorReport } from '../../lib/siteErrorReport.ts';
import { queueErrorReport } from '../../lib/siteErrorReports.ts';

export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return json({ ok: false, message: 'このサイトの画面から操作してください。' }, 403);
  try {
    const bytes = await boundedBody(request, 2048);
    const report = normalizeErrorReport(JSON.parse(bytes.toString('utf8')));
    if (!report || report.kind === 'server') return json({ ok: false, message: '送信内容を確認してください。' }, 400);
    const result = await queueErrorReport(report);
    if (result === 'full' || result === 'failed') return json({ ok: false, message: '時間をおいて再度お試しください。' }, 503);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return json({ ok: false, message: '送信内容を確認してください。' }, error instanceof HttpInputError ? error.status : 400); }
};
