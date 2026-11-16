import crypto from "node:crypto";
import type { ActivityRoster } from "./activityTypes.ts";
import type { AccountingRosterSnapshot } from "./accountingTypes.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { accountingConfigured, postAccountingAdmin } from "./accountingGoogle.ts";

type RosterJob = { snapshot: AccountingRosterSnapshot; attempts: number; nextAttemptAt: number; delivered?: string; leaseUntil?: number; leaseToken?: string; error?: boolean };
const file = "accounting-roster.json";
export function accountingRosterSnapshot(roster?: ActivityRoster): AccountingRosterSnapshot | null {
  if (!roster || !Number.isSafeInteger(roster.revision) || roster.revision < 1) return null;
  const unique = new Map([...(roster.retiredRecords || []), ...roster.records].map(row => [row.key, row]));
  const records = [...unique.values()].map(row => ({
    key: row.key, name: row.name, university: row.university || "", lineName: row.lineName || "", active: row.active,
    uncertain: !!(row.identityUncertain || row.membershipUncertain),
    siteUserIds: Object.entries(roster.bindings).filter(([, key]) => key === row.key).map(([id]) => id).sort(),
  })).sort((a, b) => a.key.localeCompare(b.key));
  const source = JSON.stringify(roster.term || { spreadsheetId: roster.spreadsheetId, sheetId: roster.sheetId });
  const value = { revision: roster.revision, source, title: roster.title, fetchedAt: roster.fetchedAt, records };
  return { ...value, fingerprint: crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex") };
}
export function currentAccountingRoster() {
  return accountingRosterSnapshot(readData<{ roster?: ActivityRoster }>("member-activities.json", {}).roster);
}
export function accountingRosterJob() { return readData<RosterJob | null>(file, null); }
export async function queueAccountingRoster() {
  // The worker also compares this source each tick, repairing a crash between stores.
  return withStoreLock("accounting-roster", () => {
    const snapshot = currentAccountingRoster(); if (!snapshot) return;
    const old = accountingRosterJob();
    if (old?.snapshot.fingerprint === snapshot.fingerprint) return;
    writeData<RosterJob>(file, { snapshot, attempts: 0, nextAttemptAt: 0 });
  });
}
export async function drainAccountingRoster() {
  if (!accountingConfigured()) return { attempted: 0, delivered: 0 };
  await queueAccountingRoster();
  const job = await withStoreLock("accounting-roster", () => {
    const row = accountingRosterJob(), now = Date.now();
    if (!row || row.delivered || row.nextAttemptAt > now || (row.leaseUntil || 0) > now) return null;
    row.leaseUntil = now + 60000; row.leaseToken = crypto.randomUUID(); writeData(file, row); return row;
  });
  if (!job) return { attempted: 0, delivered: 0 };
  let success = false;
  try { await postAccountingAdmin({ action: "roster.sync", snapshot: job.snapshot }); success = true; } catch { /* Only status, never roster data, is logged. */ }
  await withStoreLock("accounting-roster", () => {
    const row = accountingRosterJob(); if (!row || row.leaseToken !== job.leaseToken) return;
    row.attempts++; row.leaseUntil = 0; delete row.leaseToken; row.error = !success;
    if (success) row.delivered = new Date().toISOString();
    else row.nextAttemptAt = Date.now() + Math.min(900000, 30000 * 2 ** Math.min(row.attempts - 1, 5));
    writeData(file, row);
  });
  return { attempted: 1, delivered: Number(success) };
}
