import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { photoView, setPhotoLike, unreadPhotoGroups, readPhotoNotifications, readPhotoState, clearAccountPhotoReferences, type ResolvedPhoto } from "../src/lib/photoState.ts";
import { writeData, dataPath } from "../src/lib/store.ts";
import { cmsPhotoId } from "../src/lib/photoIdentity.ts";
import { microcmsClient } from "../src/lib/microcms.ts";
import { invalidateCache } from "../src/lib/cache.ts";
import { getPhotoRanking } from "../src/lib/photoRanking.ts";
import { POST as likeAPI } from "../src/pages/api/photos/like.ts";
import { POST as stateAPI } from "../src/pages/api/photos/state.ts";
import { GET as notificationsAPI } from "../src/pages/api/member/photo-notifications.ts";
import type { User } from "../src/lib/auth.ts";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-photo-likers-"));
process.env.DATA_DIR = directory;
const member = (id: string, name: string, role = "member") => ({ id: `account-${id}`, name, email: `${id}@example.invalid`, approved: true, role, portfolioId: `portfolio-${id}`, providers: { credentials: true }, createdAt: "2026-11-01" }) as User;
const owner = member("owner", "写真の作者"), alice = member("alice", "花子"), bob = member("bob", "太郎"), executive = member("executive", "幹部", "executive"), administrator = member("administrator", "管理者", "admin");
let users: User[];
const url = "https://images.microcms-assets.io/assets/fixture/likers.jpg", id = cmsPhotoId(url);
const photo: ResolvedPhoto = { ref: { source: "portfolio", containerId: owner.portfolioId!, imageId: id }, key: `cms:${id}`, src: url, full: url, alt: "写真", title: "作品", ownerId: owner.id, notifyOwnerId: owner.id };
const portfolio = { id: owner.portfolioId, name: owner.name, pictures: [{ url, width: 1200, height: 800 }] };
const originalDetail = microcmsClient.getListDetail;
beforeEach(() => {
  fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory); invalidateCache();
  users = structuredClone([owner, alice, bob, executive, administrator]); writeData("users.json", users);
  microcmsClient.getListDetail = (async () => portfolio) as typeof microcmsClient.getListDetail;
});
after(() => { microcmsClient.getListDetail = originalDetail; fs.rmSync(directory, { recursive: true, force: true }); });
const view = () => photoView(photo, owner);
function context(user: User | null, payload: unknown) {
  return { locals: { user }, url: new URL("http://127.0.0.1:4329/api/photos/like"), cookies: { get: () => ({ value: "A".repeat(43) }), set() {} }, request: new Request("http://127.0.0.1:4329/api/photos/like", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) } as any;
}

test("account likes are idempotent across devices and isolated from guests or another account on the same browser", async () => {
  await setPhotoLike(photo, "browser-one", true, alice);
  await setPhotoLike(photo, "browser-two", true, alice);
  assert.equal(view().count, 1); assert.deepEqual(view().likers, [{ name: alice.name, href: `/Portfolio/${alice.portfolioId}` }]);
  assert.equal(photoView(photo, alice, "different-browser").liked, true);
  assert.equal(photoView(photo, bob, "browser-one").liked, false); assert.equal(photoView(photo, null, "browser-one").liked, false);
  await setPhotoLike(photo, "browser-one", true, bob); await setPhotoLike(photo, "browser-one", true);
  assert.equal(view().count, 3); assert.deepEqual(view().likers?.map(person => person.name), [bob.name, alice.name]);
  await setPhotoLike(photo, "browser-one", false);
  assert.equal(view().count, 2); assert.equal(photoView(photo, alice).liked, true); assert.equal(photoView(photo, bob).liked, true);
  await setPhotoLike(photo, "different-browser", false, alice);
  assert.equal(view().count, 1); assert.deepEqual(view().likers?.map(person => person.name), [bob.name]);
});

test("legacy and anonymous likes retain their counts without guessing an account or changing data on read", async () => {
  await setPhotoLike(photo, "legacy-browser", true);
  const before = fs.readFileSync(dataPath("photo-interactions.json"));
  assert.deepEqual(view().likers, []); assert.equal(view().count, 1);
  assert.deepEqual(fs.readFileSync(dataPath("photo-interactions.json")), before);
  assert.equal(photoView(photo, alice, "legacy-browser").liked, true);
  await setPhotoLike(photo, "legacy-browser", true, alice);
  assert.equal(view().count, 1); assert.deepEqual(view().likers, []);
  await setPhotoLike(photo, "legacy-browser", false, alice);
  assert.equal(view().count, 0); assert.equal(photoView(photo, alice, "legacy-browser").liked, false);
  await setPhotoLike(photo, "legacy-browser", true, alice);
  assert.equal(readPhotoState().version, 1); assert.equal(view().count, 1);
  assert.equal(readPhotoState().likes[photo.key]["legacy-browser"].likerId, undefined);
  assert.deepEqual(view().likers?.map(person => person.name), [alice.name]);
});

