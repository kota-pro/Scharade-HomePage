export function welcomeFormTitle(kind: string, startsAt = "", place = "") {
  if (kind !== "welcome_photo" && kind !== "welcome_meal") return "";
  const label = kind === "welcome_photo" ? "新歓撮影会" : "新歓食事会";
  const date = new Date(
    /(?:Z|[+-]\d\d:\d\d)$/.test(startsAt) ? startsAt : `${startsAt}+09:00`,
  );
  let day = "月/日（曜日）";
  if (Number.isFinite(date.getTime())) {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      weekday: "short",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    day = `${part("month")}/${part("day")}（${part("weekday")}）`;
  }
  return `【${day}】シャレード${label}＠${place.trim() || "場所"}`;
}
