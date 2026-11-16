import type { APIRoute } from 'astro';
import { isExecutive } from '../../../lib/auth.ts';
import { localHelpTasks, accountingHelpTasks } from '../../../lib/helpTasks.ts';
import { json } from '../../../lib/http.ts';
import { canReadHelpTask, helpTaskReadVersion, markHelpTaskRead, withHelpTaskReads } from '../../../lib/helpTaskReads.ts';

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user?.approved) return json({ ok: false, message: 'ログインするとやることリストを確認できます。' }, 401);
  if (url.searchParams.get('source') === 'accounting') {
    if (!isExecutive(user)) return json({ ok: false, message: '幹部以上の権限が必要です。' }, 403);
    try {
      const tasks = await accountingHelpTasks(user);
      return json({ ok: true, tasks: locals.adminView?.readOnly ? tasks : withHelpTaskReads(user, tasks, 'accounting'), errors: [] });
    }
    catch { return json({ ok: false, message: '会計のやることを取得できませんでした。', tasks: [] }, 503); }
  }
  const result = localHelpTasks(user);
  return json({ ok: true, ...result, tasks: locals.adminView?.readOnly ? result.tasks : withHelpTaskReads(user, result.tasks) });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user?.approved) return json({ ok: false, message: 'ログインが必要です。' }, 401);
  if (!isExecutive(user)) return json({ ok: false, message: '幹部以上の権限が必要です。' }, 403);
  if (locals.adminView?.readOnly) return json({ ok: false, message: '表示確認は閲覧専用です。元の権限へ戻って操作してください。' }, 403);
  const data = await request.json().catch(() => null);
  if (!data || typeof data.id !== 'string' || !/^[\w:-]{1,160}$/.test(data.id) ||
    typeof data.version !== 'string' || !/^[a-f0-9]{64}$/.test(data.version) ||
    !['local', 'accounting'].includes(data.source) || Object.keys(data).some(k => !['id', 'version', 'source'].includes(k)))
    return json({ ok: false, message: '確認するやることを選び直してください。' }, 400);
  try {
    const result = data.source === 'accounting' ? { tasks: await accountingHelpTasks(user), errors: [] } : localHelpTasks(user);
    const tasks = result.tasks;
    const task = tasks.find(t => t.id === data.id);
    if (!task && result.errors.length) return json({ ok: false, message: '現在の対応状況を確認できませんでした。一覧を更新して再試行してください。' }, 503);
    if (!task) return json({ ok: true, completed: true });
    if (!canReadHelpTask(user, task)) return json({ ok: false, message: 'このやることは既読にできません。' }, 403);
    if (helpTaskReadVersion(task) !== data.version) return json({ ok: false, message: '内容が更新されています。一覧を更新して確認してください。' }, 409);
    const read = await markHelpTaskRead(user, task);
    return json({ ok: true, readAt: read.at });
  } catch { return json({ ok: false, message: '既読を保存できませんでした。時間をおいて再度お試しください。' }, 503); }
};
