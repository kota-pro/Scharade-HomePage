export type AccountingPerson = {
  id: string; name: string; university: string; lineName: string; active: boolean;
  siteUserIds: string[]; rosterKey?: string;
};
export type AccountingEvent = {
  id: string; date: string; type: string; description: string; amount: number;
  account?: string; from?: string; to?: string; memberId?: string; advanceId?: string;
  createdAt: string; actor: string; notes?: string; canceledAt?: string; cancelReason?: string;
  bankDelta?: number; cashDelta?: number; bankBalance?: number; cashBalance?: number;
};
export type AccountingRequest = {
  id: string; date: string; description: string; amount: number; accountName: string;
  rosterName: string; university: string; lineName: string; websiteUserId: string;
  notes: string; status: string; memberId: string; transactionId: string; reviewNote: string;
  receiptUrl?: string; hasReceipt?: boolean; refundMethod: string; refundLineName: string;
  bankName: string; bankAccountName: string; bankBranchName: string; bankBranchCode: string; bankAccountNumber: string;
};
export type AccountingAdvance = { id: string; memberId: string; date: string; description: string; amount: number; repaid: number; outstanding: number };
export type AccountingRosterSnapshot = {
  revision: number; fingerprint: string; source: string; title: string; fetchedAt: string;
  records: { key: string; name: string; university: string; lineName: string; active: boolean; uncertain: boolean; siteUserIds: string[] }[];
};
export type AccountingData = {
  revision: string; today: string; issue: string; members: AccountingPerson[]; events: AccountingEvent[]; requests: AccountingRequest[];
  settings: { startDate: string; bankOpening: number | ""; cashOpening: number | ""; fiscalYear: number; note: string };
  summary: null | { bank: number; cash: number; outstanding: number; rows: AccountingEvent[]; advances: AccountingAdvance[]; people: { memberId: string; amount: number; repaid: number; outstanding: number }[] };
  months: { month: string; income: number | null; expense: number | null; net: number | null; bank: number | null; cash: number | null; outstanding: number | null }[];
  checks: { date: string; account: string; actual: number; expected: number; difference: number }[];
  sharedRoster: null | { revision: number; fingerprint: string; title: string; fetchedAt: string; syncedAt: string };
  rosterPending: { record: AccountingRosterSnapshot["records"][number]; reason: string }[];
  pendingOperations: { id: string; action: string; actor: string; at: string }[];
  history: { id: string; action: string; actor: string; at: string; status: string; target: string }[];
  rosterStatus?: { configured: boolean; current: boolean; revision: number; title: string; error: boolean };
};
export type AccountingAction = Record<string, string | number> & { action: "transaction" | "review" | "cancel" | "check" | "settings" | "resolveRoster" | "refresh" | "recover"; operationId: string; expectedRevision: string };
