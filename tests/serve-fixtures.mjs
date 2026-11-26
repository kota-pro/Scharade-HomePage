import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../src/lib/passwords.ts";
import { emptyMfaState } from "../src/lib/mfaState.ts";
import nodemailer from "nodemailer";
import sharp from "sharp";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-browser-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  HOST: "127.0.0.1",
  PORT: "4329",
  SITE_URL: "http://127.0.0.1:4329",
  TRUST_PROXY: "1",
  NODE_ENV: "test",
  MICROCMS_SERVICE_DOMAIN: "fixture",
  MICROCMS_SERVER_API_KEY: "test",
  ADOBE_CLIENT_ID: "test",
  ADOBE_CLIENT_SECRET: "test",
  ADOBE_REFRESH_TOKEN: "test",
  LIGHTROOM_CATALOG_ID: "fixture",
  GALLERY_SIGNING_SECRET: "fixture-gallery-signing-key-32-characters",
  MFA_ENCRYPTION_KEY: "ef".repeat(32),
  SIGNUP_REVIEW_SECRET: "fixture-review-secret-at-least-32-characters",
  GMAIL_PASS: "synthetic-no-network-mail",
  SITE_ERROR_REPORTS_ENABLED: process.env.BROWSER_ERROR_REPORTS === '1' ? '1' : '0',
  INSTAGRAM_CLIENT_ID: "",
  INSTAGRAM_CLIENT_SECRET: "",
  EXHIBITION_GAS_URL: "", EXHIBITION_WEBHOOK_SECRET: "", EXHIBITION_DRIVE_GAS_URL: "", EXHIBITION_DRIVE_WEBHOOK_SECRET: "",
  ACCOUNTING_ADMIN_GAS_URL: "https://script.google.com/macros/s/accounting-admin-fixture/exec",
  ACCOUNTING_ADMIN_WEBHOOK_SECRET: "accounting-admin-fixture-secret-32-characters",
  ACCOUNTING_GAS_URL: "https://script.google.com/macros/s/fixture/exec",
  ACCOUNTING_WEBHOOK_SECRET: "fixture-accounting-secret-at-least-32-characters",
  CLUB_FORMS_GAS_URL: "https://script.google.com/macros/s/club-fixture/exec",
  CLUB_FORMS_WEBHOOK_SECRET: "fixture-club-secret-at-least-32-characters",
});
const now = new Date().toISOString();
const passwordHash = hashPassword("fixture-password-123");
const users = [
  ["admin", "サイト管理テスト"],
  [
    "member",
    "長いログイン表示名でもスマートフォン上で折り返して表示できることを確認する会員",
  ],
  ["other", "別の会員"],
].map(([id, name]) => ({
  id,
  name,
  email: `${id}@example.invalid`,
  passwordHash,
  approved: true,
  role: id === "admin" ? "admin" : "member",
  portfolioId: id,
  providers: { credentials: true },
  createdAt: now,
}));
const deletionAccounts = ["chromium", "firefox", "webkit"].map(engine => ({
  id: `delete-${engine}`, name: `削除動作確認${engine}`, email: `delete-${engine}@example.invalid`,
  approved: true, role: "member", portfolioId: `delete-${engine}`, providers: { credentials: true },
  passwordHash, createdAt: now,
}));
const photoAccounts = ["chromium", "firefox", "webkit"].flatMap(engine => ["owner", "executive", "staff"].map(kind => ({ id: `photo-${kind}-${engine}`, name: `写真確認 ${kind} ${engine}`, email: `photo-${kind}-${engine}@example.invalid`, approved: true, role: kind === "owner" ? "member" : kind, portfolioId: `photo-${kind}-${engine}`, providers: { credentials: true }, passwordHash, createdAt: now })));
const accountFixtures = [
  ...photoAccounts,
  ...["chromium", "firefox", "webkit"].flatMap(engine => ["member", "staff", "admin", "popup", "decline", "expired", "activity"].map(kind => ({
    id: `session-${kind}-${engine}`, name: "ログイン維持の架空会員", email: `session-${kind}-${engine}@example.invalid`,
    approved: true, role: kind === "staff" || kind === "admin" ? kind : "member", portfolioId: "member", providers: { credentials: true }, passwordHash, createdAt: now,
  }))),
  ...["chromium", "firefox", "webkit"].map(engine => ({ id: `app-delete-${engine}`, name: `アプリ削除申請${engine}`, email: `app-delete-${engine}@example.invalid`, approved: false, role: "member", portfolioId: null, providers: { credentials: true }, passwordHash, createdAt: now })),
  ...["chromium", "firefox", "webkit"].map(engine => ({ id: `mfa-enroll-${engine}`, name: "二段階認証の架空会員", email: `mfa-enroll-${engine}@example.invalid`, approved: true, role: "staff", passwordHash, providers: { credentials: true }, createdAt: now })),
  { id: "site-manager", name: "サイト管理", email: "site-manager@example.invalid", approved: true, role: "admin", siteManagement: true, portfolioId: null, providers: { credentials: true }, passwordHash, createdAt: now },
  ...["planner", "activity-outsider", ...Array.from({ length: 8 }, (_, i) => `activity-${i}`)].map(id => ({
    id, name: id === "planner" ? "企画運営テスト" : `撮影会員 ${id}`, email: `${id}@example.invalid`,
    approved: true, role: id === "planner" ? "staff" : "member", providers: { credentials: true }, passwordHash, createdAt: now,
  })),
  ...deletionAccounts,
  ...users.map(user => user.id === "other" ? {
    ...user,
    portfolioName: "登録時の別の会員",
    approvalNotifiedAt: "2026-09-01T03:45:00.000Z",
    providers: { credentials: true, instagram: { id: "private-instagram-id", username: "fixture_member" } },
  } : user),
  ...Array.from({ length: 31 }, (_, index) => ({
    id: `pending-${index + 1}`,
    name: `申請中の会員${index + 1}`,
    email: `pending-${index + 1}@example.invalid`,
    portfolioName: `申請Portfolio${index + 1}`,
    approved: false,
    providers: { credentials: true },
    createdAt: "2026-09-01T00:00:00.000Z",
  })),
  { id: "legacy", name: "以前の会員", email: "legacy@example.invalid", approved: false },
];
fs.writeFileSync(path.join(dir, "users.json"), JSON.stringify(accountFixtures));
fs.writeFileSync(path.join(dir, "auth-security.json"), JSON.stringify(emptyMfaState()));
const mailbox = {};
nodemailer.createTransport = () => ({ sendMail: async message => {
  if (message.to === 'contact@scharade.jp' && String(message.subject).startsWith('【Scharade エラーレポート】')) {
    const file = path.join(dir, 'synthetic-error-reports.json');
    const errorReportMail = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    errorReportMail.push({ to: message.to, subject: message.subject, text: message.text });
    fs.writeFileSync(path.join(dir, 'synthetic-error-reports.json'), JSON.stringify(errorReportMail), { mode: 0o600 });
    return { accepted: [message.to] };
  }
  if (!String(message.to).endsWith("@example.invalid") || !(String(message.subject).includes("認証") || ["【写団シャレード】アカウント開設完了のお知らせ", "【Scharade】アカウント削除申請の確認コード", "【Scharade】アカウント削除が完了しました"].includes(message.subject))) throw new Error("Synthetic SMTP unavailable");
  mailbox[message.to] = message.text;
  fs.writeFileSync(path.join(dir, "synthetic-mail.json"), JSON.stringify(mailbox), { mode: 0o600 });
  return { accepted: [message.to] };
} });
const fixturePointer = path.resolve(".data/browser-fixture-path.json");
fs.mkdirSync(path.dirname(fixturePointer), { recursive: true, mode: 0o700 });
fs.writeFileSync(fixturePointer, JSON.stringify({ directory: dir }), { mode: 0o600 });
process.on("exit", () => fs.rmSync(fixturePointer, { force: true }));
fs.writeFileSync(
  path.join(dir, "adobe-auth.json"),
  JSON.stringify({
    accessToken: "fixture-token",
    refreshToken: "fixture-token",
    accessTokenExpiresAt: Date.now() + 86400000,
  }),
);
const exhibitionFixtures = ["chromium", "firefox", "webkit"].map((engine, index) => ({
  id: `f1000000-0000-4000-8000-00000000000${index + 1}`, title: `写真展入力テスト ${engine}`, revision: 1, status: "open", createdAt: now, updatedAt: now, year: 2026,
  opensAt: "2020-01-01T01:00:00.000Z", closesAt: "2030-01-01T00:00:00.000Z", gallery: "staff", albumId: crypto.randomUUID().replaceAll("-", ""), googleForms: [], rooms: [],
  schemas: [{ version: 1, captionLabel: "キャプション", sections: [{ id: crypto.randomUUID(), title: "通常展示", description: "" }], fields: [] }],
  participation: { state: "published", opensAt: "2019-12-01T00:00:00.000Z", closesAt: "2019-12-31T00:00:00.000Z", recipientIds: ["member", "other"], votes: { member: { value: "attending", at: now, actorId: "member" }, other: { value: "absent", at: now, actorId: "other" } } }, notices: [],
}));
const layoutSubmissions=[];
for(const [index,source] of exhibitionFixtures.entries()) {
  const e=structuredClone(source);e.id=`f2000000-0000-4000-8000-00000000000${index+1}`;e.title=`編集確認 ${index+1}`;
  const sectionId=e.schemas[0].sections[0].id,works=Array.from({length:3},(_,i)=>({id:crypto.randomUUID(),sectionId,kind:"single",title:["海辺の朝","街の光","森の記憶"][i],caption:"",location:"",equipment:"",settings:"",fields:{},photos:[{assetId:crypto.randomUUID(),x:0,y:0,width:350,height:500,rotation:0}]}));
  const content={name:"展示者",authorName:"展示者",grade:"1年",portfolioUrl:"",fields:{},sections:[{sectionId,singles:3,series:0,books:0,seriesPhotoCounts:[],fields:{}}],works};
  layoutSubmissions.push({id:crypto.randomUUID(),exhibitionId:e.id,userId:"member",tokenHash:"",createdAt:now,updatedAt:now,revision:1,schemaVersion:1,draft:content,versions:[{version:1,schemaVersion:1,at:now,content,delivery:"delivered",attempts:0,nextAttemptAt:0}],portfolioId:"member",qrConfirmed:true});
  e.rooms=[{id:crypto.randomUUID(),name:"展示室",vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],placements:[],openings:[],tables:[],books:[],annotations:[]}];exhibitionFixtures.push(e);
  const book=structuredClone(source);book.id=`f3000000-0000-4000-8000-00000000000${index+1}`;const qrOwner=`photo-owner-${["chromium","firefox","webkit"][index]}`;book.participation.recipientIds.push(qrOwner);book.participation.votes[qrOwner]={value:"attending",at:now,actorId:qrOwner};exhibitionFixtures.push(book);
  if(index===2)break;
}
// Independent seeds keep limits tests from changing other submission workflows.
for(let index=0;index<3;index++) {
  const e=structuredClone(exhibitionFixtures[index]);e.id=`f4000000-0000-4000-8000-00000000000${index+1}`;e.title=`提出上限確認 ${index+1}`;exhibitionFixtures.push(e);
}
fs.writeFileSync(path.join(dir, "exhibitions.json"), JSON.stringify({ version: 1, exhibitions: exhibitionFixtures, submissions: layoutSubmissions, assets: [], outputs: [] }));
const { drainExhibitionQueues } = await import("../src/lib/exhibitionIntegrations.ts");
const { drainShiftGeneration } = await import("../src/lib/exhibitionShiftJobs.ts");
const fixtureNoticeWorker = setInterval(() => {
  void drainExhibitionQueues("http://127.0.0.1:4329", 5);
  void drainShiftGeneration();
}, 200);
process.on("exit", () => clearInterval(fixtureNoticeWorker));
const image = "https://images.microcms-assets.io/assets/fixture/photo.jpg";
let portfolios = users.map((u) => ({
  id: u.id,
  name: u.name,
  createdAt: now,
  updatedAt: now,
  publishedAt: now,
  revisedAt: now,
  grade: "1st Grade",
  generation: 52,
  role: "",
  isExecutive: false,
  displayOrder: 1,
  icon: { url: image, width: 640, height: 480 },
  pictures: Array.from({ length: 35 }, (_, index) => {
    // Mixed aspect ratios, including the final portrait pair reported on mobile.
    const [width, height] = index < 33 ? [640, 480] : index === 33 ? [1045, 1565] : [854, 1280];
    return {
      url: index < 33 ? image : `https://images.microcms-assets.io/assets/fixture/portrait-${width}x${height}.jpg`,
      width,
      height,
    };
  }),
  self_introduction: "試験用のプロフィールです。",
  hashtags: u.id === "other" ? ["テスト", "landscape", "夜景"] : ["テスト"],
  camera: "Camera",
  instagram: u.id === "other" ? "fixture_member" : "",
  x_url: u.id === "other" ? "https://x.com/fixture_member" : "",
}));
if (process.env.ALUMNI_PORTFOLIO_FIXTURES === "1") portfolios.push(
  { ...portfolios[0], id: "wpfqu4-8h10", name: "保管された作品", grade: "4th Grade", isExecutive: true, role: "元幹部" },
  { ...portfolios[0], id: "alumni-fixture-og", name: "卒業生OG", grade: "OG", isExecutive: true, role: "元幹部" },
  { ...portfolios[0], id: "alumni-fixture-ob", name: "卒業生OB", grade: ["OB/OG"], isExecutive: true, role: "元幹部" },
);
portfolios.push(...deletionAccounts.map(user => ({ ...portfolios[0], id: user.portfolioId, name: user.name })));
portfolios.push(...photoAccounts.map(user => ({ ...portfolios[0], id: user.portfolioId, name: user.name, pictures: [1, 2].map(i => ({ url: `https://images.microcms-assets.io/assets/fixture/${user.id}-${i}.jpg`, width: i === 1 ? 1200 : 600, height: 800 })) })));
const photoState = { version: 1, sequence: 0, metadata: {}, likes: {}, readThrough: {} };
for (const user of photoAccounts.filter(user => user.role === "member")) {
  const url = `https://images.microcms-assets.io/assets/fixture/${user.id}-1.jpg`, id = crypto.createHash("sha256").update(url).digest("hex");
  photoState.metadata[`portfolio:${user.portfolioId}:${id}`] = { title: "憧憬", caption: "写真のキャプションです。\n入力された項目のみ表示します。", camera: "Nikon Z5", lens: "Minolta 55mm f1.7", fNumber: "16", shutterSpeed: "1/400", iso: "4000" };
}
fs.writeFileSync(path.join(dir, "photo-interactions.json"), JSON.stringify(photoState));
const exhibitionData = JSON.parse(fs.readFileSync(path.join(dir, "exhibitions.json"), "utf8"));
const galleryBytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#b5c5cc" } }).jpeg().toBuffer();
const secondSeriesBytes = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#d9a69b" } }).jpeg().toBuffer();
const gallerySmallCover = await sharp(galleryBytes).resize(320).jpeg().toBuffer();
const galleryStandardCover = await sharp(galleryBytes).resize(640).jpeg().toBuffer();
for (const [index, engine] of ["chromium", "firefox", "webkit"].entries()) {
  const id = `f5000000-0000-4000-8000-00000000000${index+1}`, albumId = `photo-exhibition-${engine}`, submissionId = crypto.randomUUID(), assetId = crypto.randomUUID(), sectionId = crypto.randomUUID();
  const exhibition = { ...structuredClone(exhibitionFixtures[index]), id, title: `公開写真展 ${engine}`, albumId, gallery: "public", status: "closed" };
  const work = { id: crypto.randomUUID(), sectionId, kind: "single", title: "展示写真", caption: "フォームから取得したキャプション", location: "", equipment: "", settings: "", fields: {}, photos: [{ assetId, x: 0, y: 0, width: 300, height: 200, rotation: 0 }] };
  const content = { name: "写真確認", authorName: "出展者", grade: "1年", portfolioUrl: "", fields: {}, sections: [{ sectionId, singles: 1, series: 0, books: 0, seriesPhotoCounts: [], fields: {} }], works: [work] };
  exhibitionData.exhibitions.push(exhibition);
  exhibitionData.submissions.push({ id: submissionId, exhibitionId: id, userId: `photo-owner-${engine}`, portfolioId: `photo-owner-${engine}`, tokenHash: "", createdAt: now, updatedAt: now, revision: 1, schemaVersion: 1, draft: content, versions: [{ version: 1, schemaVersion: 1, at: now, content, delivery: "delivered", attempts: 0, nextAttemptAt: 0 }] });
  exhibitionData.assets.push({ id: assetId, exhibitionId: id, submissionId, name: "展示写真.jpg", mimeType: "image/jpeg", bytes: galleryBytes.length, sha256: crypto.createHash("sha256").update(galleryBytes).digest("hex"), width: 1200, height: 800, createdAt: now, lightroomId: `exhibition-photo-${engine}`, photoMetadata: { camera: "Nikon Z5", iso: "400" } });
  fs.writeFileSync(path.join(dir, `exhibition-${assetId}.bin`), galleryBytes);
}
const seriesExhibitionId = "f5100000-0000-4000-8000-000000000001", seriesSubmissionId = crypto.randomUUID();
const seriesFrames = [
  { x: 0, y: 0, width: 300, height: 200, rotation: 0 },
  { x: 600, y: 40, width: 230, height: 180, rotation: 90 },
  { x: 700, y: 0, width: 300, height: 200, rotation: 0 },
  { x: 0, y: 0, width: 300, height: 200, rotation: 0 },
].map((frame, index) => {
  const assetId = crypto.randomUUID();
  const source = index === 1 ? secondSeriesBytes : galleryBytes;
  exhibitionData.assets.push({
    id: assetId, exhibitionId: seriesExhibitionId, submissionId: seriesSubmissionId, name: `組写真-${index + 1}.jpg`,
    mimeType: "image/jpeg", bytes: source.length, sha256: crypto.createHash("sha256").update(source).digest("hex"),
    width: 1200, height: 800, createdAt: now, lightroomId: `series-fixture-photo-${index + 1}`, uploaded: true, albumAdded: true,
    photoMetadata: { camera: "Nikon F3", film: "Ilford HP5 Plus", iso: "400" },
  });
  fs.writeFileSync(path.join(dir, `exhibition-${assetId}.bin`), source);
  return { ...frame, assetId };
});
const seriesWork = { id: crypto.randomUUID(), kind: "series", title: "光のあいだ", caption: "組写真の説明", photos: seriesFrames.slice(0, 3) };
const seriesContent = { name: "出展者", authorName: "出展者", grade: "1年", works: [seriesWork] };
exhibitionData.exhibitions.push({
  ...structuredClone(exhibitionFixtures[0]), id: seriesExhibitionId, title: "組写真の公開確認",
  albumId: "gallery-series-fixture", gallery: "staff", albumCreated: true, status: "closed", albumExcludedAssetIds: [seriesFrames[2].assetId],
});
exhibitionData.submissions.push({
  id: seriesSubmissionId, exhibitionId: seriesExhibitionId, revision: 2, draft: seriesContent, versions: [
    { version: 1, content: { ...seriesContent, works: [{ ...seriesWork, photos: [seriesFrames[3]] }] }, delivery: "delivered" },
    { version: 2, content: seriesContent, delivery: "delivered" },
  ],
});
for (const engine of ["chromium", "firefox", "webkit"]) {
  const id = crypto.randomUUID(), submissionId = crypto.randomUUID();
  const works = ["series", "book"].map(kind => {
    const photos = [0, 1].map(index => {
      const assetId = crypto.randomUUID(), name = `${kind}-${index + 1}.jpg`;
      exhibitionData.assets.push({ id: assetId, exhibitionId: id, submissionId, name, mimeType: "image/jpeg", bytes: galleryBytes.length,
        sha256: crypto.createHash("sha256").update(galleryBytes).digest("hex"), width: 1200, height: 800, createdAt: now,
        lightroomId: `${engine}-edit-${kind}-${index + 1}` });
      fs.writeFileSync(path.join(dir, `exhibition-${assetId}.bin`), galleryBytes);
      return { assetId, x: index * 340, y: 0, width: 300, height: 200, rotation: 0 };
    });
    return { id: crypto.randomUUID(), kind, title: kind === "series" ? "組写真の編集確認" : "ブックの編集確認", caption: "作品の説明", photos };
  });
  const content = { ...seriesContent, works };
  exhibitionData.exhibitions.push({ ...structuredClone(exhibitionFixtures[0]), id, title: `Gallery編集 ${engine}`, albumId: `gallery-works-${engine}`, gallery: "public", albumCreated: true, status: "closed" });
  exhibitionData.submissions.push({ id: submissionId, exhibitionId: id, userId: `photo-owner-${engine}`, draft: content, versions: [{ version: 1, content }] });
}
fs.writeFileSync(path.join(dir, "exhibitions.json"), JSON.stringify(exhibitionData));

