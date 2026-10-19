import type { ActivityStore, MemberNotification } from "./activityTypes.ts";
import { readPushDevices } from "./pushDeviceState.ts";
import type { PushQueue } from "./pushTypes.ts";

export const DAY = 24 * 60 * 60_000;
export function pushQueue(data: ActivityStore): PushQueue {
  const queue = (data.push ??= { jobs: [], reminders: [] });
  if (!Array.isArray(queue.jobs) || !Array.isArray(queue.reminders))
    throw new Error("通知送信データを読めません。");
  return queue;
}
/** Call in the same member-activities transaction that appends the notice. No network here. */
export function enqueuePushNotice(
  data: ActivityStore,
  notice: MemberNotification,
  expiresAt = Date.parse(notice.createdAt) + DAY,
) {
  const queue = pushQueue(data);
  for (const device of readPushDevices().devices) {
    if (
      !device.enabled ||
      !notice.recipientIds.includes(device.userId) ||
      (notice.reminder && !device.remindersEnabled)
    )
      continue;
    const id = `${notice.id}:${device.id}:${device.generation}`;
    if (!queue.jobs.some((job) => job.id === id))
      queue.jobs.push({
        id,
        noticeId: notice.id,
        deviceId: device.id,
        generation: device.generation,
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.parse(notice.createdAt),
        expiresAt,
      });
  }
}
