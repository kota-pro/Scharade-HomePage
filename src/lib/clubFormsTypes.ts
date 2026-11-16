export type ClubSeason = "spring" | "autumn";
export type ClubFormKind =
  | "admission"
  | "continuation"
  | "welcome_photo"
  | "welcome_meal";
export type ClubFormState = "draft" | "open" | "closed";
export type RosterSheetSource = { spreadsheetId: string; sheetId: number };
export type TermRosterSource = {
  year: number;
  season: ClubSeason;
  admission: RosterSheetSource;
  continuation: RosterSheetSource;
};
export const clubSeasonLabels: Record<ClubSeason, string> = {
  spring: "春",
  autumn: "秋",
};
export const clubFormLabels: Record<ClubFormKind, string> = {
  admission: "入会",
  continuation: "継続",
  welcome_photo: "新歓撮影会",
  welcome_meal: "新歓食事会",
};
export const welcomeFeeOnDayMessage = "当日、参加費がかかる場合があります";
export type ClubFormInput = {
  year: number;
  season: ClubSeason;
  kind: ClubFormKind;
  fee: number;
  feeOnDay?: boolean;
  capacity?: number;
  deadline: string;
  eventName: string;
  autoEventName?: boolean;
  startsAt: string;
  endsAt: string;
  place: string;
};
export type ClubFormRemote = {
  formId: string;
  spreadsheetId: string;
  sheetId: number;
  editUrl: string;
  responseUrl: string;
  spreadsheetUrl: string;
  folderUrl: string;
  mergedSpreadsheetUrl?: string;
  state: ClubFormState;
  revision: number;
  closedReason?: "manual" | "deadline" | "capacity" | "upload_setup";
  responseCount?: number;
  uploadRequired?: boolean;
  uploadReady?: boolean;
};
export type ClubForm = ClubFormInput & {
  id: string;
  revision: number;
  state: ClubFormState;
  desiredState: ClubFormState;
  createdAt: string;
  updatedAt: string;
  actorId: string;
  remote?: ClubFormRemote;
  delivery: "pending" | "done" | "error";
  checkedAt?: string;
  statusError?: string;
  deleteRequestedAt?: string;
  deletedAt?: string;
};
export type ClubFormOperation = {
  id: string;
  formId: string;
  revision: number;
  actorId: string;
  action: "create" | "update" | "open" | "close" | "delete";
  input: ClubFormInput;
  desiredState: ClubFormState;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  attempts: number;
  nextAttemptAt: number;
  leaseUntil?: number;
  leaseToken?: string;
  error?: string;
};
export type ClubFormsStore = {
  version: 1;
  forms: ClubForm[];
  operations: ClubFormOperation[];
};
export type RosterProvenance = {
  kind: "admission" | "continuation";
  spreadsheetId: string;
  sheetId: number;
  submittedAt: string;
};
export type RosterExport = {
  id: string;
  term: TermRosterSource;
  revision: number;
  records: import("./activityTypes.ts").RosterRecord[];
  retiredRecords: import("./activityTypes.ts").RosterRecord[];
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  attempts: number;
  nextAttemptAt: number;
  leaseUntil?: number;
  leaseToken?: string;
  spreadsheetUrl?: string;
  error?: string;
};
