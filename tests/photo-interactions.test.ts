import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { writeData } from "../src/lib/store.ts";
import { photoView, setPhotoLike, unreadPhotoGroups, readPhotoNotifications, readPhotoState, savePhotoMetadata, photoMetadata, type ResolvedPhoto } from "../src/lib/photoState.ts";
import { cmsPhotoId } from "../src/lib/photoIdentity.ts";
import { parsePhotoMetadata } from "../src/lib/photoMetadata.ts";
import { extractPhotoExif } from "../src/lib/photoExif.ts";
import { photoVisitor } from "../src/lib/photoVisitor.ts";
import { photoCameraModel, isPhotoScanner } from "../src/lib/photoCamera.ts";
import type { User } from "../src/lib/auth.ts";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-photo-likes-"));
process.env.DATA_DIR = directory;
const owner = { id: "owner", approved: true, role: "member" } as User;
const photo: ResolvedPhoto = { ref: { source: "portfolio", containerId: "owner", imageId: "first" }, key: "cms:first", src: "thumb", full: "full", alt: "写真", title: "憧憬", ownerId: "owner", notifyOwnerId: "owner" };
beforeEach(() => { fs.rmSync(directory, { recursive: true, force: true }); fs.mkdirSync(directory); });
after(() => fs.rmSync(directory, { recursive: true, force: true }));
test("read-only state never races to replace the persistent visitor identity", () => {
  let value = "", writes = 0;
  const context = { url: new URL("https://scharade.jp/Portfolio/owner"), cookies: {
    get: () => value ? { value } : undefined,
    set: (_name: string, next: string, options: { httpOnly: boolean; secure: boolean; path: string }) => { value = next; writes++; assert.equal(options.httpOnly, true); assert.equal(options.secure, true); assert.equal(options.path, "/"); },
  } } as any;
  assert.equal(photoVisitor(context, false), ""); assert.equal(writes, 0);
  const identity = photoVisitor(context); assert.equal(writes, 1);
  for (let i = 0; i < 12; i++) assert.equal(photoVisitor(context, false), identity);
  assert.equal(writes, 1); assert.notEqual(identity, value);
});
test("anonymous likes are durable, idempotent, cancellable and atomic under concurrent requests", async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => setPhotoLike(photo, `visitor-${i}`, true)));
  await Promise.all(Array.from({ length: 8 }, () => setPhotoLike(photo, "visitor-0", true)));
  assert.equal(photoView(photo, owner).count, 12);
  assert.equal(photoView(photo, null, "visitor-0").liked, true);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 12);
  await setPhotoLike(photo, "visitor-0", false);
  assert.equal(photoView(photo, owner).count, 11);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 11);
  assert.equal(photoView(photo, null, "visitor-0").liked, false);
});
test("only the owner, executive and administrator receive counts in the response", async () => {
  await setPhotoLike(photo, "visitor", true);
  for (const user of [null, { id: "other", approved: true, role: "member" }, { id: "staff", approved: true, role: "staff" }, { id: "executive", approved: false, role: "executive" }]) assert.equal(Object.hasOwn(photoView(photo, user as User), "count"), false);
  for (const user of [owner, { id: "executive", approved: true, role: "executive" }, { id: "admin", approved: true, role: "admin" }]) assert.equal(photoView(photo, user as User).count, 1);
});
test("Blog and regular Gallery never notify, even when likes share a Portfolio identity", async () => {
  const blog = { ...photo, notifyOwnerId: undefined, ref: { ...photo.ref, source: "blog" as const } };
  await setPhotoLike(blog, "blog-visitor", true);
  assert.equal(photoView(photo, owner).count, 1);
  assert.deepEqual(unreadPhotoGroups(owner.id), []);
  await setPhotoLike({ ...photo, notifyOwnerId: undefined, ref: { source: "gallery", containerId: "album", imageId: "first" } }, "gallery-visitor", true);
  assert.equal(photoView(photo, owner).count, 2);
  assert.deepEqual(unreadPhotoGroups(owner.id), []);
});
test("grouped reads preserve new arrivals and cannot mark another owner's notifications", async () => {
  await setPhotoLike(photo, "one", true);
  const snapshot = unreadPhotoGroups(owner.id)[0];
  await setPhotoLike(photo, "two", true);
  await readPhotoNotifications("other", photo.key, snapshot.through);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 2);
  await readPhotoNotifications(owner.id, photo.key, snapshot.through);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 1);
  await setPhotoLike({ ...photo, key: "second" }, "three", true);
  assert.equal(unreadPhotoGroups(owner.id).length, 2);
  await readPhotoNotifications(owner.id);
  assert.deepEqual(unreadPhotoGroups(owner.id), []);
  await setPhotoLike(photo, "four", true);
  assert.equal(unreadPhotoGroups(owner.id)[0].count, 1);
  assert.equal(photoView(photo, owner).count, 3);
});
test("optional metadata preserves deliberate deletion and identity ignores rendition parameters", async () => {
  await savePhotoMetadata([{ ref: photo.ref, metadata: parsePhotoMetadata({ title: "", caption: "", camera: "", iso: "400" }) }]);
  assert.deepEqual(photoMetadata(photo.ref), { title: "", caption: "", camera: "", iso: "400" });
  assert.throws(() => parsePhotoMetadata({ gps: "private" }));
  assert.throws(() => parsePhotoMetadata({ title: "x".repeat(301) }));
  assert.deepEqual(parsePhotoMetadata({ lens: "0.0mmf0.0" }), { lens: "" });
  await savePhotoMetadata([{ ref: photo.ref, metadata: { lens: "0.0mmf0.0", film: "Kodak Gold 200" } }]);
  assert.deepEqual(photoMetadata(photo.ref), { lens: "", film: "Kodak Gold 200" });
  assert.equal(photoView({ ...photo, lens: "0.0 mm f/0.0" }).lens, "");
  assert.equal(photoView({ ...photo, lens: "50mm f/0.95" }).lens, "50mm f/0.95");
  const url = "https://images.microcms-assets.io/assets/test/photo.jpg";
  assert.equal(cmsPhotoId(url), cmsPhotoId(`${url}?w=1200&q=75&fm=webp`));
  assert.throws(() => cmsPhotoId("https://untrusted.invalid/photo.jpg"));
  assert.equal(readPhotoState().version, 1);
});
test("EXIF extraction precedes conversion and includes only the supported camera fields", async () => {
  const original = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ccc" } }).jpeg().withExif({ IFD0: { Make: "Nikon", Model: "Z5" }, IFD2: { LensModel: "55mm f1.7", FNumber: "16/1", ExposureTime: "1/400", ISOSpeedRatings: "4000" } }).toBuffer();
  const metadata = await extractPhotoExif(original);
  assert.equal(metadata.camera, "Z5"); assert.equal(metadata.lens, "55mm f1.7"); assert.equal(metadata.fNumber, "16"); assert.equal(metadata.shutterSpeed, "1/400"); assert.equal(metadata.iso, "4000");
  assert.deepEqual(await extractPhotoExif(await sharp(original).webp().toBuffer()), {});
  assert.deepEqual(await extractPhotoExif(Buffer.from("corrupt")), {});
  const noLens = await sharp(original).withExif({ IFD2: { LensModel: "0.0mmf0.0", ISOSpeedRatings: "400" } }).jpeg().toBuffer();
  const noLensMetadata = await extractPhotoExif(noLens);
  assert.equal(noLensMetadata.lens, undefined);
  assert.equal(noLensMetadata.iso, "400");
});
test("camera display omits manufacturers and scanner hardware, including older saved scan metadata", async () => {
  assert.equal(photoCameraModel("NIKON CORPORATION", "Z5"), "Z5");
  assert.equal(photoCameraModel("EPSON", "R-D1"), "R-D1");
  assert.equal(photoCameraModel("", "Nikon Z5"), "Nikon Z5"); // An explicitly entered camera name stays intact.
  assert.equal(photoView({ ...photo, camera: "NIKON CORPORATION NIKON Z5" }).camera, "NIKON Z5");
  assert.equal(isPhotoScanner("", "Unknown device", 1), true);
  assert.equal(isPhotoScanner("", "Unknown device", new Uint8Array([2])), true);
  for (const camera of ["FUJI PHOTO FILM CO., LTD. SP-3000", "NORITSU KOKI QSS-32_33", "Nikon COOLSCAN V", "EPSON Perfection V850", "SEIKO EPSON CORP. GT-X980", "Canon CanoScan 9000F", "NIKON CORPORATION"]) {
    assert.equal(photoView({ ...photo, camera }).camera, "");
  }
  const scan = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ccc" } }).jpeg().withExif({ IFD0: { Make: "FUJI PHOTO FILM CO., LTD.", Model: "SP-3000" }, IFD2: { ISOSpeedRatings: "400" } }).toBuffer();
  assert.deepEqual(await extractPhotoExif(scan), { iso: "400" });
});
