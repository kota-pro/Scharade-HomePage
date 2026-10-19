import crypto from "node:crypto";
import { readUsers } from "./auth.ts";
import { readActivities } from "./activities.ts";
import { readExhibitions } from "./exhibitions.ts";
import { withStoreLock, writeData } from "./store.ts";
import { enqueuePushNotice, pushQueue } from "./pushQueue.ts";
import {
  reminderAudience,
  syncEventReminders,
  syncExhibitionReminders,
} from "./reminderRules.ts";
import type { MemberNotification } from "./activityTypes.ts";

export async function createDueReminders(now = Date.now()) {
  // No network or inverse lock acquisition inside this transaction.
  return withStoreLock("auth", () =>
    withStoreLock("exhibitions", () =>
      withStoreLock("member-activities", () => {
        const data = readActivities(),
          exhibitions = readExhibitions(),
          users = readUsers();
        syncEventReminders(data, now);
        syncExhibitionReminders(data, exhibitions, now);
        const queue = pushQueue(data);
        let created = 0;
        for (const s of queue.reminders) {
          if (s.completedAt || s.dueAt > now) continue;
          const audience = reminderAudience(s, data, exhibitions, users, now);
          s.completedAt = now;
          if (!audience?.recipients.length) continue;
          const notice: MemberNotification = {
            id: crypto.randomUUID(),
            title: audience.title,
            body: "詳細を確認し、期限までにお手続きください。",
            senderId: "system:reminders",
            senderName: "写団シャレード",
            eventId: audience.eventId,
            exhibitionId: audience.exhibitionId,
            createdAt: new Date(now).toISOString(),
            recipientIds: audience.recipients,
            readBy: {},
            kind: "reminder",
            reminder: { ...s },
          };
          data.notifications.push(notice);
          enqueuePushNotice(data, notice, s.targetAt);
          created++;
        }
        // Finished deliveries are kept for diagnosis, then removed without touching notification history.
        queue.jobs = queue.jobs.filter(
          (job) => job.expiresAt + 30 * 24 * 60 * 60_000 > now,
        );
        writeData("member-activities.json", data);
        return created;
      }),
    ),
  );
}
