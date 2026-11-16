import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { errorReportRoute, normalizeErrorReport, isReportableError, errorReportDescription } from '../src/lib/siteErrorReport.ts';
import { deliverErrorReports, errorReportsEnabled, queueErrorReport } from '../src/lib/siteErrorReports.ts';
import { readData, writeData } from '../src/lib/store.ts';
import { siteErrors } from '../src/lib/siteErrors.ts';
import { exhibitionErrors } from '../src/lib/exhibitionErrors.ts';
import { POST } from '../src/pages/api/error-reports.ts';

const originalTransport = nodemailer.createTransport;
let directory: string, messages: any[], oldEnv: Record<string, string | undefined>;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scharade-error-reports-')); messages = [];
  oldEnv = Object.fromEntries(['DATA_DIR','NODE_ENV','SITE_ERROR_REPORTS_ENABLED','GMAIL_PASS'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { DATA_DIR: directory, NODE_ENV: 'test', SITE_ERROR_REPORTS_ENABLED: '1', GMAIL_PASS: 'synthetic-no-network' });
  nodemailer.createTransport = (() => ({ sendMail: async (message: any) => { messages.push(message); return { accepted: ['contact@scharade.jp'] }; } })) as any;
});
afterEach(async () => {
  await deliverErrorReports(); nodemailer.createTransport = originalTransport;
  for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  fs.rmSync(directory, { recursive: true, force: true });
});
const report = (code = 'SITE-011', extra: Record<string, unknown> = {}) => ({ code, route: '/Exhibition/private-name?token=private-token#private-fragment', kind: 'display', source: 'site-script', status: 503, at: Date.now(), ...extra });
const queue = () => readData<any>('site-error-reports.json', { reports: [], deliveries: [] });
test('only registered codes and fixed diagnostics are retained; input, identities and URL secrets are discarded', () => {
  const value = normalizeErrorReport(report('EXH-001', { name: 'private-name', password: 'private-password', message: 'private-text', email: 'private@example.invalid', cookie: 'session-secret', browser: 'Chrome', platform: 'macOS', reason: 'private-reason', resource: 'font-regular', status: 404, method: 'POST\r\nBcc:evil@example.invalid' }))!;
  assert.equal(value.route, '/Exhibition/:id'); assert.equal(value.status, 404); assert.equal(value.reason, 'unspecified'); assert.equal(value.method, undefined);
  assert.doesNotMatch(JSON.stringify(value), /private-|@|cookie|password|message/);
  assert.equal(normalizeErrorReport(report('MADE-UP-999')), undefined);
  assert.equal(errorReportRoute('/api/exhibitions/[id]/upload'), '/api/exhibitions/:id/upload');
  assert.equal(errorReportRoute('//outside.invalid/secret'), '/:unknown');
});
test('all ordinary request errors, validation, visible text alone, offline and device failures are excluded at intake', async () => {
  for (const code of [...Object.keys(siteErrors), ...Object.keys(exhibitionErrors)]) {
    for (const status of [0, 200, 400, 401, 403, 404, 409, 410, 413, 415, 422, 429]) {
      assert.equal(await queueErrorReport(report(code, { kind: 'server', status }), { deliver: false }), 'ignored', `${code}/${status}`);
      assert.equal(await queueErrorReport(report(code, { status }), { deliver: false }), 'ignored', `${code}/${status}`);
    }
    assert.equal(await queueErrorReport(report(code, { status: undefined }), { deliver: false }), 'ignored');
  }
  for (const extra of [
    { code: 'SITE-001', kind: 'validation' },
    { code: 'SITE-010', kind: 'runtime', reason: 'unhandled-rejection', exception: 'NetworkError' },
    { code: 'SITE-010', kind: 'runtime', reason: 'unhandled-rejection', exception: 'AbortError' },
    { code: 'SITE-010', kind: 'runtime', reason: 'exception', exception: 'TypeError', source: undefined },
    ...['font-network','font-timeout','measurement-timeout','canvas-unavailable'].map(reason => ({ code: 'EXH-022', kind: 'font', reason })),
  ]) assert.equal(await queueErrorReport(report('SITE-011', extra), { deliver: false }), 'ignored', JSON.stringify(extra));
  assert.equal(queue().reports.length, 0); assert.equal(messages.length, 0);
});
test('server outages, invalid API replies, own-script bugs and broken font assets remain reportable', () => {
  for (const extra of [
    { code: 'SITE-011', kind: 'server', status: 503 },
    { code: 'SITE-014', kind: 'server', status: 502 },
    { code: 'EXH-015', status: 503 },
    { code: 'SITE-009', reason: 'invalid-response', status: 200 },
    { code: 'EXH-018', reason: 'invalid-response', status: 502 },
    { code: 'SITE-010', kind: 'runtime', reason: 'exception', exception: 'TypeError' },
    { code: 'SITE-010', kind: 'runtime', reason: 'unhandled-rejection', exception: 'Error', online: false },
    { code: 'EXH-022', kind: 'font', reason: 'font-http', status: 404 },
    { code: 'EXH-022', kind: 'font', reason: 'font-decode' },
  ]) assert.equal(isReportableError(normalizeErrorReport(report('SITE-011', extra))!), true, JSON.stringify(extra));
});
test('old pending user-error reports are discarded on delivery after upgrading the notification policy', async () => {
  const now = Date.now(); await queueErrorReport(report(), { now, deliver: false });
  const data = queue(), old = structuredClone(data.reports[0]);
  old.id = crypto.randomUUID(); old.report.code = 'SITE-016'; old.report.status = 400;
  data.reports.push(old); writeData('site-error-reports.json', data);
  assert.equal(await deliverErrorReports(now), 1);
  assert.equal(queue().reports.length, 1); assert.equal(messages.length, 1);
  assert.ok(messages[0].text.includes(`エラー内容：${errorReportDescription('SITE-011')}`));
});
test('valid legacy incident keys migrate without sending a second notification within ten minutes', async () => {
  const now = Date.now(); await queueErrorReport(report(), { now, deliver: false }); await deliverErrorReports(now);
  const data = queue(); data.reports[0].key = 'SITE-011:exhibition:'; writeData('site-error-reports.json', data);
  assert.equal(await queueErrorReport(report(), { now: now + 1000, deliver: false }), 'duplicate');
  assert.equal(await deliverErrorReports(now + 1000), 0); assert.equal(messages.length, 1);
});
test('reports are queued durably, delivered only to contact, and include safe diagnostic details and server frames', async () => {
  const error = new Error('private-name private@example.invalid\n at fake (/src/private-input.ts:1:1)');
  error.stack = `Error: ${error.message}\n at f (/home/private-user/app/src/pages/api/contact.ts:12:4)`;
  assert.equal(await queueErrorReport(report('EXH-022', { kind: 'font', reason: 'font-http', resource: 'font-regular', status: 404, browser: 'Safari', platform: 'iOS', online: true, message: 'private-input' }), { deliver: false, error }), 'queued');
  assert.equal(messages.length, 0); assert.equal(queue().reports.length, 1);
  assert.equal(await deliverErrorReports(), 1);
  const mail = messages[0]; assert.equal(mail.to, 'contact@scharade.jp'); assert.match(mail.subject, /EXH-022/);
  for (const text of ['404','Safari','iOS','font-regular','JST','src/pages/api/contact.ts:12:4']) assert.ok(mail.text.includes(text), text);
  assert.doesNotMatch(JSON.stringify(mail), /private-|private@|\/home\/|token=|cookie|Bcc/);
  assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true); assert.ok(queue().reports[0].sentAt);
});
test('the API and browser observations of the same error merge; repeat notifications wait ten minutes', async () => {
  const now = Date.now();
  await queueErrorReport(report('EXH-015', { kind: 'server', route: '/api/exhibitions/[id]', at: now }), { now, deliver: false });
  await deliverErrorReports(now);
  assert.equal(await queueErrorReport(report('EXH-015'), { now: now + 1000, deliver: false }), 'duplicate');
  assert.equal(queue().reports[0].count, 2); assert.equal(await deliverErrorReports(now + 1000), 0); assert.equal(messages.length, 1);
  await queueErrorReport(report('EXH-015'), { now: now + 600001, deliver: false });
  assert.equal(await deliverErrorReports(now + 600001), 1); assert.equal(messages.length, 2);
});
test('SMTP failure retains the report and retries later without creating another error report', async () => {
  const now = Date.now(); let attempts = 0;
  nodemailer.createTransport = (() => ({ sendMail: async (message: any) => { if (++attempts === 1) throw new Error('Synthetic SMTP error'); messages.push(message); return { accepted: [message.to] }; } })) as any;
  await queueErrorReport(report(), { now, deliver: false });
  assert.equal(await deliverErrorReports(now), 0); assert.equal(queue().reports.length, 1); assert.equal(queue().reports[0].attempts, 1);
  assert.equal(await deliverErrorReports(now + 59999), 0); assert.equal(attempts, 1);
  assert.equal(await deliverErrorReports(now + 60000), 1); assert.equal(messages.length, 1);
});
test('delivery is capped at twenty SMTP attempts per hour while remaining reports stay queued', async () => {
  const now = Date.now(), codes = [...Object.keys(siteErrors), ...Object.keys(exhibitionErrors)].slice(0,30);
  for (const code of codes) await queueErrorReport(report(code), { now, deliver: false });
  assert.equal(await deliverErrorReports(now, 100), 20); assert.equal(messages.length, 20);
  assert.equal(queue().reports.filter((entry: any) => !entry.sentAt).length, 10);
  assert.equal(await deliverErrorReports(now + 3600001, 100), 10);
});
test('an interrupted delivery lease can be recovered after restart and concurrent drain calls do not duplicate mail', async () => {
  const now = Date.now(); await queueErrorReport(report(), { now, deliver: false });
  const data = queue(); data.reports[0].leaseUntil = now + 90000; writeData('site-error-reports.json', data);
  assert.equal(await deliverErrorReports(now), 0);
  await Promise.all([deliverErrorReports(now + 90001), deliverErrorReports(now + 90001)]);
  assert.equal(messages.length, 1);
});
test('expired delivery records and abandoned pending reports are removed during background delivery', async () => {
  const now = Date.now(); await queueErrorReport(report(), { now, deliver: false });
  const data = queue(), old = structuredClone(data.reports[0]);
  data.reports[0].sentAt = now - 86400001; data.reports[0].receivedAt = now - 86400001;
  old.id = crypto.randomUUID(); old.receivedAt = now - 7 * 86400000 - 1;
  data.reports.push(old); writeData('site-error-reports.json', data);
  assert.equal(await deliverErrorReports(now), 0); assert.equal(queue().reports.length, 0);
});
function request(value: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/error-reports', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}
test('report acknowledgement does not wait for SMTP and mail is not addressed by client fields', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  nodemailer.createTransport = (() => ({ sendMail: async (message: any) => { await gate; messages.push(message); return { accepted: [message.to] }; } })) as any;
  try {
    const response = await POST({ request: request(report('SITE-001', { to: 'wrong@example.invalid', subject: 'arbitrary-subject' })) } as any);
    assert.equal(response.status, 204); assert.equal(messages.length, 0);
  } finally { release(); }
  await deliverErrorReports(); assert.equal(messages[0].to, 'contact@scharade.jp'); assert.doesNotMatch(messages[0].subject, /arbitrary/);
});
test('the public intake rejects cross-origin, fabricated codes, oversized payloads and forged server reports', async () => {
  for (const [value, origin, status] of [[report(), 'https://outside.invalid', 403], [report('BAD-999'), 'http://localhost', 400], [report('SITE-001', { kind: 'server' }), 'http://localhost', 400], [report('SITE-001', { text: 'x'.repeat(3000) }), 'http://localhost', 413]] as const) {
    const response = await POST({ request: request(value, origin) } as any); assert.equal(response.status, status);
  }
  assert.equal(messages.length, 0); assert.equal(queue().reports.length, 0);
});
test('configuration and queue failures never cause recursive reports or leak diagnostics', async () => {
  process.env.SITE_ERROR_REPORTS_ENABLED = '0'; assert.equal(await queueErrorReport(report()), 'disabled'); assert.equal(messages.length, 0);
  delete process.env.SITE_ERROR_REPORTS_ENABLED; process.env.NODE_ENV = 'development'; assert.equal(errorReportsEnabled(), false);
  process.env.NODE_ENV = 'production'; assert.equal(errorReportsEnabled(), true);
  process.env.SITE_ERROR_REPORTS_ENABLED = '1'; fs.writeFileSync(path.join(directory, 'site-error-reports.json'), '{broken');
  assert.equal(await queueErrorReport(report()), 'failed'); assert.equal(messages.length, 0);
  // Restore the queue before the teardown drains outstanding work.
  fs.rmSync(path.join(directory, 'site-error-reports.json'));
});
