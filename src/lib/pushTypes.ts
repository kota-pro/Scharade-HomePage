export type PushDevice = {
  id: string;
  secretHash: string;
  userId: string;
  authVersion: number;
  sessionId: string;
  token: string;
  platform: "ios" | "android";
  enabled: boolean;
  remindersEnabled: boolean;
  generation: string;
  createdAt: string;
  updatedAt: string;
};
export type PushDeviceStore = { version: 1; devices: PushDevice[] };
export type ReminderKind =
  | "event-deadline"
  | "event-start"
  | "exhibition-vote"
  | "exhibition-submission";
export type ReminderSchedule = {
  key: string;
  sourceId: string;
  kind: ReminderKind;
  targetAt: number;
  dueAt: number;
  configuredAt?: number;
  completedAt?: number;
};
export type PushJob = {
  id: string;
  noticeId: string;
  deviceId: string;
  generation: string;
  status: "pending" | "receipt" | "done" | "failed";
  attempts: number;
  nextAttemptAt: number;
  expiresAt: number;
  ticketId?: string;
  leaseToken?: string;
  leaseUntil?: number;
  error?: string;
};
export type PushQueue = { jobs: PushJob[]; reminders: ReminderSchedule[] };
