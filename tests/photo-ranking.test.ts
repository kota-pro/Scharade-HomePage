import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { PhotoStore } from "../src/lib/photoState.ts";
import type { User } from "../src/lib/auth.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-photo-ranking-"));
Object.assign(process.env, { DATA_DIR: directory, NODE_ENV: "test", MICROCMS_SERVICE_DOMAIN: "fixture", MICROCMS_SERVER_API_KEY: "fixture", GALLERY_SIGNING_SECRET: "fixture-ranking-secret-at-least-32-characters", ADOBE_CLIENT_ID: "", ADOBE_CLIENT_SECRET: "", ADOBE_REFRESH_TOKEN: "" });
const { writeData, dataPath } = await import("../src/lib/store.ts");
const { invalidateCache } = await import("../src/lib/cache.ts");
const { cmsPhotoId } = await import("../src/lib/photoIdentity.ts");
const { getPhotoRanking, likedPhotoCandidates, orderPhotoRanking } = await import("../src/lib/photoRanking.ts");
const { GET } = await import("../src/pages/api/admin/photos.ts");
const admin = { id: "admin", approved: true, role: "admin" } as User, executive = { id: "executive", approved: true, role: "executive" } as User;
const portfolios = Array.from({ length: 25 }, (_, index) => ({ id: `p${index}`, name: `作者${index}`, pictures: [{ url: `https://images.microcms-assets.io/assets/fixture/rank-${index}.jpg`, width: 600, height: 900 }] }));
const post = { id: "post", slug: "ranking-blog", title: "記事", pictures: [portfolios[0].pictures[0], portfolios[20].pictures[0]], body: "", tags: [] };
let state: PhotoStore;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  invalidateCache(); fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory); writeData("users.json", []);
  state = { version: 1, sequence: 500, metadata: {}, likes: {}, readThrough: {} };
  for (const [index, portfolio] of portfolios.entries()) {
    const imageId = cmsPhotoId(portfolio.pictures[0].url), ref = { source: "portfolio" as const, containerId: portfolio.id, imageId };
    state.likes[`cms:${imageId}`] = Object.fromEntries(Array.from({ length: 25 - index }, (_, like) => [`private-visitor-${like}`, { active: true, at: "2026-11-01T00:00:00.000Z", sequence: like + 1, ref }]));
    state.metadata[`portfolio:${portfolio.id}:${imageId}`] = { title: `作品${index}`, caption: "概要", camera: "Z5" };
  }
  writeData("photo-interactions.json", state);
  globalThis.fetch = async target => {
    const url = new URL(String(target));
    if (url.hostname.endsWith("microcms.io") && url.pathname === "/api/v1/portfolio") return Response.json({ contents: portfolios, totalCount: portfolios.length });
    if (url.hostname.endsWith("microcms.io") && url.pathname.startsWith("/api/v1/portfolio/")) {
      const person = portfolios.find(person => url.pathname.endsWith(`/${person.id}`));
      return Response.json(person || {}, { status: person ? 200 : 404 });
    }
    if (url.hostname.endsWith("microcms.io") && url.pathname === "/api/v1/blog/post") return Response.json(post);
    throw new Error("Synthetic fixtures only");
  };
});
after(() => { globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); });

test("ranking counts active likes once, handles ties, paginates globally and never exposes visitor records or writes data", async () => {
  const key = `cms:${cmsPhotoId(portfolios[0].pictures[0].url)}`;
  state.likes[key]["private-visitor-0"].ref = { source: "blog", containerId: "post", imageId: cmsPhotoId(portfolios[0].pictures[0].url) };
  state.likes[key].cancelled = { ...state.likes[key]["private-visitor-0"], active: false };
  writeData("photo-interactions.json", state);
  assert.equal(likedPhotoCandidates(state).find(candidate => candidate.key === key)!.count, 25);
  const before = fs.readFileSync(dataPath("photo-interactions.json"));
  const first = await getPhotoRanking(admin), second = await getPhotoRanking(admin, "", 2);
  assert.deepEqual(first.summary, { totalLikes: 325, likedPhotos: 25, mostLikes: 25 });
  assert.equal(first.photos.length, 20); assert.equal(second.photos.length, 5); assert.equal(second.photos[0].rank, 21);
  assert.equal(first.photos[0].ref.source, "portfolio");
  assert.deepEqual(orderPhotoRanking(first.photos.slice(0, 3).map(photo => ({ ...photo, count: photo.rank < 3 ? 5 : 3 }))).map(photo => photo.rank), [1, 1, 3]);
  assert.equal(JSON.stringify(first).includes("private-visitor"), false); assert.equal(JSON.stringify(first).includes("ownerId"), false);
  assert.deepEqual(fs.readFileSync(dataPath("photo-interactions.json")), before);
});

