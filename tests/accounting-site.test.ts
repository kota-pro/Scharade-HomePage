import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { siteHarness } from "./helpers/accounting-site-harness.ts";
import { accountingView, accountingAction, validateAccountingAction } from "../src/lib/accounting.ts";
import { currentAccountingRoster, queueAccountingRoster, drainAccountingRoster, accountingRosterJob, accountingRosterSnapshot } from "../src/lib/accountingRoster.ts";
import type { ActivityRoster } from "../src/lib/activityTypes.ts";
import { writeData } from "../src/lib/store.ts";

test("only applied roster snapshots and confirmed bindings are synchronized, with durable retries", async () => {
  const oldEnv = { ...process.env }, originalFetch = globalThis.fetch, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accounting-site-'));
  process.env.DATA_DIR = dir;process.env.ACCOUNTING_ADMIN_GAS_URL = 'https://script.google.com/macros/s/accounting-fixture/exec';process.env.ACCOUNTING_ADMIN_WEBHOOK_SECRET = 'accounting-admin-fixture-secret-32-characters';
  const h = siteHarness(); let fail = true, last: any;
  globalThis.fetch = (async (_: unknown, options: RequestInit) => { last = JSON.parse(JSON.parse(String(options.body)).payload);if (fail) throw new Error('offline');return Response.json(h.ctx.doPost({ postData: { contents: String(options.body) } })); }) as typeof fetch;
  try {
    writeData('member-activities.json', { rosterPreviews: [{ source: { spreadsheetId: 'not-applied' } }] });
    await queueAccountingRoster();assert.equal(accountingRosterJob(), null);
    assert.equal(currentAccountingRoster(), null);
    const roster: ActivityRoster = { revision: 1, spreadsheetId: 'configured', sheetId: 42, title: '確定した名簿', sheetTitle: '回答', fetchedAt: '2026-11-01T00:00:00.000Z', fetchedBy: 'admin', records: [{ key: 'stable-person', name: '会員A', university: '大学', lineName: 'LINE', gender: 'female', grade: '1', active: true, identityHash: 'private-identity' }], bindings: { member: 'stable-person' } };
    writeData('member-activities.json', { roster });await queueAccountingRoster();
    const first = accountingRosterJob()!;assert.equal(first.snapshot.records[0].siteUserIds[0], 'member');
    assert.equal('identityHash' in first.snapshot.records[0], false);assert.equal('gender' in first.snapshot.records[0], false);
    assert.equal((await drainAccountingRoster()).delivered, 0);assert.equal(accountingRosterJob()!.error, true);
    fail = false;writeData('accounting-roster.json', { ...accountingRosterJob(), nextAttemptAt: 0 });
    assert.equal((await drainAccountingRoster()).delivered, 1);assert.equal(h.read().sharedRoster.fingerprint, first.snapshot.fingerprint);
    assert.equal((await drainAccountingRoster()).attempted, 0);
    roster.revision++;roster.bindings = {};writeData('member-activities.json', { roster });
    assert.equal((await drainAccountingRoster()).delivered, 1);assert.equal(h.read().members[0].siteUserIds.length, 0);
    const users = ['member', 'staff', 'executive', 'admin'].map(role => ({ id: role, role, name: role, email: role + '@example.invalid', approved: true, providers: {}, createdAt: '' }));writeData('users.json', users);
    await assert.rejects(accountingView('staff'), /幹部/);await assert.rejects(accountingView('member'), /幹部/);
    const data = (await accountingView('executive')).data;assert.equal(data.rosterStatus!.current, true);
    const result = await accountingAction('executive', { action: 'check', operationId: crypto.randomUUID(), expectedRevision: data.revision, date: '2026-09-01', account: 'bank', actual: 10002 });
    assert.equal(result.data.checks[0].difference, 2);assert.equal(last.actor.id, 'executive');assert.equal(last.actor.role, 'executive');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim()).actorId, 'executive');
    users[2].role = 'staff';writeData('users.json', users);await assert.rejects(accountingView('executive'), /幹部/);
    const changed = { ...roster, revision: roster.revision + 1, records: roster.records.map(r => ({ ...r, active: false })) };
    assert.notEqual(accountingRosterSnapshot(changed)!.fingerprint, accountingRosterSnapshot(roster)!.fingerprint);
  } finally { globalThis.fetch = originalFetch;for (const key of ['DATA_DIR', 'ACCOUNTING_ADMIN_GAS_URL', 'ACCOUNTING_ADMIN_WEBHOOK_SECRET']) { if (oldEnv[key] === undefined) delete process.env[key];else process.env[key] = oldEnv[key]; }fs.rmSync(dir, { recursive: true, force: true }); }
});
test("website action interface rejects identity injection and unknown or malformed fields", () => {
  const value = { action: 'check', operationId: crypto.randomUUID(), expectedRevision: 'a'.repeat(64), date: '2026-09-01', account: 'bank', actual: '00100' };
  assert.equal(validateAccountingAction(value).actual, 100);
  for (const extra of [{ actor: { id: 'admin' } }, { role: 'admin' }, { action: 'roster.sync' }, { actual: '' }, { actual: '1.5' }, { actual: [] }, { operationId: 'bad' }, { expectedRevision: 'bad' }]) assert.throws(() => validateAccountingAction({ ...value, ...extra }));
});
