import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { emptyActivities } from "../src/lib/activityTypes.ts";
import type { User } from "../src/lib/auth.ts";
import { defaultToolPublication, defaultToolSettings } from "../src/lib/memberToolTypes.ts";
import { searchCategories, searchCategory, searchSite } from "../src/lib/search.ts";
import { writeData } from "../src/lib/store.ts";

test("member search applies recipient, publication and role restrictions to every category", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "site-search-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    const member: User = {
      id: "member", name: "会員", approved: true, role: "member",
      email: "member@example.invalid", createdAt: "", providers: {},
    };
    const other = { ...member, id: "other" };
    const staff = { ...member, id: "staff", role: "staff" as const };
    const event = { descriptionHtml: "<p>検索テスト<strong>参加</strong></p>", status: "published", recipientIds: ["member"] };
    const notice = { bodyHtml: "<p>検索テスト　集合</p>", recipientIds: ["member"] };
    writeData("member-activities.json", {
      ...emptyActivities(),
      events: [
        { ...event, id: "event", title: "公開企画" },
        { ...event, id: "draft", title: "下書き企画", status: "draft" },
        { ...event, id: "ended", title: "終了企画", endsAt: "2000-01-01T00:00:00Z" },
      ],
      notifications: [
        { ...notice, id: "notice", title: "本人宛て" },
        { ...notice, id: "other", title: "他の会員宛て", recipientIds: ["other"] },
        { ...notice, id: "old", title: "終了企画の通知", eventId: "ended" },
      ],
    });
    const exhibition = { title: "検索テスト写真展", rooms: [], schemas: [{}], participation: { state: "published", recipientIds: ["member"] } };
    writeData("exhibitions.json", {
      version: 1, submissions: [], assets: [],
      exhibitions: [
        { ...exhibition, id: "exhibition" },
        { ...exhibition, id: "draft", participation: { ...exhibition.participation, state: "draft" } },
      ],
    });
    const toolId = randomUUID();
    writeData("member-tools-index.json", { version: 1, ids: [toolId] });
    writeData(`member-tool-${toolId}.json`, {
      id: toolId, version: 1, status: "published", kind: "poll", question: "検索テスト投票",
      recipientIds: ["member"], responses: [], options: [], assets: [],
      settings: defaultToolSettings(), publication: defaultToolPublication("poll"),
    });

    const results = async (kind: Parameters<typeof searchSite>[1], viewer?: User, query = "検索テスト") => {
      const response = await searchSite(query, kind, viewer);
      assert.equal(response.partial, false);
      assert.ok(response.results.every(result => result.category === kind));
      return response.results.map(result => result.url);
    };

    assert.deepEqual(await results("notifications", member, "検索テスト 集合"), ["/Member/notifications/notice"]);
    assert.deepEqual(await results("notifications", other), ["/Member/notifications/other"]);
    assert.deepEqual(await results("notifications", staff), []);
    assert.deepEqual(await results("events", member, "検索テスト参加"), ["/Member/events/event", "/Member/events/ended"]);
    assert.deepEqual(await results("events", other), []);
    assert.deepEqual(await results("events", staff), ["/Member/events/event", "/Member/events/ended"]);
    assert.deepEqual(await results("exhibitions", member), ["/Member/exhibitions/exhibition"]);
    assert.deepEqual(await results("exhibitions", other), []);
    assert.deepEqual(await results("tools", member), [`/Member/tools/${toolId}`]);
    assert.deepEqual(await results("tools", other), []);
    for (const kind of ["notifications", "events", "exhibitions", "tools"] as const) {
      assert.equal(searchCategories().includes(kind), false);
      assert.deepEqual(await results(kind), []);
      assert.deepEqual(await results(kind, { ...member, approved: false }), []);
    }
    assert.equal(searchCategory("constructor"), "all");
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
