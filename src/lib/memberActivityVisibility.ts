import type { ActivityEvent, ActivityStore } from "./activityTypes.ts";
import type { Exhibition } from "./exhibitionTypes.ts";

export function eventHasEnded(event: Pick<ActivityEvent, "endsAt">, now = Date.now()) {
  const end = Date.parse(event.endsAt);
  return Number.isFinite(end) && now >= end;
}

/** Use the actual exhibition hours; voting/submission deadlines are not its end. */
export function exhibitionHasEnded(exhibition: Pick<Exhibition, "openingSchedule">, now = Date.now()) {
  const schedule = exhibition.openingSchedule;
  if (!schedule) return false;
  const hours = schedule.startDate === schedule.endDate && schedule.first
    ? schedule.first
    : schedule.last ?? schedule.regular;
  const end = Date.parse(`${schedule.endDate}T${hours.close}:00+09:00`);
  return Number.isFinite(end) && now >= end;
}

export function visibleMemberNotifications(
  data: Pick<ActivityStore, "events" | "notifications">,
  exhibitions: Pick<Exhibition, "id" | "openingSchedule">[],
  userId: string,
  now = Date.now(),
) {
  const endedEvents = new Set(data.events.filter(event => eventHasEnded(event, now)).map(event => event.id));
  const endedExhibitions = new Set(exhibitions.filter(exhibition => exhibitionHasEnded(exhibition, now)).map(exhibition => exhibition.id));
  return data.notifications.filter(notice =>
    notice.recipientIds.includes(userId) &&
    !(notice.eventId && endedEvents.has(notice.eventId)) &&
    !(notice.exhibitionId && endedExhibitions.has(notice.exhibitionId)),
  );
}
