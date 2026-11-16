import type { APIRoute } from 'astro';
import { isExecutive, readUsers } from '../../../../../lib/auth.ts';
import { approveRegistration } from '../../../../../lib/accountReview.ts';
import { AccountUpdateError } from '../../../../../lib/accountManagement.ts';
import { json } from '../../../../../lib/http.ts';

export const POST: APIRoute = async ({ locals, params, request }) => {
  if (!isExecutive(locals.user)) return json({ ok: false, message: '幹部以上の権限が必要です。' }, 403);
  if (!params.id || params.id.length > 128) return json({ ok: false, message: '申請が見つかりません。' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || Object.keys(body).some(k => k !== 'revision')) return json({ ok: false, message: '入力形式を確認してください。' }, 400);
  try {
    const result = await approveRegistration(locals.user!.id, params.id, body.revision);
    const target = readUsers().find(u => u.id === params.id);
    return json({ ok: true, result, notifiedAt: target?.approvalNotifiedAt ?? null, recipientsComplete: !!target?.approvalSetup?.recipientsCompletedAt });
  } catch (error) {
    if (error instanceof AccountUpdateError) return json({ ok: false, message: error.message }, error.status);
    return json({ ok: false, message: '承認の結果を確認できませんでした。再読み込みして確認してください。' }, 503);
  }
};
