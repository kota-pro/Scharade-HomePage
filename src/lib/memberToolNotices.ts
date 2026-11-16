import { isMemberAccount } from "./accountVisibility.ts";
import { readUsers } from "./auth.ts";
import { readActivities } from "./activities.ts";
import { enqueuePushNotice } from "./pushQueue.ts";
import { withStoreLock, writeData } from "./store.ts";
import { findTool, toolIds, cleanupDeletedTools } from "./memberTools.ts";
import { toolLabels } from "./memberToolTypes.ts";
import { cleanUnusedToolAssets } from "./memberToolAssets.ts";
let lastCleanup = 0;
export async function drainToolNotices() {
  await cleanupDeletedTools();
  for (const id of toolIds())
    await withStoreLock(`member-tool-${id}`, async () => {
      const t = findTool(id);
      if (!t) return;
      const entry = t.outbox;
      if (!entry || entry.delivered) return;
      await withStoreLock("member-activities", () => {
        const data = readActivities();
        if (data.deletedNotificationIds?.includes(entry.id)) return;
        const existing = data.notifications.find((n) => n.id === entry.id);
        if (existing) {
          if (existing.toolId !== t.id)
            throw new Error("通知IDが重複しています。");
          return;
        }
        const approved = new Set(
          readUsers()
            .filter(isMemberAccount)
            .map((u) => u.id),
        );
        const notice = {
          id: entry.id,
          toolId: t.id,
          title: `${toolLabels[t.kind]}：${t.question.slice(0, 160)}`,
          body: "質問を確認して回答してください。",
          senderId: entry.senderId,
          senderName: entry.senderName,
          createdAt: entry.createdAt,
          recipientIds: entry.recipientIds.filter((id) => approved.has(id)),
          readBy: {},
          kind: "announcement" as const,
        };
        data.notifications.push(notice);
        enqueuePushNotice(data, notice);
        writeData("member-activities.json", data);
      });
      entry.delivered = true;
      writeData(`member-tool-${id}.json`, t);
    });
  if (Date.now() - lastCleanup > 3600000) {
    await cleanUnusedToolAssets();
    lastCleanup = Date.now();
  }
}
