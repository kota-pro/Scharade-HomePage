import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectHomePhotos, selectHomePhotos, getHomePhotoCatalog, parseHomePhotoExclusions } from "../src/lib/homePhotos.ts";
import { cmsPhotoId } from "../src/lib/photoIdentity.ts";
import { microcmsClient, type Portfolio } from "../src/lib/microcms.ts";
import { changeContent, contentDocument, getContent, validateContent, ContentConflict } from "../src/lib/siteContent.ts";
import { writeData } from "../src/lib/store.ts";
import { siteDefaults } from "../src/data/siteDefaults.ts";
import { GET } from "../src/pages/api/admin/home-photos.ts";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-home-photos-"));
before(() => { process.env.DATA_DIR = directory; });
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const picture = (id: string) => ({ url: `https://images.microcms-assets.io/assets/test/${id}.jpg`, width: 1200, height: 800 });
const portfolio = (id: string, count = 1) => ({ id, name: `会員${id}`, icon: picture("icon"), pictures: Array.from({ length: count }, (_, i) => picture(`${id}-${i}`)) }) as Portfolio;

test("Home uses only publicly listed Portfolio photos, excludes management and deduplicates image variants", () => {
  const first = portfolio("a", 2), duplicate = portfolio("b");
  duplicate.pictures = [{ ...first.pictures[0], url: `${first.pictures[0].url}?w=100#preview` }];
  const noIcon = { ...portfolio("no-icon"), icon: undefined };
  const unsafe = portfolio("unsafe"); unsafe.pictures[0].url = "https://outside.invalid/image.jpg";
  const photos = collectHomePhotos([first, duplicate, noIcon, unsafe, portfolio("w_rozcjvv"), portfolio("empty", 0)]);
  assert.equal(photos.length, 2);
  assert.deepEqual(photos.map(photo => photo.portfolioId), ["a", "a"]);
  assert.equal(photos[0].id, cmsPhotoId(duplicate.pictures[0].url));
  assert.deepEqual(selectHomePhotos(photos, [photos[0].id]).map(p => p.id), [photos[1].id]);
  assert.deepEqual(selectHomePhotos(photos, photos.map(p => p.id)), []);
});

test("Home samples at most 20 without replacement, never changes cached candidates, and resamples requests", () => {
  const photos = collectHomePhotos([portfolio("many", 50)]), before = structuredClone(photos);
  const first = selectHomePhotos(photos, [], () => 0), last = selectHomePhotos(photos, [], () => .99999);
  assert.equal(first.length, 20); assert.equal(new Set(first.map(p => p.id)).size, 20);
  assert.notDeepEqual(first.map(p => p.id), last.map(p => p.id));
  assert.deepEqual(photos, before);
  assert.equal(selectHomePhotos(photos.slice(0, 1), []).length, 1);
  assert.deepEqual(selectHomePhotos([], []), []);
});

test("Home and the exclusion catalog accept only landscape images with valid known dimensions", () => {
  const member = portfolio("orientations");
  member.pictures = [
    [1200, 800], [800, 1200], [800, 800], [undefined, undefined],
    [1200, undefined], [undefined, 800], [1200, 0], [1200, -1],
    [NaN, 800], [Infinity, 800], [1200, Infinity], ["1200", 800], [1200, "800"],
    [801, 800],
  ].map(([width, height], index) => ({ ...picture(`orientation-${index}`), width, height })) as Portfolio["pictures"];
  const photos = collectHomePhotos([member]);
  assert.deepEqual(photos.map(photo => photo.position), [1, 14]);
  assert.ok(photos.every(photo => photo.width > photo.height));
  assert.deepEqual(selectHomePhotos(photos, [photos[0].id]).map(photo => photo.id), [photos[1].id]);
  assert.deepEqual(collectHomePhotos([{ ...member, pictures: member.pictures.slice(1, 13) }]), []);
});

test("catalog fetches all CMS pages and the administrator API rejects other roles without reading CMS", async () => {
  const original = microcmsClient.getList;
  const offsets: number[] = [];
  microcmsClient.getList = (async (options: any) => {
    const offset = options.queries.offset; offsets.push(offset);
    return { contents: Array.from({ length: offset ? 3 : 100 }, (_, i) => portfolio(`person${offset + i}`)), totalCount: 103 };
  }) as typeof microcmsClient.getList;
  try {
    for (const role of [undefined, "member", "staff", "executive"]) {
      const response = await GET({ locals: { user: role ? { approved: true, role } : null } } as any);
      assert.equal(response.status, 403);
    }
    assert.equal(offsets.length, 0);
    assert.equal((await getHomePhotoCatalog()).length, 103);
    assert.deepEqual(offsets, [0, 100]);
    const response = await GET({ locals: { user: { role: "admin", approved: true } } } as any);
    assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal((await response.json()).photos.length, 103);
    microcmsClient.getList = async () => { throw new Error("CMS unavailable"); };
    assert.equal((await GET({ locals: { user: { role: "admin", approved: true } } } as any)).status, 503);
  } finally { microcmsClient.getList = original; }
});

test("existing Home content and restore points gain an empty exclusion list without losing text", async () => {
  const { excludedPhotoIds, ...legacy } = structuredClone(siteDefaults.home);
  legacy.slogan = "以前からのキャッチコピー";
  writeData("site-content.json", { schemaVersion: 1, pages: { home: {
    revision: 7, draft: legacy, published: legacy, previous: { ...legacy, slogan: "旧版" }, updatedAt: null, publishedAt: null,
  } } });
  assert.equal(getContent("home").slogan, legacy.slogan);
  assert.deepEqual(getContent("home").excludedPhotoIds, []);
  assert.deepEqual(contentDocument("home").previous?.excludedPhotoIds, []);
  assert.deepEqual((validateContent("home", legacy) as typeof siteDefaults.home).excludedPhotoIds, []);
  const ids = collectHomePhotos([portfolio("save", 120)]).map(photo => photo.id);
  await changeContent("home", "save", 7, { ...getContent("home"), excludedPhotoIds: ids }, "test-admin");
  assert.deepEqual(getContent("home").excludedPhotoIds, []);
  assert.deepEqual(getContent("home", true).excludedPhotoIds, ids);
  await assert.rejects(changeContent("home", "publish", 7, null, "test-admin"), ContentConflict);
  await changeContent("home", "publish", 8, null, "test-admin");
  assert.deepEqual(getContent("home").excludedPhotoIds, ids);
  await changeContent("home", "restore", 9, null, "test-admin");
  assert.deepEqual(getContent("home").excludedPhotoIds, []);
  assert.equal(getContent("home").slogan, legacy.slogan);
});

test("exclusions validate stable photo IDs and keep settings for temporarily absent photos", () => {
  const id = cmsPhotoId(picture("unpublished").url);
  assert.deepEqual(parseHomePhotoExclusions([id, id]), [id]);
  for (const invalid of [null, {}, "x", ["https://example.com"], ["<script>"], Array(5001).fill(id)]) assert.throws(() => parseHomePhotoExclusions(invalid));
  assert.deepEqual(parseHomePhotoExclusions(undefined), []);
});
