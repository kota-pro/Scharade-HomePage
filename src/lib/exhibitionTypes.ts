export type WorkKind = "single" | "series" | "book";
export const workKindLabels: Record<WorkKind, string> = { single: "単写真", series: "組写真", book: "ブック" };
export type FieldValue = string | number | boolean | string[];
export type FormField = {
  id: string; label: string; description: string;
  type: "text" | "paragraph" | "number" | "select" | "checkbox" | "date";
  scope: "common" | "section" | "work"; required: boolean; options: string[];
  sectionId?: string; kinds?: WorkKind[];
};
export type SectionLimits = { maxWorks?: number; frameSizeIds?: string[]; maxLongEdgeMm?: number; maxShortEdgeMm?: number };
export type EffectiveSubmissionLimits = { maxWorks?: number; sections: Record<string, SectionLimits & { title: string }> };
export type LimitIssue = { code: 'total-count' | 'section-count' | 'size'; message: string; sectionId?: string; workId?: string };
export type FormSchema = {
  version: number; sections: { id: string; title: string; description: string; descriptionHtml?: string; limits?: SectionLimits }[];
  limits?: { maxWorks?: number };
  fields: FormField[]; captionLabel: string;
};
export type PhotoLayout = { assetId: string; x: number; y: number; width: number; height: number; rotation: number; metadata?: import('../types/photos.ts').PhotoMetadata };
export type WorkDetails = { place:string; prefecture:string; region:string; camera:string; lens:string; film:string; shutterSpeed:string; iso:string; fNumber:string };
/** Indices count Unicode code points. base guards against applying a reading to changed text. */
export type TitleRuby = { start:number; end:number; base:string; reading:string; group?:true };
export type TitleBoardSettings = { quoted:boolean; rubyEnabled:boolean; ruby:TitleRuby[]; noPhotography?:boolean };
export type Work = {
  id: string; sectionId: string; kind: WorkKind; title: string; caption: string;
  location: string; equipment: string; settings: string; photos: PhotoLayout[];
  fields: Record<string, FieldValue>;
  details?: WorkDetails;
  titleBoard?: TitleBoardSettings;
};
export type SectionAnswer = {
  sectionId: string; singles: number; series: number; books: number;
  seriesPhotoCounts: number[]; fields: Record<string, FieldValue>;
};
export type SubmissionContent = {
  notes?: string;
  name: string; grade: string; authorName: string; portfolioUrl: string;
  fields: Record<string, FieldValue>; sections: SectionAnswer[]; works: Work[];
};
export type SubmissionVersion = {
  version: number; schemaVersion: number; at: string; content: SubmissionContent;
  editedBy?: string; source?: "staff";
  delivery: "pending" | "delivered"; attempts: number; nextAttemptAt: number;
  leaseUntil?: number; leaseToken?: string; error?: string; deliveredAt?: string;
};
export type Submission = {
  id: string; exhibitionId: string; tokenHash: string; createdAt: string; updatedAt: string;
  revision: number; schemaVersion: number; draft: SubmissionContent; versions: SubmissionVersion[];
  portfolioId?: string; qrConfirmed?: boolean; qrSource?: "account" | "external";
  userId?: string; inactive?: boolean;
  sheetSource?: { spreadsheetId: string; sheetName: string; rowKey: string };
};
export type ExhibitionAsset = {
  photoMetadata?: import('../types/photos.ts').PhotoMetadata;
  id: string; exhibitionId: string; submissionId: string; name: string;
  mimeType: "image/jpeg" | "image/png"; bytes: number; sha256: string;
  width: number; height: number; createdAt: string;
  lightroomId: string; uploaded?: boolean; albumAdded?: boolean;
  drive?: DriveDelivery;
};
export type DriveDelivery = { fileId?: string; url?: string; status: "pending" | "delivered"; attempts: number; nextAttemptAt: number; error?: string; sessionUrl?: string; offset?: number; leaseUntil?: number; leaseToken?: string };
export type ExhibitionParticipation = {
  state: "draft" | "publishing" | "published";
  opensAt: string; closesAt: string; recipientIds: string[];
  votes: Record<string, { value: "attending" | "absent" | "undecided"; at: string; actorId: string }>;
  publishedAt?: string; noticeId?: string;
};
export type ExhibitionNotice = {
  kind?: import("./activityTypes.ts").MemberNotification["kind"];
  id: string; exhibitionId: string; senderId: string; senderName: string;
  title: string; body: string; bodyHtml?: string; recipientIds: string[]; createdAt: string;
  deliveredAt?: string; error?: string;
};
export type ExhibitionOutput = {
  id: string; exhibitionId: string; kind: string; roomId?: string; name: string; mimeType: string;
  bytes: number; sha256: string; createdAt: string; drive: DriveDelivery; sourceKey?: string;
};
export type VectorPoint = { x: number; y: number };
/** Handles are offsets from the node, so moving an anchor preserves its tangents. */
export type VectorNode = VectorPoint & { id?: string; in?: VectorPoint; out?: VectorPoint; arc?:{radius:number;sweep:boolean;large:boolean}; mode?: "corner" | "smooth" | "symmetric"; radius?: number; cornerHeight?: number };
export type VectorPath = { nodes: VectorNode[]; closed: boolean };
export type RichTextRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string };
export type DimensionAnchor = { kind: "free"; x: number; y: number } | { kind: "vertex"; nodeId: string } | { kind: "object"; objectId: string; u: number; v: number; feature?:{key:string;edge:number;ratio:number} } | { kind: "wall"; wallId: string; ratio: number } | {kind:"surface";u:number;v:number} | {kind:"panel";panelId:string;u:number;v:number};
export type LayoutDimension = { id: string; surface: string; surfaceWallId?: string; a: DimensionAnchor; b: DimensionAnchor; wallId?: string; offset: number; color: string };
export type Opening = { id: string; name?: string; wall: number; wallId?: string; kind: "door" | "window"; offset: number; width: number; bottom: number; height: number; color?: string; swingAngle?: number; hingeSide?: "start" | "end"; swingSide?: "inward" | "outward"; visualPath?:VectorPath };
export type Placement = { workId: string; wall: number; wallId?: string; x: number; bottom: number; rotation: number };
export type BookPlacement = { workId: string; tableId: string; x: number; y: number; width: number; depth: number; rotation: number };
export type RoomAnnotation = { id: string; name?: string; showName?: boolean; kind: "power" | "door" | "window" | "image" | "text" | "rect" | "ellipse" | "path" | "freehand"; x: number; y: number; width: number; height: number; rotation: number; text: string; fontSize: number; nameFontSize?: number; noteFontSize?: number; color?: string; surface?: string; surfaceWallId?: string; path?: VectorPath; runs?: RichTextRun[]; textScaleX?: number; textScaleY?: number; flipX?: boolean; flipY?: boolean; strokeWidth?: number; opacity?: number; fill?: string; assetId?:string };
export type WallAttachment = { wallId:string; offset:number; distance:number; bottom?:number };
export type BoardPanel = { id:string; name:string; width:number; height:number; thickness:number; hingeAngle:number; color?:string };
export type BoardGroup = { id:string; name:string; x:number; y:number; rotation:number; panels:BoardPanel[]; attachment?:WallAttachment };
export type BoardPlacement = { workId:string; groupId:string; face:"A"|"B"; x:number; bottom:number; rotation:number };
export type TitleBoardPlacement = { id: string; workId: string; surface: string; wallId?: string; x: number; bottom: number; rotation: number };
export type LayoutEditorGroup = { id: string; name: string; objectIds: string[] };
export type LayoutEditorMetadata = { order: string[]; hidden: string[]; locked: string[]; groups: LayoutEditorGroup[] };
export type LayoutLabelPosition = { id:string; surface:string; target:string; dx:number; dy:number };
export type LayoutWork = Work & { exhibitorName?: string; submissionName?: string; lineName?: string; listTag?: import('./exhibitionWorkList.ts').WorkListColor; titleBoardImage?: string };
export type RoomLayout = {
  id: string; name: string; vertices: VectorNode[]; wallHeights: number[];
  openings: Opening[]; placements: Placement[];
  tables: { id: string; name: string; x: number; y: number; width: number; depth: number; rotation: number; height?:number; attachment?:WallAttachment }[];
  books: BookPlacement[];
  annotations?: RoomAnnotation[]; showExhibitorNames?: boolean; showWorkTitles?: boolean;
  boardGroups?: BoardGroup[]; boardPlacements?: BoardPlacement[];
  titleBoards?: TitleBoardPlacement[]; editor?: LayoutEditorMetadata;
  geometryVersion?: 2; wallIds?: string[]; wallNames?: Record<string,string>; dimensions?: LayoutDimension[];
  labelPositions?: LayoutLabelPosition[];
};
export type LayoutImageAsset = Omit<ExhibitionAsset,"submissionId"|"lightroomId"|"uploaded"|"albumAdded"> & { actorId:string };
export type LayoutVersion = { id:string; revision:number; at:string|null; actorId?:string; actorName:string; kind:"baseline"|"edit"|"restore"; restoredFrom?:string; rooms:RoomLayout[] };
export type LayoutVersionInfo = Omit<LayoutVersion,"rooms"> & { roomCount:number; workCount:number };
export type LayoutChange = { roomId:string; collection:"room"|"geometry"|"name"|"showExhibitorNames"|"showWorkTitles"|"openings"|"placements"|"tables"|"books"|"annotations"|"boardGroups"|"boardPlacements"|"titleBoards"|"dimensions"|"labelPositions"|"order"|"hidden"|"locked"|"groups"; id?:string; before:unknown; after:unknown };
export type RoomTemplate = { id: string; name: string; revision: number; updatedAt: string; room: RoomLayout };
export type GoogleFormVersion = { schemaVersion: number; formId: string; spreadsheetId: string; itemIds: Record<string, number>; connectionId?: "legacy" | "exhibition-drive" };
export type IntegrationSync = { pending: boolean; nextAttemptAt: number; error?: string; leaseUntil?: number; leaseToken?: string };
export type ExhibitionDeletion = {
  id: string; title: string; actorId: string; createdAt: string; backupDir: string;
  status: "pending" | "complete"; nextAttemptAt: number; attempts: number; notBefore: number;
  googleForms: GoogleFormVersion[]; folderId?: string; fileIds: string[]; uploadKeys: string[];
  albumId: string; albumCreated: boolean; assetIds: string[]; outputIds: string[]; layoutAssetIds?:string[];
  googleDone?: boolean; lightroomDone?: boolean; localDone?: boolean; noticeDone?: boolean;
  error?: string; leaseUntil?: number; leaseToken?: string;
};
export type Exhibition = {
  openingSchedule?: import("./exhibitionShiftTypes.ts").ExhibitionOpeningSchedule;
  reminderConfiguredAt?: { vote?: string; submission?: string };
  id: string; title: string; revision: number; status: "draft" | "open" | "closed";
  opensAt: string; closesAt: string; createdAt: string; updatedAt: string;
  schemas: FormSchema[]; rooms: RoomLayout[];
  workListTags?: Record<string, import('./exhibitionWorkList.ts').WorkListColor>;
  boardDesigns?: Record<string, import('./exhibitionBoardDesign.ts').BoardDesign>;
  albumId: string; albumCreated?: boolean; gallery: "staff" | "members" | "public";
  albumExcludedAssetIds?: string[];
  googleForms: GoogleFormVersion[]; spreadsheetId?: string;
  year?: number; participation?: ExhibitionParticipation;
  driveFolders?: { folderId: string; originalsId: string; layoutsId: string; outputsId: string; year: number; title: string; yearFolderName?: string };
  notices?: ExhibitionNotice[];
  googleSync?: IntegrationSync; albumSync?: IntegrationSync;
  layoutProtocol?:1; layoutRevision?:number; layoutCurrent?:Omit<LayoutVersion,"rooms">; layoutHistory?:LayoutVersion[];
  layoutReceipts?:{id:string;actorId:string;revision:number;at:string}[];
};
export type ExhibitionStore = { version: 1; exhibitions: Exhibition[]; submissions: Submission[]; assets: ExhibitionAsset[]; layoutAssets?:LayoutImageAsset[]; outputs?: ExhibitionOutput[]; deletions?: ExhibitionDeletion[] };
export function emptySubmission(): SubmissionContent {
  return { name: "", grade: "", authorName: "", portfolioUrl: "", fields: {}, sections: [], works: [] };
}
export function latestContent(submission: Submission) { return submission.versions.at(-1)?.content; }
export function currentSchema(exhibition: Exhibition) { return exhibition.schemas.at(-1)!; }
export function isAcceptingSubmissions(exhibition: Exhibition, now = Date.now()) {
  return exhibition.status === "open" && (!exhibition.opensAt || Date.parse(exhibition.opensAt) <= now);
}
