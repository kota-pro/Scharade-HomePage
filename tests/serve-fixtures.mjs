import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "../src/lib/passwords.ts";
import { emptyMfaState } from "../src/lib/mfaState.ts";
import nodemailer from "nodemailer";
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
  INSTAGRAM_CLIENT_ID: "",
  INSTAGRAM_CLIENT_SECRET: "",
  EXHIBITION_GAS_URL: "", EXHIBITION_WEBHOOK_SECRET: "", EXHIBITION_DRIVE_GAS_URL: "", EXHIBITION_DRIVE_WEBHOOK_SECRET: "",
  ACCOUNTING_GAS_URL: "https://script.google.com/macros/s/fixture/exec",
  ACCOUNTING_WEBHOOK_SECRET: "fixture-accounting-secret-at-least-32-characters",
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
const accountFixtures = [
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
  const book=structuredClone(source);book.id=`f3000000-0000-4000-8000-00000000000${index+1}`;exhibitionFixtures.push(book);
  if(index===2)break;
}
// Independent seeds keep limits tests from changing other submission workflows.
for(let index=0;index<3;index++) {
  const e=structuredClone(exhibitionFixtures[index]);e.id=`f4000000-0000-4000-8000-00000000000${index+1}`;e.title=`提出上限確認 ${index+1}`;exhibitionFixtures.push(e);
}
fs.writeFileSync(path.join(dir, "exhibitions.json"), JSON.stringify({ version: 1, exhibitions: exhibitionFixtures, submissions: layoutSubmissions, assets: [], outputs: [] }));
const { drainExhibitionQueues } = await import("../src/lib/exhibitionIntegrations.ts");
const fixtureNoticeWorker = setInterval(() => { void drainExhibitionQueues("http://127.0.0.1:4329", 5); }, 200);
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
portfolios.push(...deletionAccounts.map(user => ({ ...portfolios[0], id: user.portfolioId, name: user.name })));
const deletionAttempts = new Set();
const blog = {
  id: "post",
  slug: "test-post",
  title: "撮影会のお知らせ",
  body: "<p>試験用の記事本文です。</p>",
  excerpt: "テスト記事",
  tags: ["撮影会"],
  publishedAt: now,
  updatedAt: now,
  pictures: [{ url: image, width: 640, height: 480 }],
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
];
const bytes = fs.readFileSync("public/media/site/activity/Photo1-480.webp");
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
    return Response.json({ url: "https://images.microcms-assets.io/assets/fixture/event-header.webp" });
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
        list = portfolios.filter((p) => p.name.includes(q));
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
        const post=blogs.find(post=>post.id===id);
        return Response.json(post || {}, {status: post ? 200 : 404});
      }
      const filter=url.searchParams.get("filters");
      const ids=url.searchParams.get("ids")?.split(",");
      const found=blogs.filter(post=>(!filter||filter===`slug[equals]${post.slug}`)&&(!ids||ids.includes(post.id)));
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
    if (url.pathname.includes("/renditions/"))
      return new Response(bytes, { headers: { "Content-Type": "image/webp" } });
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
await import("../dist/server/entry.mjs");
