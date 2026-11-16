export const exhibitionGrades = ["1年", "2年", "3年", "4年", "修士1年", "修士2年"] as const;
/** Recognize stored labels without guessing the year of a generic master's course. */
export function normalizeExhibitionGrade(value: unknown): string {
  if (Array.isArray(value)) return value.map(normalizeExhibitionGrade).find(Boolean) ?? "";
  if (typeof value !== "string") return "";
  const text = value.normalize("NFKC").replace(/\s+/g, "").toLowerCase().replace(/[一二三四](?=年(?:生)?$)/g, n => String("一二三四".indexOf(n) + 1));
  const bachelor = text.match(/^(?:学部|大学)?([1-4])(?:年(?:生)?)?$/) ?? text.match(/^([1-4])(?:st|nd|rd|th)grade$/);
  if (bachelor) return `${bachelor[1]}年`;
  const master = text.match(/^(?:(?:大学院)?(?:修士(?:課程)?|博士(?:課程)?前期(?:課程)?)|m|(?:大学院|院)(?:生)?)([12])(?:年(?:生)?)?$/);
  return master ? `修士${master[1]}年` : "";
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[c]!));
/** Legacy values remain visible but never become an extra selectable choice. */
export function exhibitionGradeOptionsHtml(current = "") {
  const selected = normalizeExhibitionGrade(current), legacy = current && !selected;
  return `<option value="" disabled ${!current ? "selected" : ""}>選択してください</option>${legacy ? `<option value="${escape(current)}" disabled selected>${escape(current)}（保存済み）</option>` : ""}${exhibitionGrades.map(grade => `<option value="${grade}" ${grade === selected ? "selected" : ""}>${grade}</option>`).join("")}`;
}
