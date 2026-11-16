export const genderLabels = {
  male: "男性",
  female: "女性",
  other: "その他",
  undisclosed: "回答しない",
} as const;
export const gradeLabels = {
  "1": "1年生",
  "2": "2年生",
  "3": "3年生",
  "4": "4年生",
  "5": "5年生",
  "6": "6年生",
  master: "修士",
  doctorate: "博士",
  alumni: "OB・OG",
  other: "その他",
} as const;
export const voteLabels = {
  attending: "参加",
  absent: "不参加",
  undecided: "未定",
  unanswered: "未回答",
} as const;
export type Gender = keyof typeof genderLabels;
export type Grade = keyof typeof gradeLabels;
export type Vote = Exclude<keyof typeof voteLabels, "unanswered">;
export type Profile = {
  gender: Gender;
  grade: Grade;
  revision: number;
  rosterKey?: string;
};
export type RosterRecord = {
  key: string;
  sourceKey?: string;
  withdrawnAt?: string;
  lineName?: string;
  name: string;
  university: string;
  gender: Gender | null;
  grade: Grade | null;
  active: boolean;
  identityHash?: string;
  provenance?: import("./clubFormsTypes.ts").RosterProvenance[];
  needsReview?: string[];
  identityUncertain?: boolean;
  membershipUncertain?: boolean;
  departureReason?: "missing" | "declined";
};
export type ActivityRoster = {
  revision: number;
  spreadsheetId: string;
  sheetId: number;
  title: string;
  sheetTitle: string;
  fetchedAt: string;
  fetchedBy: string;
  records: RosterRecord[];
  bindings: Record<string, string>;
  retiredRecords?: RosterRecord[];
  managedSource?: boolean;
  term?: import("./clubFormsTypes.ts").TermRosterSource;
  mergedSpreadsheetUrl?: string;
};
export type RosterPortfolioUpdate = {
  id: string;
  userId: string;
  portfolioId: string;
  rosterKey: string;
  name: string;
  status: "pending" | "done" | "error" | "cancelled";
  attempts: number;
  createdAt: string;
  updatedAt: string;
  previousGrade?: unknown;
  /** Absent on legacy departure jobs, whose target remains OB/OG. */
  targetGrade?: string;
  rosterFetchedAt?: string;
  initialOnly?: true;
  message?: string;
};
export type Participant = {
  id: string;
  lineName?: string;
  name: string;
  gender: Gender;
  grade: Grade;
};
export type GroupRules = {
  count: number;
  min: number;
  max: number;
  leaders: string[];
  together: string[][];
  apart: string[][];
};
export type Group = { leaderId: string; memberIds: string[] };
export type GroupPlan = {
  groups: Group[];
  source: string;
  savedAt: string;
  savedBy: string;
};
export type PublishedGroups = GroupPlan & {
  people?: Participant[];
  rules?: GroupRules;
  previousGroups?: Group[];
  names: Record<string, string>;
  publishedAt: string;
  version: number;
};
export const eventCategoryLabels = { photo: "撮影会", meeting: "定例会", other: "その他イベント" } as const;
export type EventCategory = keyof typeof eventCategoryLabels;
export type ActivityEvent = {
  id: string;
  revision: number;
  status: "draft" | "published" | "cancelled";
  title: string;
  category?: EventCategory;
  description: string;
  descriptionHtml?: string;
  headerImage?: string;
  startsAt: string;
  endsAt: string;
  meeting: string;
  itinerary: string;
  itineraryHtml?: string;
  fee: string;
  deadline: string;
  theme: string;
  ownerId: string;
  ownerName: string;
  recipientIds: string[];
  createdAt: string;
  updatedAt: string;
  votes: Record<string, { value: Vote; at: string; actorId: string }>;
  rules: GroupRules;
  draftGroups?: GroupPlan;
  publishedGroups?: PublishedGroups;
  groupHistory: PublishedGroups[];
};
export type MemberNotification = {
  id: string;
  revision?: number;
  updatedAt?: string;
  title: string;
  body: string;
  bodyHtml?: string;
  senderId: string;
  senderName: string;
  eventId?: string;
  exhibitionId?: string;
  toolId?: string;
  createdAt: string;
  recipientIds: string[];
  readBy: Record<string, string>;
  kind?: "announcement" | "event" | "cancellation" | "exhibition" | "exhibition-shift" | "reminder";
  reminder?: import("./pushTypes.ts").ReminderSchedule;
};
export type ActivityStore = {
  version: 1;
  profiles: Record<string, Profile>;
  events: ActivityEvent[];
  notifications: MemberNotification[];
  deletedNotificationIds?: string[];
  push?: import("./pushTypes.ts").PushQueue;
  roster?: ActivityRoster;
  rosterPortfolioUpdates?: RosterPortfolioUpdate[];
  rosterChangeId?: string;
  rosterExports?: import("./clubFormsTypes.ts").RosterExport[];
  eventGroupingHistory?: Pick<
    ActivityEvent,
    "id" | "title" | "startsAt" | "endsAt" | "publishedGroups"
  >[];
};
export const defaultRules = (): GroupRules => ({
  count: 1,
  min: 4,
  max: 8,
  leaders: [],
  together: [],
  apart: [],
});
export const emptyActivities = (): ActivityStore => ({
  version: 1,
  profiles: {},
  events: [],
  notifications: [],
});
export function activityDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}
export function localDateTime(value?: string) {
  return value
    ? new Date(Date.parse(value) + 9 * 3600_000).toISOString().slice(0, 16)
    : "";
}
