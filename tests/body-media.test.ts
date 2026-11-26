import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { User } from "../src/lib/auth.ts";
import { activityAction, ActivityError, appendExhibitionNotice, readActivities } from "../src/lib/activities.ts";
import { bodyMediaId } from "../src/types/bodyMedia.ts";
import { readBodyAsset, stageBodyAsset } from "../src/lib/bodyMedia.ts";
import { canReadBodyAsset } from "../src/lib/bodyMediaAccess.ts";
import { createTool, readTool, toolAction } from "../src/lib/memberTools.ts";
import { exhibitionAction, readExhibitions } from "../src/lib/exhibitions.ts";
import { writeData } from "../src/lib/store.ts";

const directory = mkdtempSync(join(tmpdir(), "scharade-body-media-"));
process.env.DATA_DIR = directory;
after(() => rmSync(directory, { recursive: true, force: true }));
const account = (id: string, role: User["role"]): User => ({
  id, role, approved: true, name: id, email: `${id}@example.invalid`,
  providers: { credentials: true }, createdAt: new Date().toISOString(),
});
const writer = account("writer", "staff");
const member = account("recipient", "member");
const other = account("other", "member");
writeData("users.json", [writer, member, other]);

const content = Buffer.from("確認用ファイル");
const file = new File([new Uint8Array(content)], "file.txt", { type: "text/plain" });
const link = (url: string) => `<p><strong>資料</strong> <a href="${url}">添付</a></p>`;

test("notice attachments cannot be pasted into another notification and access follows the saved recipient list", async () => {
  const id = randomUUID();
  const url = stageBodyAsset({ kind: "notification", id }, writer.id, file, "file", content);
  const asset = readBodyAsset(bodyMediaId(url))!;
  assert.equal(canReadBodyAsset(asset, writer), true);
  assert.equal(canReadBodyAsset(asset, member), false);
  const request = { action: "notification.send", title: "資料", bodyHtml: link(url), recipientIds: [member.id] };
  await assert.rejects(activityAction(writer.id, { ...request, id: randomUUID() }),
    (error: unknown) => error instanceof ActivityError && error.status === 400);
  await activityAction(writer.id, { ...request, id });
  assert.equal(readActivities().notifications.find(notice => notice.id === id)?.body, "資料 添付");
  assert.equal(canReadBodyAsset(asset, member), true);
  assert.equal(canReadBodyAsset(asset, other), false);
  assert.equal(canReadBodyAsset(asset), false);
  await activityAction(writer.id, { action: "notification.edit", id, revision: 0, title: "資料", bodyHtml: "<p>添付を取り外しました。</p>" });
  assert.equal(canReadBodyAsset(asset, member), false);
});

test("tool attachments follow draft, public question, and private question visibility", async () => {
  const tool = await createTool(writer, "box");
  const url = stageBodyAsset({ kind: "tool", id: tool.id }, writer.id, file, "file", content);
  const asset = readBodyAsset(bodyMediaId(url))!;
  const config = { action: "save", questionHtml: link(url), recipientIds: [member.id], options: [] };
  await toolAction(tool.id, writer, { ...config, revision: tool.revision, settings: { endsAt: "", publicQuestion: true } });
  assert.equal(canReadBodyAsset(asset), false);
  await toolAction(tool.id, writer, { action: "publish", revision: readTool(tool.id).revision });
  assert.equal(canReadBodyAsset(asset), true);
  await toolAction(tool.id, writer, { ...config, revision: readTool(tool.id).revision, settings: { endsAt: "", publicQuestion: false } });
  assert.equal(canReadBodyAsset(asset), false);
  assert.equal(canReadBodyAsset(asset, other), false);
  assert.equal(canReadBodyAsset(asset, member), true);
});

test("exhibition section assets and participation notices stay within their separate audiences", async () => {
  const { exhibition: created } = await exhibitionAction(writer.id, { action: "create", title: "作品展" });
  const exhibitionId = created.id;
  const date = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
  const { exhibition: configured } = await exhibitionAction(writer.id, {
    action: "settings", exhibitionId, revision: created.revision, title: "作品展", status: "open", gallery: "staff",
    voteOpensAt: date(-2), voteClosesAt: date(2), opensAt: date(-1), closesAt: date(1), recipientIds: [member.id],
  });
  const sectionUrl = stageBodyAsset({ kind: "exhibition-section", id: exhibitionId }, writer.id, file, "file", content);
  const sectionAsset = readBodyAsset(bodyMediaId(sectionUrl))!;
  const schema = readExhibitions().exhibitions.find(item => item.id === exhibitionId)!.schemas.at(-1)!;
  schema.sections[0].descriptionHtml = link(sectionUrl);
  const { exhibition: updated } = await exhibitionAction(writer.id, {
    action: "schema", exhibitionId, revision: configured.revision, schema,
  });
  assert.equal(canReadBodyAsset(sectionAsset, member), true);
  assert.equal(canReadBodyAsset(sectionAsset, other), false);
  const noticeUrl = stageBodyAsset({ kind: "exhibition-notice", id: exhibitionId }, writer.id, file, "file", content);
  const noticeAsset = readBodyAsset(bodyMediaId(noticeUrl))!;
  await exhibitionAction(writer.id, {
    action: "participation.publish", exhibitionId, revision: updated.revision, bodyHtml: link(noticeUrl),
  });
  assert.equal(canReadBodyAsset(noticeAsset, member), false);
  const notice = readExhibitions().exhibitions.find(item => item.id === exhibitionId)!.notices!.at(-1)!;
  await appendExhibitionNotice(notice);
  assert.equal(readActivities().notifications.find(item => item.id === notice.id)?.bodyHtml, link(noticeUrl));
  assert.equal(canReadBodyAsset(noticeAsset, member), true);
  assert.equal(canReadBodyAsset(noticeAsset, other), false);
  assert.equal(canReadBodyAsset(noticeAsset), false);
});