test("only count-authorized viewers receive names; responses expose no account IDs, emails or visitor identities", async () => {
  await setPhotoLike(photo, "private-visitor", true, alice);
  for (const viewer of [null, alice, { ...bob, role: "staff" }, { ...executive, approved: false }]) {
    const value = photoView(photo, viewer as User, "private-visitor"); assert.equal(Object.hasOwn(value, "count"), false); assert.equal(Object.hasOwn(value, "likers"), false);
  }
  for (const viewer of [owner, executive, administrator]) {
    const value = photoView(photo, viewer); assert.equal(value.count, 1); assert.equal(value.likers?.[0].name, alice.name);
    const serialized = JSON.stringify(value); for (const secret of [alice.id, alice.email, "private-visitor", "likerId", "ownerId"]) assert.equal(serialized.includes(secret), false);
  }
});

test("unread notification names belong only to unread active likes and all names remain available in the photo total", async () => {
  await setPhotoLike(photo, "one", true, alice); const first = unreadPhotoGroups(owner.id)[0];
  await readPhotoNotifications(owner.id, photo.key, first.through);
  await setPhotoLike(photo, "two", true, bob); await setPhotoLike(photo, "anonymous", true);
  const unread = unreadPhotoGroups(owner.id)[0]; assert.equal(unread.count, 2); assert.deepEqual(unread.likers.map(person => person.name), [bob.name]);
  assert.deepEqual(view().likers?.map(person => person.name), [bob.name, alice.name]);
  await setPhotoLike(photo, "another-browser", false, bob);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 1); assert.deepEqual(unreadPhotoGroups(owner.id)[0].likers, []);
  await readPhotoNotifications(owner.id); assert.deepEqual(unreadPhotoGroups(owner.id), []);
});

test("deleting a liker removes the name and internal identity while preserving anonymous totals and other members", async () => {
  await setPhotoLike(photo, "one", true, alice); await setPhotoLike(photo, "two", true, bob); await setPhotoLike(photo, "guest", true);
  const sequence = readPhotoState().sequence; await clearAccountPhotoReferences(alice.id, alice.portfolioId);
  assert.equal(view().count, 3); assert.deepEqual(view().likers?.map(person => person.name), [bob.name]);
  assert.equal(JSON.stringify(readPhotoState()).includes(alice.id), false); assert.ok(readPhotoState().sequence > sequence);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 3); assert.deepEqual(unreadPhotoGroups(owner.id)[0].likers.map(person => person.name), [bob.name]);
});

test("API attribution uses the authenticated account and ignores forged sender fields", async () => {
  const response = await likeAPI(context(alice, { ref: photo.ref, liked: true, likerId: bob.id, userId: owner.id })); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.photo.likers, undefined); assert.equal(body.photo.count, undefined);
  assert.equal(Object.values(readPhotoState().likes[photo.key])[0].likerId, alice.id);
  const authorized = await (await stateAPI(context(owner, { refs: [photo.ref] }))).json(); assert.equal(authorized.results[0].photo.likers[0].name, alice.name);
  const publicState = await (await stateAPI(context(null, { refs: [photo.ref], userId: owner.id }))).json(); assert.equal(publicState.results[0].photo.likers, undefined);
  const stale = await likeAPI(context({ ...bob, id: "deleted-account" }, { ref: photo.ref, liked: true })); assert.equal(stale.status, 409); assert.equal(view().count, 1);
});

test("notification API shows names only to the recipient, including their notices for unavailable photos", async () => {
  await setPhotoLike(photo, "one", true, alice);
  const result = await (await notificationsAPI(context(owner, null))).json(); assert.equal(result.notifications[0].likers[0].name, alice.name);
  const unrelated = await (await notificationsAPI(context(bob, null))).json(); assert.deepEqual(unrelated.notifications, []);
  assert.equal((await notificationsAPI(context(null, null))).status, 401);
  users[0].portfolioId = null; writeData("users.json", users);
  const changed = await (await notificationsAPI(context(owner, null))).json(); assert.equal(changed.notifications[0].title, "現在表示できない写真"); assert.equal(changed.notifications[0].likers[0].name, alice.name);
  assert.deepEqual((await (await notificationsAPI(context(bob, null))).json()).notifications, []);
});

test("cached rankings refresh member names and missing accounts without exposing historical names", async () => {
  await setPhotoLike(photo, "one", true, alice);
  const first = await getPhotoRanking(administrator); assert.equal(first.photos[0].likers?.[0].name, alice.name);
  users[1].name = "現在の表示名"; writeData("users.json", users);
  const renamed = await getPhotoRanking(administrator); assert.equal(renamed.photos[0].likers?.[0].name, "現在の表示名");
  writeData("users.json", users.filter(user => user.id !== alice.id));
  const removed = await getPhotoRanking(administrator); assert.deepEqual(removed.photos[0].likers, []); assert.equal(removed.photos[0].count, 1);
});
