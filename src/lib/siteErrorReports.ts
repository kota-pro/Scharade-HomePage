import crypto from 'node:crypto';
import { env } from './config.ts';
import { CONTACT_EMAIL, mailTransport } from './mail.ts';
import { readData, writeData, withStoreLock } from './store.ts';
import { errorReportDescription, errorReportKey, isReportableError, normalizeErrorReport, type ErrorReport } from './siteErrorReport.ts';

const FILE = 'site-error-reports.json', LOCK = 'site-error-reports';
const repeatWindow = 10 * 60000, hour = 3600000;
type Entry = { id: string; key: string; report: ErrorReport; firstAt: number; lastAt: number; receivedAt: number; count: number; attempts: number; nextAttemptAt: number; sentAt?: number; leaseUntil?: number; frames?: string[] };
type Queue = { version: 1; reports: Entry[]; deliveries: number[] };
export function errorReportsEnabled() {
  return env('SITE_ERROR_REPORTS_ENABLED') !== '0' && (env('NODE_ENV') === 'production' || env('SITE_ERROR_REPORTS_ENABLED') === '1');
}
function readQueue(now: number): Queue {
  const queue = readData<Queue>(FILE, { version: 1, reports: [], deliveries: [] });
  if (queue.version !== 1 || !Array.isArray(queue.reports) || !Array.isArray(queue.deliveries)) throw new Error('Invalid error report queue');
  const previousReports = queue.reports.length, previousDeliveries = queue.deliveries.length;
  let migrated = false;
  queue.reports = queue.reports.filter(entry => {
    const report = normalizeErrorReport(entry.report, now);
    if (report && entry.key !== errorReportKey(report)) { entry.key = errorReportKey(report); migrated = true; }
    // Apply the current policy to pending reports left by an older deployment as well.
    return report && isReportableError(report) && (entry.sentAt ? entry.sentAt >= now - 86400000 : entry.receivedAt >= now - 7 * 86400000);
  });
  queue.deliveries = queue.deliveries.filter(at => at > now - hour);
  if (migrated || previousReports !== queue.reports.length || previousDeliveries !== queue.deliveries.length) writeData(FILE, queue);
  return queue;
}
function safeFrames(error: unknown) {
  if (!(error instanceof Error)) return [];
  const stack = error.stack ?? '', header = `${error.name}: ${error.message}`;
  // Error messages may contain newlines and user text that looks like a stack frame.
  if (!stack.startsWith(header)) return [];
  return stack.slice(header.length).split('\n').filter(line => /^\s+at\s/.test(line)).flatMap(line => line.match(/(?:src|dist\/server)\/[A-Za-z0-9_./-]+\.(?:ts|js|mjs|astro):\d+:\d+/)?.[0] ?? []).slice(0,8);
}
export async function queueErrorReport(value: unknown, options: { now?: number; deliver?: boolean; error?: unknown } = {}) {
  if (!errorReportsEnabled()) return 'disabled' as const;
  const now = options.now ?? Date.now(), report = normalizeErrorReport(value, now);
  if (!report) return 'invalid' as const;
  if (!isReportableError(report)) return 'ignored' as const;
  try {
    const result = await withStoreLock(LOCK, () => {
      const queue = readQueue(now), key = errorReportKey(report);
      const previous = queue.reports.findLast(entry => entry.key === key && entry.receivedAt > now - repeatWindow);
      if (previous) {
        previous.count = Math.min(1000000, previous.count + 1); previous.lastAt = Math.max(previous.lastAt, report.at);
        previous.report.browser ??= report.browser; previous.report.platform ??= report.platform;
        writeData(FILE, queue); return 'duplicate' as const;
      }
      if (queue.reports.length >= 200) queue.reports = queue.reports.filter(entry => !entry.sentAt);
      if (queue.reports.length >= 200) return 'full' as const;
      queue.reports.push({ id: crypto.randomUUID(), key, report, firstAt: report.at, lastAt: report.at, receivedAt: now, count: 1, attempts: 0, nextAttemptAt: now, ...(options.error ? { frames: safeFrames(options.error) } : {}) });
      writeData(FILE, queue); return 'queued' as const;
    });
    if (options.deliver !== false) void deliverErrorReports().catch(() => console.error('[error-reports] delivery unavailable'));
    return result;
  } catch { console.error('[error-reports] queue unavailable'); return 'failed' as const; }
}
const reasonLabels: Record<ErrorReport['reason'], string> = {
  unspecified: '画面または処理でエラーを検出', exception: 'サイト内の処理で例外', 'unhandled-rejection': 'ブラウザーの未処理の失敗',
  'invalid-response': 'APIの応答形式を確認できなかった',
  'font-network': 'フォントの通信に失敗', 'font-http': 'フォント取得先がエラーを返した', 'font-decode': '取得したフォントを読み込めなかった',
  'font-timeout': 'フォント取得が時間切れ', 'measurement-timeout': '文字計測の準備が時間切れ', 'canvas-unavailable': '端末の文字計測機能を利用できない',
};
function emailText(entry: Entry) {
  const r = entry.report, date = (at: number) => new Date(at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }) + ' JST';
  return [
    '公式サイトでエラーを検出しました。', `レポート番号：${entry.id}`, `エラー番号：${r.code}`, `エラー内容：${errorReportDescription(r.code, r.detail)}`,
    `発生日時：${date(entry.firstAt)}`, `最終検出：${date(entry.lastAt)}`, `受信日時：${date(entry.receivedAt)}`, `送信準備時点の同種の検出回数：${entry.count}`,
    `ページ・処理：${r.route}`, `検出元：${r.kind}`, `状況：${reasonLabels[r.reason]}`, ...(r.method ? [`HTTPメソッド：${r.method}`] : []),
    ...(r.status === undefined ? [] : [`HTTP状態：${r.status}`]), ...(r.resource ? [`対象：${r.resource}`] : []),
    ...(r.browser ? [`ブラウザー：${r.browser}`] : []), ...(r.platform ? [`端末：${r.platform}`] : []),
    ...(r.online === undefined ? [] : [`端末の接続状態：${r.online ? 'オンライン' : 'オフライン'}`]),
    ...(r.exception ? [`例外の種類：${r.exception}`] : []), ...(r.line ? [`スクリプト位置：${r.line}:${r.column ?? 0}`] : []),
    ...(entry.frames?.length ? ['サーバー内の発生箇所：', ...entry.frames] : []), '',
    '入力本文・氏名・メールアドレス・写真・Cookie・認証情報・URLの識別情報は含めていません。',
    '同じエラー番号・機能の追加通知は10分間抑制し、送信は全体で1時間20回までです。',
  ].join('\n');
}
let delivery: Promise<number> | undefined;
export function deliverErrorReports(now = Date.now(), limit = 2): Promise<number> {
  if (!errorReportsEnabled() || !env('GMAIL_PASS')) return Promise.resolve(0);
  if (delivery) return delivery;
  delivery = (async () => {
    let sent = 0;
    for (let index = 0; index < limit; index++) {
      const entry = await withStoreLock(LOCK, () => {
        const queue = readQueue(now);
        if (queue.deliveries.length >= 20) return;
        const selected = queue.reports.find(item => !item.sentAt && (item.leaseUntil ?? 0) <= now && item.nextAttemptAt <= now);
        if (!selected) return;
        selected.leaseUntil = now + 90000; selected.attempts++; queue.deliveries.push(now); writeData(FILE, queue);
        return structuredClone(selected);
      });
      if (!entry) break;
      let delivered = false;
      try {
        const transport = mailTransport();
        try {
          const result = await transport.sendMail({ from: `"写団シャレード エラーレポート" <${CONTACT_EMAIL}>`, to: CONTACT_EMAIL, subject: `【Scharade エラーレポート】${entry.report.code}`, text: emailText(entry), disableFileAccess: true, disableUrlAccess: true });
          delivered = result.accepted?.some((recipient: any) => (typeof recipient === 'string' ? recipient : recipient.address) === CONTACT_EMAIL) ?? false;
        } finally { transport.close?.(); }
      } catch { console.error('[error-reports] mail delivery failed; retry queued'); }
      await withStoreLock(LOCK, () => {
        const queue = readQueue(now), current = queue.reports.find(item => item.id === entry.id);
        if (!current) return;
        delete current.leaseUntil;
        if (delivered) { current.sentAt = now; sent++; }
        else current.nextAttemptAt = now + Math.min(hour, 60000 * 2 ** Math.min(6, current.attempts - 1));
        writeData(FILE, queue);
      });
    }
    return sent;
  })().finally(() => { delivery = undefined; });
  return delivery;
}
let interval: ReturnType<typeof setInterval> | undefined;
export function startErrorReportDelivery() {
  if (interval || !errorReportsEnabled()) return;
  const run = () => { void deliverErrorReports().catch(() => console.error('[error-reports] delivery unavailable')); };
  interval = setInterval(run, 30000); interval.unref();
  const startup = setTimeout(run, 1000); startup.unref();
}
