import { isSiteErrorCode, siteErrors, publicErrorDescription, validErrorDetail, siteErrorDetails } from './siteErrors.ts';
import { exhibitionErrors, isExhibitionErrorCode } from './exhibitionErrors.ts';

export const errorReportEndpoint = '/api/error-reports';
export const reportKinds = ['display', 'validation', 'runtime', 'server', 'font'] as const;
export const reportReasons = ['unspecified', 'exception', 'unhandled-rejection', 'invalid-response', 'font-network', 'font-http', 'font-decode', 'font-timeout', 'measurement-timeout', 'canvas-unavailable'] as const;
export const reportBrowsers = ['Chrome', 'Firefox', 'Safari', 'Edge', 'Other'] as const;
export const reportPlatforms = ['Windows', 'macOS', 'iOS', 'Android', 'Linux', 'Other'] as const;
export const reportExceptions = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'SecurityError', 'NetworkError', 'AbortError', 'TimeoutError', 'Unknown'] as const;
export type ErrorReport = {
  code: keyof typeof siteErrors | keyof typeof exhibitionErrors;
  detail?: keyof typeof siteErrorDetails;
  source?: 'site-script';
  route: string;
  kind: typeof reportKinds[number];
  reason: typeof reportReasons[number];
  at: number;
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  status?: number;
  browser?: typeof reportBrowsers[number];
  platform?: typeof reportPlatforms[number];
  exception?: typeof reportExceptions[number];
  resource?: 'font-regular' | 'font-bold';
  online?: boolean;
  line?: number;
  column?: number;
};

// Only fixed route words may reach mail. Dynamic IDs, names, query strings and fragments never do.
const routeWords = new Set('api auth login signup mfa password-reset request reset complete verify resend review instagram start callback contact error-reports portfolio update upload member manage admin activities events exhibitions exhibition accounts notifications account-deletion-requests account-deletion content grouping grouping-roster roster-preview profiles participation layout lease presence assets layout-assets outputs output rooms form submissions integration google lightroom retries retry status privacy errors about_us activity gallery disclaimer appprivacy accountdeletion forgotpassword resetpassword reviewaccount searchresult sitemap posts advance receipts requests profile password settings'.split(' '));
export function errorReportRoute(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1000 || !value.startsWith('/') || value.startsWith('//')) return '/:unknown';
  const path = value.split(/[?#]/, 1)[0];
  return '/' + path.split('/').filter(Boolean).slice(0,12).map(segment => routeWords.has(segment.toLowerCase()) ? segment : ':id').join('/');
}
export function errorReportFamily(route: string): string {
  const parts = route.toLowerCase().split('/').filter(Boolean);
  if (parts[0] === 'api') parts.shift();
  const root = parts[0] ?? 'home';
  if (['auth','login','signup','mfa','forgotpassword','resetpassword','reviewaccount'].includes(root)) return 'auth';
  return root === 'exhibitions' ? 'exhibition' : root;
}
export function normalizeErrorReport(value: unknown, now = Date.now()): ErrorReport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const raw = value as Record<string, unknown>;
  if (!isSiteErrorCode(raw.code) && !isExhibitionErrorCode(raw.code)) return;
  const pick = <T extends readonly string[]>(values: T, value: unknown): T[number] | undefined => typeof value === 'string' && values.includes(value) ? value : undefined;
  const integer = (value: unknown, max: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : undefined;
  const status = integer(raw.status, 599), line = integer(raw.line, 1000000), column = integer(raw.column, 1000000);
  return {
    code: raw.code, route: errorReportRoute(raw.route), kind: pick(reportKinds, raw.kind) ?? 'display', reason: pick(reportReasons, raw.reason) ?? 'unspecified',
    ...(validErrorDetail(raw.code, raw.detail) ? { detail: raw.detail } : {}),
    ...(raw.source === 'site-script' ? { source: raw.source } : {}),
    at: typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at >= now - 86400000 && raw.at <= now + 300000 ? raw.at : now,
    ...(pick(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'] as const, raw.method) ? { method: raw.method as ErrorReport['method'] } : {}),
    ...(status === 0 || status !== undefined && status >= 100 ? { status } : {}),
    ...(pick(reportBrowsers, raw.browser) ? { browser: raw.browser as ErrorReport['browser'] } : {}),
    ...(pick(reportPlatforms, raw.platform) ? { platform: raw.platform as ErrorReport['platform'] } : {}),
    ...(pick(reportExceptions, raw.exception) ? { exception: raw.exception as ErrorReport['exception'] } : {}),
    ...(raw.resource === 'font-regular' || raw.resource === 'font-bold' ? { resource: raw.resource } : {}),
    ...(typeof raw.online === 'boolean' ? { online: raw.online } : {}),
    ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }),
  };
}
export function errorReportDescription(code: ErrorReport['code'], detail?: ErrorReport['detail']) {
  return publicErrorDescription(code, detail);
}
/** Report causes, not the presence of an alert. Expected request failures and device/network problems are not incidents. */
export function isReportableError(report: ErrorReport): boolean {
  if (report.kind === 'validation') return false;
  if (report.kind === 'server') return (report.status ?? 0) >= 500 || validErrorDetail(report.code, report.detail);
  if (report.kind === 'runtime') return report.code === 'SITE-010' && report.source === 'site-script' &&
    ['exception', 'unhandled-rejection'].includes(report.reason) &&
    ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(report.exception ?? '');
  if (report.online === false) return false;
  if (report.kind === 'font') return report.code === 'EXH-022' &&
    (report.reason === 'font-decode' || report.reason === 'font-http' && (report.status ?? 0) >= 400 && report.status !== 429);
  return validErrorDetail(report.code, report.detail) || report.reason === 'invalid-response' && ['SITE-009', 'EXH-018'].includes(report.code) ||
    (report.status ?? 0) >= 500;
}
export function errorReportKey(report: ErrorReport) {
  return [report.code, errorReportFamily(report.route), report.detail ?? '', report.kind === 'font' ? `${report.reason}:${report.resource ?? ''}` : ''].join(':');
}
