import { privilegedSession } from "./helpers/auth.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readData,
  writeData,
  withStoreLock,
  dataPath,
} from "../src/lib/store.ts";
import {
  readUsers,
  createSession,
  getUserFromSession,
  canEditPortfolio,
  isAdmin,
} from "../src/lib/auth.ts";
import { hashPassword, verifyPassword } from "../src/lib/passwords.ts";
import {
  createPasswordResetToken,
  resetPassword,
} from "../src/lib/passwordReset.ts";
import {
  changeContent,
  contentDocument,
  getContent,
  validateContent,
  ContentConflict,
} from "../src/lib/siteContent.ts";
import {
  signGalleryValue,
  verifyGalleryValue,
} from "../src/lib/galleryTokens.ts";
import { safeReturnPath, isSameOrigin } from "../src/lib/http.ts";
import { validateContact } from "../src/lib/contact.ts";
import { breadcrumbsFor } from "../src/lib/breadcrumbs.ts";
import { POST as updatePortfolio } from "../src/pages/api/portfolio/update.ts";
import { invalidateCache } from "../src/lib/cache.ts";
import { getAlbums, getAlbumPhotosPage } from "../src/lib/lightroom.ts";
import { photoLinks } from "../src/lib/galleryTokens.ts";
import { galleryImage } from "../src/lib/galleryImage.ts";
import { siteDefaults } from "../src/data/siteDefaults.ts";
import { applyAccountReview } from "../src/lib/accountReview.ts";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-unit-"));
before(() => {
  process.env.DATA_DIR = directory;
  process.env.GALLERY_SIGNING_SECRET = "test-gallery-secret-at-least-32-characters";
  process.env.MICROCMS_SERVICE_DOMAIN = "fixture";
  process.env.MICROCMS_SERVER_API_KEY = "fixture";
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const member = {
  id: "member",
  name: "会員",
  email: "member@example.invalid",
  approved: true,
  role: "member" as const,
  portfolioId: "own",
  createdAt: new Date().toISOString(),
  providers: { credentials: true as const },
  passwordHash: hashPassword("test-password"),
};
const admin = {
  ...member,
  id: "admin",
  email: "admin@example.invalid",
  role: "admin" as const,
  portfolioId: "admin-portfolio",
};
test("approval mail retries after failure and sends once across repeated confirmations", async () => {
  writeData("users.json", [{ ...member, approved: false }, admin]);
  let sent = 0;
  assert.equal(
    await applyAccountReview(member.id, "approve", async () => {
      throw new Error("SMTP unavailable");
    }),
    "email-failed",
  );
  assert.equal(readUsers()[0].approved, true);
  assert.equal(readUsers()[0].approvalNotifiedAt, undefined);
  await Promise.all(
    [1, 2].map(() =>
      applyAccountReview(member.id, "approve", async () => {
        sent++;
      }),
    ),
  );
  assert.equal(sent, 1);
  assert.ok(readUsers()[0].approvalNotifiedAt);
  assert.equal(readUsers()[0].authVersion, 1);
  assert.equal(
    await applyAccountReview(admin.id, "reject", async () => {
      sent++;
    }),
    "invalid",
  );
  assert.equal(sent, 1);
});
test("atomic store rejects corrupt files and serializes concurrent increments", async () => {
  writeData("counter.json", 0);
  await Promise.all(
    Array.from({ length: 25 }, () =>
      withStoreLock("counter", async () => {
        const n = readData("counter.json", 0);
        await new Promise((r) => setTimeout(r, 2));
        writeData("counter.json", n + 1);
      }),
    ),
  );
  assert.equal(readData("counter.json", 0), 25);
  fs.writeFileSync(dataPath("corrupt.json"), "{broken");
  assert.throws(() => readData("corrupt.json", []));
  assert.equal(fs.readFileSync(dataPath("corrupt.json"), "utf8"), "{broken");
});
test("only approved admin can edit others; legacy members remain members", () => {
  assert.equal(isAdmin({ ...admin, approved: false }), false);
  assert.equal(canEditPortfolio(member, "other"), false);
  assert.equal(canEditPortfolio(member, "own"), true);
  assert.equal(canEditPortfolio(admin, "other"), true);
  assert.equal(isAdmin({ ...member, role: undefined }), false);
});
test("password reset is single-use and invalidates all existing sessions", async () => {
  writeData("users.json", [member, admin]);
  writeData("sessions.json", []);
  const session = await createSession(member.id, 300);
  assert.equal(getUserFromSession(session.token).user?.id, member.id);
  const token = await createPasswordResetToken(member.id);
  const results = await Promise.all([
    resetPassword(token, "New-password-strong-123!"),
    resetPassword(token, "New-password-strong-123!"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(getUserFromSession(session.token).user, null);
  assert.equal(
    verifyPassword("New-password-strong-123!", readUsers()[0].passwordHash!),
    true,
  );
  await assert.rejects(createSession(member.id, 300, member.passwordHash));
});
test("draft is isolated; publish, revision conflicts, and restore work", async () => {
  const original = getContent("home"),
    draft = { ...original, slogan: "新しい案内" };
  await changeContent("home", "save", 0, draft, admin.id);
  assert.equal(getContent("home").slogan, original.slogan);
  assert.equal(getContent("home", true).slogan, draft.slogan);
  await assert.rejects(
    changeContent("home", "publish", 0, null, admin.id),
    ContentConflict,
  );
  await changeContent("home", "publish", 1, null, admin.id);
  assert.equal(getContent("home").slogan, draft.slogan);
  await changeContent("home", "restore", 2, null, admin.id);
  assert.equal(getContent("home").slogan, original.slogan);
  assert.equal(contentDocument("home").revision, 3);
  assert.throws(() => validateContent("home", { ...draft, unknown: true }));
  assert.throws(() =>
    validateContent("common", {
      ...siteDefaults.common,
      x: "javascript:alert(1)",
    }),
  );
});
test("return paths reject control-character origin changes and preserve local Unicode URLs", () => {
  for (const code of [...Array.from({length:32},(_,i)=>i),127]) {
    const value=`/${String.fromCharCode(code)}/outside.invalid/`;
    assert.equal(safeReturnPath(value, "/"), "/");
  }
  for (const value of ["https://outside.invalid", "//outside.invalid", "/\\outside.invalid", "relative", ""]) assert.equal(safeReturnPath(value, "/"), "/");
  for (const value of ["/Member", "/Portfolio/会員?view=作品#予定", "/posts/%E5%86%99%E7%9C%9F?tag=青&x=1"]) {
    assert.equal(safeReturnPath(value, "/"), value);
    assert.equal(new URL(safeReturnPath(value), "https://scharade.jp").origin, "https://scharade.jp");
  }
});
test("redirects, same-origin checks, breadcrumbs and contact validation", () => {
  assert.equal(safeReturnPath("//evil.invalid"), "/Portfolio/edit");
  assert.equal(safeReturnPath("/\\evil.invalid"), "/Portfolio/edit");
  assert.equal(
    isSameOrigin(
      new Request("https://scharade.jp/api/contact", {
        headers: { Origin: "https://evil.invalid" },
      }),
    ),
    false,
  );
  assert.deepEqual(
    breadcrumbsFor("/posts/example", "記事").map((c) => c.label),
    ["Home", "Activity", "記事"],
  );
  assert.throws(() => validateContact({ email: "wrong" }));
  const value = {
    name: "テスト",
    furigana: "テスト",
    institution: "大学",
    faculty: "",
    grade: "1年",
    email: "test@example.invalid",
    inquiry: "入会希望",
    message: "見学希望",
  };
  assert.equal(validateContact(value).name, "テスト");
  assert.throws(() =>
    validateContact({ ...value, email: "x\r\nBcc:evil@example.invalid" }),
  );
});
test("signed gallery claims reject tampering, expiry and wrong use", () => {
  const token = signGalleryValue({ kind: "photo", album: "a", id: "photo" });
  assert.equal(verifyGalleryValue(token, "photo").id, "photo");
  assert.throws(() => verifyGalleryValue(token + "x", "photo"));
  assert.throws(() => verifyGalleryValue(token, "cursor"));
});
test("portfolio API denies cross-user and administrative edits; permits deleting every picture", async () => {
  writeData("users.json", [member, admin]);
  writeData("sessions.json", []);
  const session = await createSession(member.id, 300);
  const invoke = (data: unknown) =>
    updatePortfolio({
      request: new Request("http://localhost/api/portfolio/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session=${session.token}`,
        },
        body: JSON.stringify(data),
      }),
    } as any);
  assert.equal(
    (await invoke({ portfolioId: "other", name: "changed" })).status,
    403,
  );
  assert.equal(
    (await invoke({ portfolioId: "own", role: "admin" })).status,
    403,
  );
  let sent: any;
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(String(options?.body));
    return new Response("{}", { status: 200 });
  };
  try {
    assert.equal(
      (
        await invoke({
          portfolioId: "own",
          pictures: [],
          iconUrl: "",
          grade: "",
        })
      ).status,
      200,
    );
    assert.deepEqual(sent.pictures, []);
    assert.equal(sent.icon, "");
    assert.equal(sent.grade, "");
    const attempts: any[] = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      attempts.push(body);
      return Array.isArray(body.grade)
        ? Response.json({})
        : Response.json(
            { message: "'grade' has unexpected data type." },
            { status: 400 },
          );
    };
    assert.equal((await invoke({ portfolioId: "own", grade: "" })).status, 200);
    assert.deepEqual(
      attempts.map((body) => body.grade),
      ["", []],
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("older Portfolio requests can save a grade without writing a CMS generation field", async () => {
  writeData("users.json", [admin]);
  writeData("sessions.json", []);
  const session = await privilegedSession(admin.id, 300);
  const original = globalThis.fetch;
  const changes: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    changes.push(JSON.parse(String(init?.body)));
    return Response.json({ id: admin.portfolioId });
  };
  try {
    const response = await updatePortfolio({
      request: new Request("http://localhost/api/portfolio/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `session=${session.token}`,
        },
        body: JSON.stringify({
          portfolioId: admin.portfolioId,
          grade: "1st Grade",
          generation: 52,
        }),
      }),
    } as any);
    assert.equal(response.status, 200);
    assert.deepEqual(changes, [{ grade: "1st Grade" }]);
  } finally {
    globalThis.fetch = original;
  }
});
test("gallery image requires album membership proof and approved user for hidden album", async () => {
  invalidateCache();
  writeData("adobe-auth.json", {
    accessToken: "fixture",
    accessTokenExpiresAt: Date.now() + 3600000,
    refreshToken: "fixture",
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/renditions/640"))
      return new Response(new Uint8Array([1, 2, 3]));
    if (url.pathname.endsWith("/assets"))
      return Response.json({
        resources: [
          {
            asset: { id: "photo" },
            payload: { importSource: { fileName: "example" } },
          },
        ],
      });
    if (url.searchParams.get("subtype") === "collection_set")
      return Response.json({ resources: [] });
    if (url.pathname.endsWith("/albums"))
      return Response.json({
        resources: [{ id: "hidden", payload: { name: "非公開 試験" } }],
      });
    return Response.json({ id: "hidden", payload: { name: "非公開 試験" } });
  };
  try {
    const albums = await getAlbums();
    assert.equal(albums[0].hidden, true);
    const photos = await getAlbumPhotosPage("hidden");
    assert.equal(photos.photos.length, 1);
    await assert.rejects(
      getAlbumPhotosPage("hidden", { cursor: "https://evil.invalid/" }),
    );
    const links = photoLinks("hidden", photos.photos[0]),
      url = new URL(links.src, "http://localhost");
    const context = (user: any, id = "photo") =>
      ({ params: { id }, url, locals: { user } }) as any;
    assert.equal((await galleryImage(context(null), 640)).status, 404);
    assert.equal(
      (await galleryImage(context({ ...member, approved: false }), 640)).status,
      404,
    );
    const allowed = await galleryImage(context(member), 640);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("Cache-Control"), "private, no-store");
    assert.equal(
      (await galleryImage(context(admin, "other-photo"), 640)).status,
      404,
    );
  } finally {
    globalThis.fetch = original;
    invalidateCache();
  }
});
