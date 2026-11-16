import crypto from "node:crypto";
import { readActivities } from "./activities.ts";
import { genderLabels, gradeLabels } from "./activityTypes.ts";
import {
  clubFormsConfigured,
  googleUrl,
  postClubForms,
} from "./clubFormsGoogle.ts";
import { writeData, withStoreLock } from "./store.ts";

export async function drainRosterExports(limit = 2, shouldStop = () => false) {
  let attempted = 0,
    completed = 0;
  if (!clubFormsConfigured()) return { attempted, completed };
  for (let n = 0; n < limit && !shouldStop(); n++) {
    const job = await withStoreLock("member-activities", () => {
      const data = readActivities(),
        now = Date.now();
      const next = data.rosterExports?.find(
        (job) =>
          (job.status === "pending" && job.nextAttemptAt <= now) ||
          (job.status === "processing" && (job.leaseUntil ?? 0) < now),
      );
      if (!next) return null;
      next.status = "processing";
      next.attempts++;
      next.leaseToken = crypto.randomUUID();
      next.leaseUntil = now + 90_000;
      writeData("member-activities.json", data);
      return structuredClone(next);
    });
    if (!job) break;
    attempted++;
    let spreadsheetUrl = "",
      error = "";
    try {
      const map = (row: (typeof job.records)[number]) => [
        row.key,
        row.name,
        row.university,
        row.grade ? gradeLabels[row.grade] : "要確認",
        row.gender ? genderLabels[row.gender] : "要確認",
        row.lineName ?? "",
        row.active
          ? "在籍"
          : row.departureReason === "declined"
            ? "継続しない"
            : "退会",
        row.needsReview?.join(" / ") ?? "",
        row.provenance
          ?.map(
            (source) =>
              `${source.kind === "admission" ? "入会" : "継続"} ${source.submittedAt}`,
          )
          .join(" / ") ?? "旧名簿",
        row.withdrawnAt ?? "",
      ];
      const result = await postClubForms({
        action: "roster.export",
        id: job.id,
        term: job.term,
        revision: job.revision,
        active: job.records
          .filter(
            (row) =>
              row.active && !row.identityUncertain && !row.membershipUncertain,
          )
          .map(map),
        retired: job.retiredRecords.map(map),
        review: job.records.filter((row) => row.needsReview?.length).map(map),
      });
      if (!googleUrl(result.spreadsheetUrl, "sheet"))
        throw new Error("統合名簿の保存先を確認できませんでした。");
      spreadsheetUrl = result.spreadsheetUrl;
    } catch (failure) {
      error =
        failure instanceof Error
          ? failure.message.slice(0, 300)
          : "統合名簿の更新を再試行してください。";
    }
    await withStoreLock("member-activities", () => {
      const data = readActivities(),
        current = data.rosterExports?.find((item) => item.id === job.id);
      if (
        !current ||
        current.leaseToken !== job.leaseToken ||
        current.status === "cancelled"
      )
        return;
      delete current.leaseToken;
      delete current.leaseUntil;
      if (spreadsheetUrl) {
        current.status = "done";
        current.spreadsheetUrl = spreadsheetUrl;
        delete current.error;
        completed++;
        if (
          data.roster?.term?.year === job.term.year &&
          data.roster.term.season === job.term.season
        )
          data.roster.mergedSpreadsheetUrl = spreadsheetUrl;
      } else {
        current.status = current.attempts >= 8 ? "error" : "pending";
        current.error = error;
        current.nextAttemptAt =
          Date.now() +
          Math.min(3600_000, 30_000 * 2 ** Math.min(7, current.attempts - 1));
      }
      writeData("member-activities.json", data);
    });
  }
  return { attempted, completed };
}