const deletionAttempts = new Set();
const blog = {
  id: "post",
  slug: "test-post",
  title: "撮影会のお知らせ",
  body: `<p>試験用の記事本文です。</p><figure><img src="https://images.microcms-assets.io/assets/fixture/blog-body-photo.jpg" width="1200" height="800" alt="本文の写真" /></figure>`,
  excerpt: "テスト記事",
  tags: ["撮影会"],
  publishedAt: now,
  updatedAt: now,
  pictures: [{ url: "https://images.microcms-assets.io/assets/fixture/photo-owner-chromium-1.jpg", width: 1200, height: 800 }],
};
const blogs = [blog, ...[
  "暗室の使い方②　〜現像編〜",
  "暗室の使い方①　〜導入編〜",
  "ホームページを作成しました！",
  "撮影会 [春] #1? 100%",
  "literal%20text",
].map((slug, index) => ({
  ...blog, id: `post-japanese-${index}`, slug, title: slug,
  tags: index<2 ? ['暗室'] : index===2 ? ['お知らせ'] : index===3 ? ['All','その他'] : ['all'],
}))];
const blogStates = new Map(blogs.map(post => [post.id, { status: ["PUBLISH"], title: post.title }]));
for (const id of ["new", "media", "preview"]) {
  const title = `既存の編集中記事 ${id}`;
  blogs.push({ ...blog, id, title, slug: `legacy-${id}` });
  blogStates.set(id, { status: ["DRAFT"], title });
}
const blogMetadata = post => ({
  id: post.id, updatedAt: post.updatedAt, publishedAt: post.publishedAt ?? null,
  status: blogStates.get(post.id).status, draftKey: blogStates.get(post.id).status.includes("DRAFT") ? `draft-${post.id}` : null,
});
const updateTime = post => new Date(Math.max(Date.now(), Date.parse(post.updatedAt) + 1)).toISOString();
const lightroomProjects = new Map();
const lightroomAssets = new Map();
const failedMasterUploads = new Set();
const lightroomAccountId = "ab12".repeat(8);
const albums = [
  {
    id: "public-album",
    created: now,
    updated: now,
    payload: { name: "公開 撮影会" },
  },
  {
    id: "private-album",
    created: now,
    updated: now,
    payload: { name: "非公開 会員の撮影会" },
  },
  ...[1, 2, 3].map(offset => {
    const year = new Date(now).getUTCFullYear() - offset;
    return {
      id: `public-album-${year}`,
      created: `${year}-06-01T00:00:00.000Z`,
      updated: `${year}-06-01T00:00:00.000Z`,
      payload: { name: `公開 撮影会 ${year}` },
    };
  }),
  ...["chromium", "firefox", "webkit"].map(engine => ({
    id: `site-management-album-${engine}`, created: now, updated: now,
    payload: { name: `非公開 管理確認 ${engine}` },
  })),
];
const bytes = fs.readFileSync("public/media/site/activity/Photo1-480.webp");
const { clubGasHarness } = await import("./helpers/club-forms-gas.ts");
const clubHarness = clubGasHarness();
clubHarness.addSource("admission_browser_fixture_2027",11,["タイムスタンプ","名前","大学名","性別","学年","LINE名"],[[new Date(),"撮影会員 activity-1","テスト大学","女性","1年生","line1"]]);
clubHarness.addSource("continuation_browser_fixture_2027",22,["タイムスタンプ","名前","大学名","学年","継続しますか？","LINE名"],[[new Date(),"撮影会員 activity-0","テスト大学","2年生","はい","line0"],[new Date(),"撮影会員 activity-2","テスト大学","2年生","いいえ","line2"]]);
const { siteHarness } = await import("./helpers/accounting-site-harness.ts");
const accountingHarness = siteHarness();
let receiptSequence = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const method = options.method || "GET";
  if (url.hostname === "script.google.com") {
    if (url.pathname === "/macros/s/accounting-admin-fixture/exec") {
      return Response.json(accountingHarness.ctx.doPost({ postData: { contents: options.body } }));
    }
    if (url.pathname === "/macros/s/club-fixture/exec") {
      const payload = JSON.parse(JSON.parse(options.body).payload);
      // This fixture represents the owner restoring Google's upload folders between checks.
      if (payload.action === "forms.status") for (const id of payload.ids) {
        const state = clubHarness.ctx.clubState_(id);
        if (state.input?.eventName === "画像準備テスト") clubHarness.forms.get(state.formId).uploadReady = true;
      }
      const result = clubHarness.ctx.doPost({ postData: { contents: options.body } });
      if (result.ok && payload.action === "form.mutate" && payload.operation === "create" && payload.input.eventName === "画像準備テスト") {
        clubHarness.forms.get(result.form.formId).uploadReady = false;
        result.form = clubHarness.ctx.clubRemote_(payload.id, clubHarness.ctx.clubState_(payload.id), true);
      }
      return Response.json(result);
    }
    const envelope = JSON.parse(options.body);
    const expected = crypto.createHmac("sha256", process.env.ACCOUNTING_WEBHOOK_SECRET).update("v2\n"+envelope.timestamp+"\n"+envelope.nonce+"\n"+envelope.payload).digest("hex");
    if (expected !== envelope.signature) return Response.json({ok:false,code:"UNAUTHORIZED"});
    const payload = JSON.parse(envelope.payload);
    if (payload.action === "participants.read") {
      const headers = ["タイムスタンプ", "名前", "性別", "大学名", "学年", "LINE上でのお名前"];
      return Response.json({ok:true, spreadsheetId:payload.spreadsheetId, sheetId:payload.sheetId, title:"参加フォーム（架空）", sheetTitle:"フォームの回答 1", headers, columns:payload.columns || {name:1,gender:2,grade:4,lineName:5}, rows:[
        {row:2,name:"フォーム参加者A",gender:"女性",grade:"大学１年生",lineName:"form-a"},
        {row:3,name:"フォーム参加者B",gender:"女性",grade:"大学１年生",lineName:"form-b"},
        {row:4,name:"フォーム参加者C",gender:"男性",grade:"大学３年生",lineName:"form-c"}
      ]});
    }
    if (payload.action === "roster.read") {
      const next=payload.spreadsheetId==='next-roster-fixture-2027';
      const records=accountFixtures.filter(u=>u.id.startsWith("activity-")&&u.id!=="activity-outsider").map((u,i)=>({key:crypto.createHash("sha256").update((next?'next:':'')+u.id).digest("hex"),name:u.name,lineName:`line${i}`,university:"テスト大学",gender:i%4<2?"女":"男",grade:i%4<2?"1年生":"2年生",active:true}));
      return Response.json({ok:true,spreadsheetId:payload.spreadsheetId,sheetId:payload.sheetId,title:next?"2027年度テスト名簿":"2026年度後期テスト名簿",sheetTitle:"フォームの回答 1",records:next?records.slice(1):records});
    }
    if (payload.action === "receipt.prepare") return Response.json({ok:true,receiptId:payload.receiptId,driveFileId:`fixtureReceipt${++receiptSequence}`});
    if (payload.action === "receipt.upload") return Response.json({ok:true,receiptId:payload.receiptId,url:`https://drive.google.com/file/d/${payload.driveFileId}/view`});
    if (payload.item === "一時障害の試験") return Response.json({ok:false,code:"RETRY"});
    if (payload.websiteUserId !== "member" || !payload.accountEmail.endsWith("@example.invalid")) return Response.json({ok:false,code:"INVALID"});
    return Response.json({ok:true,requestId:payload.requestId});
  }
  if (url.hostname.endsWith(".microcms-management.io") && url.pathname === "/api/v1/media") {
    if (options.body?.get("file")?.size > 5_000_000) return Response.json({ message: "request body too large" }, { status: 400 });
    if (options.body?.get("file")?.type === "application/pdf") return Response.json({ url: "https://files.microcms-assets.io/assets/fixture/blog-file.pdf" });
    return Response.json({ url: "https://images.microcms-assets.io/assets/fixture/event-header.webp" });
  }
  if (url.hostname.endsWith(".microcms-management.io") && url.pathname === "/api/v2/media") {
    const available = [
      { url: "https://images.microcms-assets.io/assets/fixture/gallery-editor.jpg", width: 480, height: 320, alt: "撮影会の写真" },
      { url: "https://files.microcms-assets.io/assets/fixture/blog-file.pdf" },
    ];
    const filtered = available.filter(item => (!url.searchParams.get("fileName") || item.url.includes(url.searchParams.get("fileName"))) &&
      (url.searchParams.get("imageOnly") !== "true" || item.width));
    return Response.json({ media: filtered, totalCount: filtered.length, token: "fixture" });
  }
  if (url.hostname.endsWith(".microcms-management.io") && url.pathname === "/api/v1/apis/blog") {
    return Response.json({ apiFields: [
      { fieldId: "body", kind: "richEditorV2", richEditorV2ColorList: [{ value: "#884422", label: "茶色" }], richEditorV2FontSizeList: [{ value: "120%", label: "大きめ" }], customClassList: [{ className: "highlight", label: "強調" }] },
      { fieldId: "tags", kind: "select", selectItems: [{ value: "撮影会" }, { value: "Others" }, { value: "Member's" }] },
    ] });
  }
  if (url.hostname.endsWith(".microcms-management.io") && url.pathname.startsWith("/api/v1/contents/blog")) {
    const [, , , , , id, action] = url.pathname.split("/");
    if (!id) {
      const limit = Number(url.searchParams.get("limit") || 10);
      const offset = Number(url.searchParams.get("offset") || 0);
      return Response.json({ contents: blogs.slice(offset, offset + limit).map(blogMetadata), totalCount: blogs.length });
    }
    const post = blogs.find(post => post.id === id);
    if (!post) return Response.json({}, { status: 404 });
    if (action === "status" && method === "PATCH") {
      const next = JSON.parse(options.body).status;
      if (next[0] === "PUBLISH") post.publishedAt ??= updateTime(post);
      post.updatedAt = updateTime(post);
      blogStates.get(id).status = next;
      return Response.json({});
    }
    return Response.json(blogMetadata(post));
  }
  if (url.hostname.endsWith(".microcms-management.io") && url.pathname.startsWith("/api/v1/contents/portfolio")) {
    const id = url.pathname.split("/")[5];
    if (id) return Response.json({}, { status: portfolios.some(p => p.id === id) ? 200 : 404 });
    return Response.json({ contents: portfolios.map(p => ({ id: p.id })), totalCount: portfolios.length });
  }
  if (url.hostname.endsWith(".microcms.io")) {
    const endpoint = url.pathname.split("/")[3],
      id = url.pathname.split("/")[4];
    if (endpoint === "portfolio") {
      if (method === "POST" && !id) {
        const createdId = `signup-${crypto.randomUUID()}`;
        const body = JSON.parse(options.body);
        portfolios.push({ ...body, id: createdId });
        return Response.json({ id: createdId }, { status: 201 });
      }
      if (method === "DELETE") {
        if (!id?.startsWith("delete-")) throw new Error("Fixture deletion restricted to disposable accounts");
        if (!deletionAttempts.has(id)) { deletionAttempts.add(id); return Response.json({}, { status: 503 }); }
        if (!portfolios.some(p => p.id === id)) return Response.json({}, { status: 400 });
        portfolios = portfolios.filter(p => p.id !== id);
        return new Response("Accepted", { status: 202 });
      }
      if (method === "PATCH") {
        const p = portfolios.find((p) => p.id === id);
        if (!p) return Response.json({}, { status: 404 });
        const body = JSON.parse(options.body);
        Object.assign(p, body, {
          pictures: (body.pictures ?? p.pictures).map((pic) =>
            typeof pic === "string"
              ? { url: pic, width: 640, height: 480 }
              : pic,
          ),
          icon: body.icon === "" || body.icon === null ? null : p.icon,
        });
        return Response.json({ id });
      }
      if (id) {
        if (id === "photo-layout") {
          const sizes = [[1500, 1000], [1000, 1500], [1600, 900], [800, 1000], [1000, 1000], [3000, 1000]];
          return Response.json({ ...portfolios[0], id, name: "写真配置テスト", pictures: Array.from({ length: 105 }, (_, i) => {
            const [width, height] = sizes[i % sizes.length];
            const url = `https://images.microcms-assets.io/assets/fixture/mixed-${width}x${height}-${i}.jpg`;
            // Exercise load-based sizing with absent metadata and one failed image.
            return i === 100 ? { url } : { url, width, height };
          }) });
        }
        const p = portfolios.find((p) => p.id === id);
        return Response.json(p || {}, { status: p ? 200 : 404 });
      }
      const q = url.searchParams.get("q") || "",
        ids = url.searchParams.get("ids")?.split(","),
        list = portfolios.filter((p) => p.name.includes(q) && (!ids || ids.includes(p.id)));
      const offset = Number(url.searchParams.get("offset") || 0),
        limit = Number(url.searchParams.get("limit") || 10);
      return Response.json({
        contents: list.slice(offset, offset + limit),
        totalCount: list.length,
        offset,
        limit,
      });
    }
    if (endpoint === "blog") {
      if (id) {
        let post = blogs.find(post => post.id === id);
        if (method === "PUT" && url.searchParams.get("status") === "draft") {
          if (post) return Response.json({}, { status: 400 });
          post = { id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...JSON.parse(options.body) };
          post.pictures = (post.pictures ?? []).map(url => ({ url, width: 480, height: 320 }));
          blogs.push(post);
          blogStates.set(id, { status: ["DRAFT"] });
          return Response.json({ id }, { status: 201 });
        }
        if (!post) return Response.json({}, { status: 404 });
        if (method === "PATCH") {
          const changes = JSON.parse(options.body);
          if (changes.pictures) changes.pictures = changes.pictures.map(url => ({ url, width: 480, height: 320 }));
          const updatedAt = updateTime(post);
          Object.assign(post, changes, { updatedAt });
          return Response.json({ id });
        }
        if (method === "DELETE") {
          blogs.splice(blogs.indexOf(post), 1);
          blogStates.delete(id);
          return new Response(null, { status: 202 });
        }
        const visible = blogStates.get(id).status.includes("PUBLISH") || url.searchParams.get("draftKey") === `draft-${id}`;
        return Response.json(visible ? post : {}, { status: visible ? 200 : 404 });
      }
      const filter=url.searchParams.get("filters");
      const ids=url.searchParams.get("ids")?.split(",");
      const found=blogs.filter(post=>blogStates.get(post.id).status.includes("PUBLISH")&&(!filter||filter===`slug[equals]${post.slug}`)&&(!ids||ids.includes(post.id)));
      const offset=Number(url.searchParams.get("offset") || 0);
      const limit=Number(url.searchParams.get("limit") || 10);
      const fields=url.searchParams.get("fields")?.split(",");
      return Response.json({
        contents: found.slice(offset,offset+limit).map(post=>fields ? Object.fromEntries(fields.map(field=>[field,post[field]])) : post),
        totalCount: found.length,
        offset,
        limit,
      });
    }
    if (endpoint === "card_image")
      return Response.json({
        contents: [],
        totalCount: 0,
        limit: 100,
        offset: 0,
      });
  }
  if (url.hostname === "lr.adobe.io") {
    if (url.pathname === "/v2/account" && method === "GET") {
      return Response.json({ id: lightroomAccountId, type: "account" });
    }
    const match = /^\/v2\/catalogs\/fixture\/(albums|assets)\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
    if (match) {
      const [, resource, id, action] = match;
      if (resource === "assets" && /^[a-f0-9]{32}$/.test(id)) {
        const asset = lightroomAssets.get(id);
        if (!action && method === "PUT") {
          if (asset) return new Response('while(1){}' + JSON.stringify({ code: 1002, errors: { asset: ["already exists"] } }), {
            status: 403, headers: { "Content-Type": "application/json" },
          });
          const image = JSON.parse(options.body);
          if (image.payload?.captureDate !== "0000-00-00T00:00:00" ||
              image.payload?.importSource?.importedBy !== lightroomAccountId ||
              image.payload?.importSource?.importedOnDevice !== new Headers(options.headers).get("X-API-Key"))
            return new Response(null, { status: 400 });
          lightroomAssets.set(id, { id, ...image });
          return new Response(null, { status: 201 });
        }
        if (action === "master" && method === "PUT" && asset) {
          const headers = new Headers(options.headers);
          if (asset.uploaded || headers.has("Content-Range") || Number(headers.get("Content-Length")) !== options.body.byteLength)
            return new Response(null, { status: 400 });
          const name = asset.payload.importSource.fileName;
          if (name.startsWith("retry-") && !failedMasterUploads.has(id)) {
            failedMasterUploads.add(id);
            return new Response(null, { status: 503 });
          }
          asset.uploaded = true;
          asset.payload.importSource.fileSize = options.body.byteLength;
          if (name.startsWith("retry-")) return new Response(null, { status: 503 });
          return new Response(null, { status: 201 });
        }
        if (action?.startsWith("renditions/") && method === "GET") return asset?.uploaded
          ? new Response(bytes, { headers: { "Content-Type": "image/webp" } })
          : new Response(null, { status: 404 });
        if (!action) return Response.json(asset || {}, { status: asset ? 200 : 404 });
      }
      if (resource === "albums" && /^[a-f0-9]{32}$/.test(id)) {
        const project = lightroomProjects.get(id);
        if (method === "PUT" && !action) {
          if (project) return new Response(null, { status: 412 });
          lightroomProjects.set(id, { id, ...JSON.parse(options.body), members: new Set() });
          return new Response(null, { status: 201 });
        }
        if (method === "DELETE" && !action) return new Response(null, { status: lightroomProjects.delete(id) ? 204 : 404 });
        if (!project) return Response.json({}, { status: 404 });
        if (action === "assets" && method === "PUT") {
          const { resources } = JSON.parse(options.body);
          if (resources.some(entry => !lightroomAssets.get(entry.id)?.uploaded)) return new Response(null, { status: 400 });
          resources.forEach(entry => project.members.add(entry.id));
          return new Response(null, { status: 204 });
        }
        if (action === "assets") return Response.json({
          resources: [...project.members].map(id => ({ asset: url.searchParams.get("embed") === "asset" ? lightroomAssets.get(id) : { id } })),
        });
        return Response.json(project);
      }
    }
    if (url.pathname.endsWith("/renditions/thumbnail2x")) {
      if (match?.[2] === "photo-1") return new Response(null, { status: 404 });
      return new Response(gallerySmallCover, { headers: { "Content-Type": "image/jpeg" } });
    }
    if (url.pathname.endsWith("/renditions/640")) return new Response(galleryStandardCover, { headers: { "Content-Type": "image/jpeg" } });
    if (url.pathname.includes("/renditions/")) return new Response(bytes, { headers: { "Content-Type": "image/webp" } });
    if (url.pathname.endsWith("/assets")) {
      const offset = Number(url.searchParams.get("offset") || 0),
        limit = Number(url.searchParams.get("limit") || 30),
        count = url.pathname.includes("public-album") ? 135 : 35;
      const resources = Array.from(
        { length: Math.min(limit, count - offset) },
        (_, i) => ({
          asset: { id: `photo-${offset + i}` },
          payload: { importSource: { fileName: `写真 ${offset + i + 1}` } },
        }),
      );
      return Response.json({
        resources,
        base: url.origin + url.pathname,
        links:
          offset + limit < count
            ? {
                next: {
                  href: `${url.pathname}?offset=${offset + limit}&limit=30`,
                },
              }
            : {},
      });
    }
    if (url.pathname.endsWith("/albums"))
      return Response.json({
        resources:
          url.searchParams.get("subtype") === "collection_set" ? [] : albums,
      });
    const album = albums.find((a) => url.pathname.endsWith("/" + a.id));
    if (album) return Response.json(album);
  }
  throw new Error("External network blocked by fixture server: " + url.origin);
};
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const { drainClubFormOperations, refreshClubFormStatuses } = await import("../src/lib/clubForms.ts");
const { drainRosterExports } = await import("../src/lib/rosterExports.ts");
const { drainAccountingRoster } = await import("../src/lib/accountingRoster.ts");
let clubTickRunning = false;
const fixtureClubWorker = setInterval(async () => {
  if (clubTickRunning) return;
  clubTickRunning = true;
  try { await drainAccountingRoster(); await drainClubFormOperations(3); await drainRosterExports(3); await refreshClubFormStatuses(); }
  finally { clubTickRunning = false; }
}, 300);
process.on("exit", () => clearInterval(fixtureClubWorker));
if (process.env.BROWSER_FIXTURE_MODE === "dev") {
  const { dev } = await import("astro");
  await dev({ server: { host: "127.0.0.1", port: 4329 }, devToolbar: { enabled: false } });
} else {
  const fixtureBuild = process.env.BROWSER_FIXTURE_BUILD;
  await import(fixtureBuild ? pathToFileURL(path.resolve(fixtureBuild, "server/entry.mjs")).href : "../dist/server/entry.mjs");
}
