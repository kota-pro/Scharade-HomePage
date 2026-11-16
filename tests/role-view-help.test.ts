import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpCatalog, helpGuide, pageHelp } from '../src/lib/helpCatalog.ts';
import type { User } from '../src/lib/auth.ts';
const member: User = { id: 'member', name: '会員', email: '', role: 'member', approved: true, createdAt: '', providers: {} };
const staff: User = { ...member, role: 'staff' };
const executive: User = { ...member, role: 'executive' };
const admin: User = { ...member, role: 'admin' };
test('role preview guides follow the original role and Management entry for staff', () => {
  for (const [actor, destination, roles] of [[staff, '/Management/view', ['member', 'guest']], [executive, '/Admin/view', ['member', 'staff', 'guest']], [admin, '/Admin/view', ['member', 'executive', 'staff', 'guest']]] as const) {
    const guide = helpGuide('admin-view', '/', actor);
    assert.ok(guide.steps.every(step => step.path === destination));
    assert.deepEqual(guide.steps.filter(step => step.target?.startsWith('[data-admin-view-role=')).map(step => step.target), roles.map(role => `[data-admin-view-role="${role}"]`));
    assert.equal(helpCatalog(actor).some(g => g.id === 'admin-login'), actor !== staff);
  }
  assert.throws(() => helpGuide('admin-view', '/', member));
  assert.equal(pageHelp('/Management/view', staff).id, 'admin-view');
});
