import { errorReportEndpoint, errorReportKey, isReportableError, normalizeErrorReport, type ErrorReport } from '../lib/siteErrorReport.ts';
import { numberedError, registeredErrorDetail } from '../lib/siteErrors.ts';

const storageKey = 'scharade:error-reports:v1', pending: ErrorReport[] = [], seen = new Map<string, number>();
let running = false, started = false, retry: number | undefined;
function persist() {
  try { if (pending.length) sessionStorage.setItem(storageKey, JSON.stringify(pending.slice(0,20))); else sessionStorage.removeItem(storageKey); } catch { /* Reporting must never affect the form. */ }
}
async function flush() {
  if (running) return;
  for (let index = pending.length - 1; index >= 0; index--) if (pending[index].at < Date.now() - 86400000) pending.splice(index, 1);
  persist();
  if (!pending.length || !navigator.onLine) return;
  running = true; clearTimeout(retry);
  try {
    for (let count = 0; pending.length && count < 20; count++) {
      const report = pending[0];
      const response = await fetch(errorReportEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report), credentials: 'same-origin', referrerPolicy: 'no-referrer', keepalive: true, signal: AbortSignal.timeout(8000) });
      if (!response.ok && ![400,403,413].includes(response.status)) break;
      pending.shift(); persist();
    }
  } catch { /* Keep the small, sanitized queue for reconnect/reload; do not report delivery failures. */ }
  finally {
    running = false;
    if (pending.length) retry = window.setTimeout(() => { void flush(); }, 60000);
  }
}
function environment() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Other';
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other';
  return { browser, platform, online: navigator.onLine };
}
export function reportSiteError(code: unknown, details: Partial<ErrorReport> = {}) {
  if (typeof window === 'undefined' || location.pathname === errorReportEndpoint) return;
  try {
    if (!started) setupErrorReports();
    const report = normalizeErrorReport({ ...details, ...environment(), code, at: Date.now(), route: document.body?.dataset.errorReportRoute ?? location.pathname });
    if (!report || !isReportableError(report)) return;
    const key = errorReportKey(report);
    const now = Date.now(); if ((seen.get(key) ?? 0) > now - 600000) return;
    for (const [key, at] of seen) if (at < now - 600000) seen.delete(key);
    if (seen.size >= 100 || pending.length >= 20) return;
    seen.set(key, now); pending.push(report); persist(); void flush();
  } catch { /* Diagnostics are best effort and cannot interrupt the user's operation. */ }
}
export function reportDisplayedError(message: string) {
  const code = numberedError(message.trim());
  if (code) reportSiteError(code, { detail: registeredErrorDetail(code, message.trim().slice(message.trim().indexOf('\n') + 1)) });
}
function scriptBug(error: unknown) {
  if (!(error instanceof Error)) return false;
  if (numberedError(error.message)) return false;
  // Fetch rejects with TypeError even when no application bug occurred.
  return !/Failed to fetch|Load failed|NetworkError when attempting|fetch failed|Network request failed|Failed to execute ['"]fetch|abort|cancel/i.test(error.message);
}
export function setupErrorReports() {
  if (started) return; started = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
    if (Array.isArray(saved)) for (const item of saved.slice(0,20)) {
      if (typeof item.at !== 'number' || item.at < Date.now() - 86400000) continue;
      const normalized = normalizeErrorReport(item); if (normalized && isReportableError(normalized)) pending.push(normalized);
    }
  } catch { /* Damaged browser storage must not break the page. */ }
  persist(); void flush();
  window.addEventListener('online', () => { void flush(); });
  window.addEventListener('error', event => {
    if (!(event instanceof ErrorEvent)) return;
    if (!scriptBug(event.error)) return;
    try { if (!event.filename || new URL(event.filename, location.href).origin !== location.origin) return; } catch { return; }
    reportSiteError('SITE-010', { kind: 'runtime', source: 'site-script', reason: 'exception', exception: event.error?.name, line: event.lineno, column: event.colno });
  });
  window.addEventListener('unhandledrejection', event => {
    if (!scriptBug(event.reason)) return;
    const urls = (event.reason.stack ?? '').match(/https?:\/\/[^\s)]+/g) ?? [];
    if (!urls.some((url: string) => { try { return new URL(url).origin === location.origin; } catch { return false; } })) return;
    reportSiteError('SITE-010', { kind: 'runtime', source: 'site-script', reason: 'unhandled-rejection', exception: event.reason.name });
  });
}
