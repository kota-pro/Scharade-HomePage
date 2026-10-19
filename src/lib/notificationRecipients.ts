import type { User } from "./auth.ts";
import type { ActivityStore } from "./activityTypes.ts";
import { gradeLabels } from "./activityTypes.ts";

export function notificationRecipient(user: Pick<User, "id" | "name">, activities: ActivityStore) {
  const profile = activities.profiles[user.id];
  const grade = profile?.rosterKey && Object.hasOwn(gradeLabels, profile.grade) ? profile.grade : "unknown";
  return { id: user.id, name: user.name, grade, gradeLabel: grade === "unknown" ? "学年未設定" : gradeLabels[grade] };
}
