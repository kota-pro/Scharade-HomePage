import type { APIRoute } from 'astro';
import { accountRole } from '../../../lib/roles.ts';
import { helpCatalog, helpGuide, pageHelp } from '../../../lib/helpCatalog.ts';
import { localHelpTasks } from '../../../lib/helpTasks.ts';
import { json } from '../../../lib/http.ts';

export const GET: APIRoute = ({ locals, url }) => {
  const user = locals.user;
  const path = (url.searchParams.get('path') || '/').slice(0, 512);
  const id = url.searchParams.get('guide') || '';
  const entity = url.searchParams.get('entity') || undefined;
  if (id.length > 80 || entity && (entity.length > 128 || !/^[\w-]+$/.test(entity))) return json({ ok: false, message: '案内の対象を確認してください。' }, 400);
  try {
    const page = pageHelp(path, user);
    const guide = id ? id === '__page__' ? page : helpGuide(id, path, user, entity) : undefined;
    return json({ ok: true, viewer: user ? { id: user.id, approved: user.approved, role: accountRole(user), authVersion: user.authVersion ?? 0 } : null, page, guides: helpCatalog(user).map(({ steps, choices, ...metadata }) => metadata), guide, completed: localHelpTasks(user).completed });
  } catch {
    return json({ ok: false, message: 'この対象の案内を利用できません。権限や対象の公開状態をご確認ください。' }, user?.approved ? 403 : 401);
  }
};
