import { gradeLabels, type Grade } from "./activityTypes.ts";

export const groupGradeLabels = {
  "1": "1年生",
  "2": "2年生",
  "3": "3年生",
  "4": "4年以上",
  other: "その他",
} as const;

/** Keep the roster's actual course while balancing upper years as one group. */
export function groupGrade(grade: Grade): keyof typeof groupGradeLabels {
  if (["4", "5", "6", "master", "doctorate", "alumni"].includes(grade))
    return "4";
  return grade === "1" || grade === "2" || grade === "3" ? grade : "other";
}

export function groupGradeLabel(grade: Grade) {
  return Object.hasOwn(gradeLabels, grade)
    ? groupGradeLabels[groupGrade(grade)]
    : "学年未登録";
}