test("scoped rankings include shared Blog images, exclude deleted references and enforce executive privileges", async () => {
  const blog = await getPhotoRanking(executive, "blog:post");
  assert.equal(blog.photos.length, 2); assert.deepEqual(blog.summary, { totalLikes: 30, likedPhotos: 2, mostLikes: 25 });
  assert.ok(blog.photos.every(photo => photo.href.startsWith("/posts/ranking-blog?photo=")));
  const ref = { source: "portfolio" as const, containerId: "missing", imageId: "missing" };
  state.sequence++; state.likes["cms:missing"] = { private: { ref, active: true, sequence: 1, at: "2026-11-01T00:00:00.000Z" } }; writeData("photo-interactions.json", state);
  const all = await getPhotoRanking(admin); assert.equal(all.unavailable, 1); assert.equal(all.summary.likedPhotos, 25);
  for (const user of [null, { id: "member", approved: true, role: "member" }, { id: "staff", approved: true, role: "staff" }, { ...executive, approved: false }]) {
    const response = await GET({ locals: { user }, url: new URL("https://scharade.jp/api/admin/photos") } as any); assert.equal(response.status, 403); assert.equal((await response.json()).photos, undefined);
  }
  const response = await GET({ locals: { user: admin }, url: new URL("https://scharade.jp/api/admin/photos?container=blog:post") } as any);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  for (const query of ["page=0", "page=bad", "container=invalid", "container=portfolio:a:b"]) assert.equal((await GET({ locals: { user: admin }, url: new URL(`https://scharade.jp/api/admin/photos?${query}`) } as any)).status, 400);
});

test("Gallery ranking validates current album membership and excludes other albums and drafts", async () => {
  const exhibitionId = crypto.randomUUID(), submissionId = crypto.randomUUID(), assetId = crypto.randomUUID();
  const content = { authorName: "出展者", works: [{ id: crypto.randomUUID(), title: "展示写真", caption: "写真の概要", photos: [{ assetId }] }] };
  const data = { version: 1, exhibitions: [{ id: exhibitionId, title: "写真展", albumId: "album", status: "closed", gallery: "staff", createdAt: "2026-11-01", updatedAt: "2026-11-01" }], submissions: [{ id: submissionId, exhibitionId, versions: [{ content }] }], assets: [{ id: assetId, exhibitionId, submissionId, lightroomId: "gallery-photo", name: "写真.jpg", width: 600, height: 900 }] };
  writeData("exhibitions.json", data);
  for (const [id, album] of [["gallery-photo", "album"], ["other-photo", "other-album"]]) state.likes[`lightroom:${id}`] = { private: { ref: { source: "gallery", containerId: album, imageId: id }, active: true, sequence: 1, at: "2026-11-01" } };
  writeData("photo-interactions.json", state);
  const result = await getPhotoRanking(executive, "gallery:album"); assert.equal(result.photos.length, 1); assert.equal(result.unavailable, 0); assert.equal(result.photos[0].title, "展示写真");
  assert.equal(result.photos[0].count, 1); assert.ok(result.photos[0].src.includes("proof="));
  data.exhibitions[0].status = "draft"; writeData("exhibitions.json", data); invalidateCache();
  await assert.rejects(getPhotoRanking(admin, "gallery:album"));
});
