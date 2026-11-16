import type { User } from "./auth.ts";
import type { ActivityStore } from "./activityTypes.ts";
import { gradeLabels } from "./activityTypes.ts";

export const notificationGradeOptions = Object.entries(gradeLabels).filter(
  ([grade]) => grade !== "5" && grade !== "6",
);

export function notificationRecipient(user: Pick<User, "id" | "name">, activities: ActivityStore) {
  const profile = activities.profiles[user.id];
  const grade = profile?.rosterKey && Object.hasOwn(gradeLabels, profile.grade) ? profile.grade : "unknown";
  const rosterKey = activities.roster?.bindings[user.id];
  const record = rosterKey ? activities.roster?.records.find(record => record.key === rosterKey && record.active) : undefined;
  return { id: user.id, name: user.name, lineName: record?.lineName?.trim() ?? "", grade, gradeLabel: grade === "unknown" ? "学年未設定" : gradeLabels[grade] };
}
