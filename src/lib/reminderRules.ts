import type { ActivityStore } from "./activityTypes.ts";
import type { ExhibitionStore } from "./exhibitionTypes.ts";
import type { User } from "./auth.ts";
import type { ReminderKind, ReminderSchedule } from "./pushTypes.ts";
import { DAY, pushQueue } from "./pushQueue.ts";

function schedule(
  sourceId: string,
  kind: ReminderKind,
  target: string,
  configuredAt?: string,
): ReminderSchedule | null {
  const targetAt = Date.parse(target);
  return Number.isFinite(targetAt)
    ? {
        key: `${kind}:${sourceId}:${targetAt}`,
        sourceId,
        kind,
        targetAt,
        dueAt: targetAt - DAY,
        ...(configuredAt && Number.isFinite(Date.parse(configuredAt))
          ? { configuredAt: Date.parse(configuredAt) }
          : {}),
      }
    : null;
}
function reconcile(
  data: ActivityStore,
  kinds: ReminderKind[],
  candidates: (ReminderSchedule | null)[],
  now: number,
) {
  const queue = pushQueue(data),
    valid = candidates.filter((s): s is ReminderSchedule => s !== null),
    keys = new Set(valid.map((s) => s.key));
  queue.reminders = queue.reminders.filter((s) =>
    s.completedAt
      ? s.targetAt + 30 * DAY > now
      : !kinds.includes(s.kind) || keys.has(s.key),
  );
  for (const s of valid) {
    // Never backfill a reminder when a short-notice event is first observed after its due time.
    const missedPoll =
      s.configuredAt !== undefined &&
      s.configuredAt <= s.dueAt &&
      now < s.targetAt;
    if (
      (s.dueAt > now || missedPoll) &&
      !queue.reminders.some((old) => old.key === s.key)
    )
      queue.reminders.push(s);
  }
}
export function syncEventReminders(data: ActivityStore, now: number) {
  reconcile(
    data,
    ["event-deadline", "event-start"],
    data.events
      .filter((e) => e.status === "published")
      .flatMap((e) => [
        schedule(e.id, "event-deadline", e.deadline),
        schedule(e.id, "event-start", e.startsAt),
      ]),
    now,
  );
}
export function syncExhibitionReminders(
  data: ActivityStore,
  exhibitions: ExhibitionStore,
  now: number,
) {
  reconcile(
    data,
    ["exhibition-vote", "exhibition-submission"],
    exhibitions.exhibitions
      .filter((e) => e.participation?.state === "published")
      .flatMap((e) => [
        schedule(
          e.id,
          "exhibition-vote",
          e.participation!.closesAt,
          e.reminderConfiguredAt?.vote,
        ),
        e.status === "open"
          ? schedule(
              e.id,
              "exhibition-submission",
              e.closesAt,
              e.reminderConfiguredAt?.submission,
            )
          : null,
      ]),
    now,
  );
}
/** Rechecked both when creating the reminder and immediately before sending its push. */
export function reminderAudience(
  s: ReminderSchedule,
  data: ActivityStore,
  exhibitions: ExhibitionStore,
  users: User[],
  now: number,
) {
  if (now < s.dueAt || now >= s.targetAt) return null;
  const approved = new Set(
    users.filter((u) => u.approved && !u.mustResetPassword).map((u) => u.id),
  );
  if (s.kind === "event-deadline" || s.kind === "event-start") {
    const e = data.events.find(
      (e) => e.id === s.sourceId && e.status === "published",
    );
    if (
      !e ||
      Date.parse(s.kind === "event-deadline" ? e.deadline : e.startsAt) !==
        s.targetAt
    )
      return null;
    return {
      title: `${s.kind === "event-deadline" ? "参加回答の締切が近づいています" : "明日の企画"}：${e.title}`,
      eventId: e.id,
      recipients: e.recipientIds.filter(
        (id) =>
          approved.has(id) &&
          (s.kind === "event-deadline"
            ? !e.votes[id]
            : e.votes[id]?.value === "attending"),
      ),
    };
  }
  const e = exhibitions.exhibitions.find((e) => e.id === s.sourceId),
    p = e?.participation;
  if (!e || !p || p.state !== "published") return null;
  if (s.kind === "exhibition-vote") {
    if (Date.parse(p.closesAt) !== s.targetAt || Date.parse(p.opensAt) > now)
      return null;
    return {
      title: `写真展の参加回答締切が近づいています：${e.title}`,
      exhibitionId: e.id,
      recipients: p.recipientIds.filter(
        (id) => approved.has(id) && !p.votes[id],
      ),
    };
  }
  if (
    e.status !== "open" ||
    Date.parse(e.closesAt) !== s.targetAt ||
    Date.parse(e.opensAt) > now ||
    Date.parse(p.closesAt) > now
  )
    return null;
  return {
    title: `写真展の作品提出締切が近づいています：${e.title}`,
    exhibitionId: e.id,
    recipients: p.recipientIds.filter(
      (id) =>
        approved.has(id) &&
        p.votes[id]?.value === "attending" &&
        !exhibitions.submissions.some(
          (sub) =>
            sub.exhibitionId === e.id &&
            sub.userId === id &&
            !sub.inactive &&
            sub.versions.length > 0,
        ),
    ),
  };
}
