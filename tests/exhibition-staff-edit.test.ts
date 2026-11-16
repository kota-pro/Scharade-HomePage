import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { writeData } from "../src/lib/store.ts";
import {
  exhibitionAction,
  publicAction,
  readExhibitions,
  updateExhibitionStore,
  uploadStaffExhibitionAsset,
  uploadExhibitionAsset,
} from "../src/lib/exhibitions.ts";
import { emptySubmission } from "../src/lib/exhibitionTypes.ts";
import {
  submissionEditChanges,
  editableSubmission,
} from "../src/lib/exhibitionSubmissionEdits.ts";
async function fixture(run: (ctx: any) => Promise<void>) {
  const previous = process.env.DATA_DIR,
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-staff-edit-"));
  process.env.DATA_DIR = dir;
  try {
    writeData(
      "users.json",
      ["staff", "admin", "author", "other"].map((id) => ({
        id,
        name: id,
        email: `${id}@example.invalid`,
        role: ["staff", "admin"].includes(id) ? id : "member",
        approved: true,
        createdAt: "2026-01-01",
        providers: {},
      })),
    );
    await exhibitionAction("staff", {
      action: "create",
      title: "運営修正の検証",
    });
    await updateExhibitionStore((data) => {
      const e = data.exhibitions[0],
        iso = (d: number) => new Date(Date.now() + d).toISOString();
      e.status = "open";
      e.opensAt = iso(-60000);
      e.closesAt = iso(3600000);
      e.participation = {
        state: "published",
        opensAt: iso(-60000),
        closesAt: iso(3600000),
        recipientIds: ["author", "other"],
        votes: {
          author: { value: "attending", at: iso(0), actorId: "author" },
          other: { value: "attending", at: iso(0), actorId: "other" },
        },
      };
    });
    const e = readExhibitions().exhibitions[0],
      sectionId = e.schemas[0].sections[0].id;
    const b = await publicAction(e.id, "", { action: "begin" }, "author");
    const content = {
      ...emptySubmission(),
      name: "作者",
      authorName: "作者",
      grade: "2年",
      notes: "元の備考",
      sections: [
        {
          sectionId,
          singles: 0,
          series: 0,
          books: 1,
          seriesPhotoCounts: [],
          fields: {},
        },
      ],
      works: [
        {
          id: crypto.randomUUID(),
          sectionId,
          kind: "book",
          title: "本",
          caption: "元の説明",
          location: "",
          equipment: "",
          settings: "",
          fields: {},
          photos: [],
        },
      ],
    };
    await publicAction(
      e.id,
      "",
      { action: "submit", revision: b.submission.revision, content },
      "author",
    );
    const command = (content: any, actor = "staff", extra: any = {}) => {
      const data = readExhibitions(),
        s = data.submissions[0];
      return exhibitionAction(actor, {
        action: "submission.edit",
        exhibitionId: e.id,
        revision: data.exhibitions[0].revision,
        submissionId: s.id,
        submissionRevision: s.revision,
        content,
        ...extra,
      });
    };
    await run({ e, command, content, sectionId });
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test("staff and admin can correct closed submissions as immutable versions; clean draft follows, independent draft survives", () =>
  fixture(async ({ e, command, content }: any) => {
    const original = structuredClone(
      readExhibitions().submissions[0].versions[0],
    );
    await updateExhibitionStore((data) => {
      data.exhibitions[0].status = "closed";
    });
    const corrected = {
      ...content,
      notes: "運営の備考",
      works: content.works.map((w: any) => ({ ...w, title: "修正した本" })),
    };
    await command(corrected);
    let s = readExhibitions().submissions[0];
    assert.deepEqual(s.versions[0], original);
    assert.equal(s.versions.at(-1)!.editedBy, "staff");
    assert.equal(s.versions.at(-1)!.delivery, "pending");
    assert.equal(s.draft.notes, "運営の備考");
    await updateExhibitionStore((data) => {
      data.submissions[0].draft = {
        ...data.submissions[0].draft,
        notes: "出展者の編集中の備考",
      };
      data.submissions[0].revision++;
    });
    await command({ ...corrected, name: "修正氏名" }, "admin");
    s = readExhibitions().submissions[0];
    assert.equal(s.versions.at(-1)!.content.name, "修正氏名");
    assert.equal(s.versions.at(-1)!.editedBy, "admin");
    assert.equal(s.draft.name, content.name);
    assert.equal(s.draft.notes, "出展者の編集中の備考");
    assert.equal(s.versions.length, 3);
    await assert.rejects(
      publicAction(
        e.id,
        "",
        { action: "save", revision: s.revision, content },
        "author",
      ),
      /入力期間外/,
    );
  }));
test("members, stale revisions, invalid fields, limits and placed-work deletion cannot overwrite a submission", () =>
  fixture(async ({ e, command, content }: any) => {
    const unchanged = async (fn: () => Promise<any>, pattern: any) => {
      const before = readExhibitions();
      await assert.rejects(fn, pattern);
      assert.deepEqual(readExhibitions(), before);
    };
    await unchanged(
      () => command(content, "author"),
      (e: any) => e.status === 403,
    );
    await unchanged(
      () => command(content, "staff", { submissionRevision: 0 }),
      (e: any) => e.status === 409,
    );
    await unchanged(
      () => command(content, "staff", { revision: 0 }),
      (e: any) => e.status === 409,
    );
    await unchanged(() => command({ ...content, name: "" }), /名前/);
    await unchanged(
      () => command({ ...content, notes: "あ".repeat(10001) }),
      /その他ご意見/,
    );
    const invalid = structuredClone(content);
    invalid.works[0].photos = [
      {
        assetId: crypto.randomUUID(),
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
      },
    ];
    await unchanged(() => command(invalid), /他の提出者/);
    await updateExhibitionStore((data) => {
      const room = {
        id: crypto.randomUUID(),
        name: "部屋",
        vertices: [
          { x: 0, y: 0 },
          { x: 6000, y: 0 },
          { x: 6000, y: 4000 },
        ],
        wallHeights: [3000, 3000, 3000],
        openings: [],
        placements: [],
        tables: [],
        books: [
          {
            workId: content.works[0].id,
            tableId: crypto.randomUUID(),
            x: 0,
            y: 0,
            width: 100,
            depth: 100,
            rotation: 0,
          },
        ],
      };
      data.exhibitions[0].rooms = [room];
    });
    const removed = structuredClone(content);
    removed.sections[0].books = 0;
    removed.works = [];
    removed.sections = [];
    await unchanged(() => command(removed), /参加する展示|配置済み/);
    const replacement = structuredClone(content);
    replacement.works[0].id = crypto.randomUUID();
    await unchanged(() => command(replacement), /配置済み/);
    // Another author cannot lend a work ID, even when no image is attached.
    const other = await publicAction(e.id, "", { action: "begin" }, "other");
    await publicAction(
      e.id,
      "",
      {
        action: "save",
        revision: other.submission.revision,
        content: {
          ...content,
          works: [{ ...content.works[0], id: crypto.randomUUID() }],
        },
      },
      "other",
    );
    const conflict = structuredClone(content);
    conflict.works[0].id = readExhibitions().submissions[1].draft.works[0].id;
    await unchanged(() => command(conflict), /作品番号/);
  }));
test("staff image upload is deadline-independent, target-bound, immutable and rechecks both revisions", () =>
  fixture(async ({ e, command, content }: any) => {
    await updateExhibitionStore((data) => {
      data.exhibitions[0].status = "closed";
    });
    const target = () => ({
      submissionId: readExhibitions().submissions[0].id,
      revision: readExhibitions().submissions[0].revision,
      exhibitionRevision: readExhibitions().exhibitions[0].revision,
    });
    const file = new File(
        [
          await sharp({
            create: {
              width: 40,
              height: 30,
              channels: 3,
              background: "#1fae99",
            },
          })
            .png()
            .toBuffer(),
        ],
        "写真.png",
        { type: "image/png" },
      ),
      assetId = crypto.randomUUID();
    await assert.rejects(
      uploadStaffExhibitionAsset(e.id, target(), assetId, file, "author"),
      (e: any) => e.status === 403,
    );
    await assert.rejects(
      uploadStaffExhibitionAsset(
        e.id,
        { ...target(), revision: 0 },
        assetId,
        file,
        "staff",
      ),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      uploadStaffExhibitionAsset(
        e.id,
        { ...target(), exhibitionRevision: 0 },
        assetId,
        file,
        "staff",
      ),
      (e: any) => e.status === 409,
    );
    await assert.rejects(
      uploadExhibitionAsset(e.id, "", assetId, file, "author"),
      /入力期間外/,
    );
    const r = await uploadStaffExhibitionAsset(
      e.id,
      target(),
      assetId,
      file,
      "staff",
    );
    assert.equal(r.asset.submissionId, target().submissionId);
    assert.equal(r.asset.name, "写真.png");
    assert.equal(readExhibitions().submissions[0].versions.length, 1);
    const next = structuredClone(content);
    next.works[0].photos = [
      { assetId, x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    ];
    await command(next);
    assert.equal(
      readExhibitions().submissions[0].versions[0].content.works[0].photos
        .length,
      0,
    );
    assert.equal(
      readExhibitions().submissions[0].versions[1].content.works[0].photos[0]
        .assetId,
      assetId,
    );
    await assert.rejects(
      uploadStaffExhibitionAsset(
        e.id,
        target(),
        crypto.randomUUID(),
        new File(["broken"], "broken.png"),
        "staff",
      ),
      /JPEG・PNG/,
    );
  }));
test("comparison omits derived preview properties and includes long notes, images, counts and placement edits", () =>
  fixture(async ({ e, content }: any) => {
    const original = editableSubmission({
      ...content,
      works: [{ ...content.works[0], layout: "derived" }],
    });
    assert.equal((original.works[0] as any).layout, undefined);
    assert.deepEqual(
      submissionEditChanges(original, original, e.schemas[0], (id) => id),
      [],
    );
    const next = structuredClone(original);
    next.notes = "変更備考";
    next.works[0].photos = [
      {
        assetId: crypto.randomUUID(),
        x: 12,
        y: 3,
        width: 100,
        height: 80,
        rotation: 90,
      },
    ];
    const rows = submissionEditChanges(
      original,
      next,
      e.schemas[0],
      () => "新しい画像.png",
    );
    assert.ok(rows.some((r) => r.after === "変更備考"));
    assert.ok(rows.some((r) => r.after === "新しい画像.png"));
    assert.ok(rows.some((r) => r.after.includes("100×80 mm / X 12")));
  }));

test("a replacement with the same filename is a saveable image change", () =>
  fixture(async ({ e, content }: any) => {
    const original = structuredClone(content);
    original.works[0].photos = [
      {
        assetId: crypto.randomUUID(),
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        rotation: 0,
      },
    ];
    const next = structuredClone(original);
    next.works[0].photos[0].assetId = crypto.randomUUID();
    const rows = submissionEditChanges(
      original,
      next,
      e.schemas[0],
      () => "IMG_0001.jpg",
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].before, "IMG_0001.jpg");
    assert.equal(rows[0].after, "IMG_0001.jpg（画像を差し替え）");
  }));
