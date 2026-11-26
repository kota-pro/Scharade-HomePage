import type { Role } from "./roles.ts";

export type ToolKind = "poll" | "schedule" | "box";
export const toolLabels: Record<ToolKind, string> = {
  poll: "投票",
  schedule: "日程調整",
  box: "目安箱",
};
export type ToolOption = {
  id: string;
  text: string;
  imageId?: string;
  date?: string;
  start?: string;
  end?: string;
  removed?: boolean;
};
export type ToolSettings = {
  endsAt: string;
  multiple: boolean;
  anonymous: boolean;
  allowOptions: boolean;
  publicQuestion: boolean;
  staffResults: boolean;
  staffIdentity: boolean;
};
export type ToolPublication = {
  audience: "recipients" | "staff" | "executive" | "admin" | "all" | "selected";
  memberIds: string[];
  start: "always" | "answered" | "closed" | "date";
  startsAt: string;
  endsAt: string;
  paused: boolean;
  boxMode: "selected" | "all";
  responseIds: string[];
};
export type ToolResponse = {
  id: string;
  userId: string;
  anonymous: boolean;
  choices: string[];
  dates: Record<string, "yes" | "maybe" | "no">;
  body: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};
export type ToolAsset = {
  id: string;
  ownerId: string;
  name: string;
  mime: string;
  bytes: number;
  createdAt: string;
  purpose: "option" | "response";
};
export type MemberTool = {
  version: 1;
  id: string;
  revision: number;
  answerRevision: number;
  kind: ToolKind;
  question: string;
  questionHtml?: string;
  creatorId: string;
  creatorRole: Role;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "published";
  closed: boolean;
  recipientIds: string[];
  options: ToolOption[];
  settings: ToolSettings;
  publication: ToolPublication;
  responses: ToolResponse[];
  assets: ToolAsset[];
  outbox?: {
    id: string;
    senderId: string;
    senderName: string;
    createdAt: string;
    recipientIds: string[];
    delivered?: boolean;
  };
};
export type ToolResultResponse = Omit<ToolResponse, "userId"> & {
  name: string;
};
export type ToolResults = {
  kind: ToolKind;
  question: string;
  options: ToolOption[];
  responses: ToolResultResponse[];
  respondentCount: number;
  recipientCount: number;
};
export const defaultToolSettings = (): ToolSettings => ({
  endsAt: "",
  multiple: false,
  anonymous: false,
  allowOptions: false,
  publicQuestion: false,
  staffResults: false,
  staffIdentity: false,
});
export const defaultToolPublication = (kind: ToolKind): ToolPublication => ({
  audience: "recipients",
  memberIds: [],
  start: "always",
  startsAt: "",
  endsAt: "",
  paused: kind === "box",
  boxMode: "selected",
  responseIds: [],
});
