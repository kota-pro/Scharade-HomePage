import { readActivities } from "./activities.ts";
import { getPortfolioDetail, type Portfolio } from "./microcms.ts";
import { normalizeExhibitionGrade } from "./exhibitionGrades.ts";
import type { User } from "./auth.ts";

/** Account profile is authoritative; a linked Portfolio fills missing information. */
export async function exhibitionAccountGrade(user: Pick<User, "id" | "portfolioId">): Promise<string> {
  let course: string | undefined;
  try {
    const data = readActivities(), profile = data.profiles[user.id];
    if (profile?.rosterKey && !data.roster?.retiredRecords?.some(record => record.key === profile.rosterKey)) course = profile.grade;
  } catch { /* Missing grade metadata must never prevent opening a submission. */ }
  if (course) {
    const grade = normalizeExhibitionGrade(course);
    if (grade) return grade;
    if (course !== "master") return "";
  }
  if (!user.portfolioId) return "";
  try {
    const portfolio = await getPortfolioDetail<Pick<Portfolio, "grade">>(user.portfolioId, { fields: "id,grade" });
    const grade = normalizeExhibitionGrade(portfolio.grade);
    return course === "master" && !grade.startsWith("修士") ? "" : grade;
  } catch { return ""; }
}
