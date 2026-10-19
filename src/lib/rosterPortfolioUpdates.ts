import { readUsers } from "./auth.ts";
import { readActivities } from "./activities.ts";
import { withStoreLock, writeData } from "./store.ts";
import { env } from "./config.ts";
import { fetchWithTimeout } from "./http.ts";
import { invalidateCache } from "./cache.ts";
import { normalizePortfolioGrade } from "./microcms.ts";

/** Durable outbox: roster exclusion is immediate; a CMS outage cannot re-include a departed person. */
export async function drainRosterPortfolioUpdates(
  limit = 5,
  shouldStop = () => false,
) {
  let attempted = 0,
    completed = 0;
  await withStoreLock("roster-portfolio", async () => {
    for (let i = 0; i < limit && !shouldStop(); i++) {
      const processed = await withStoreLock("auth", () =>
        withStoreLock("member-activities", async () => {
          const data = readActivities(),
            job = data.rosterPortfolioUpdates?.find(
              (j) => j.status === "pending",
            );
          if (!job) return false;
          const users = readUsers(),
            user = users.find((u) => u.id === job.userId);
          if (
            !user ||
            user.portfolioId !== job.portfolioId ||
            data.roster?.bindings[job.userId] !== job.rosterKey ||
            !data.roster.retiredRecords?.some(
              (r) => r.key === job.rosterKey && r.withdrawnAt === job.createdAt,
            )
          ) {
            job.status = "cancelled";
            job.message =
              "名簿またはアカウントの連携が変わったため、更新を中止しました。";
          } else {
            attempted++;
            job.attempts++;
            try {
              if (
                users.filter((u) => u.portfolioId === job.portfolioId)
                  .length !== 1
              )
                throw new Error(
                  "Portfolioのアカウント連携が重複しています。管理者が確認してください。",
                );
              const domain = env("MICROCMS_SERVICE_DOMAIN"),
                key = env("MICROCMS_SERVER_API_KEY"),
                endpoint = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio",
                field = env("MICROCMS_PORTFOLIO_GRADE_FIELD") || "grade";
              if (!domain || !key)
                throw new Error("Portfolioの接続設定を確認してください。");
              const url = `https://${domain}.microcms.io/api/v1/${endpoint}/${encodeURIComponent(job.portfolioId)}`;
              const headers = {
                "X-MICROCMS-API-KEY": key,
                "Content-Type": "application/json",
              };
              const response = await fetchWithTimeout(url, { headers }, 2500);
              if (!response.ok)
                throw new Error(
                  "Portfolioを取得できません。公開状態・接続設定を確認して再試行してください。",
                );
              const content = await response.json();
              if (!Object.hasOwn(job, "previousGrade")) {
                job.previousGrade = content[field] ?? null;
                writeData("member-activities.json", data);
              }
              if (normalizePortfolioGrade(content[field]) !== "OB/OG") {
                const patch = (grade: string | string[]) =>
                  fetchWithTimeout(
                    url,
                    {
                      method: "PATCH",
                      headers,
                      body: JSON.stringify({ [field]: grade }),
                    },
                    2500,
                  );
                let result = await patch(
                  Array.isArray(content[field]) ? ["OB/OG"] : "OB/OG",
                );
                if (result.status === 400) {
                  const message = await result.text();
                  if (
                    message.includes(field) &&
                    message.includes("unexpected data type")
                  )
                    result = await patch(["OB/OG"]);
                }
                if (!result.ok)
                  throw new Error(
                    "Portfolioの学年を更新できません。microCMSの更新権限・学年の選択肢を確認して再試行してください。",
                  );
              }
              job.status = "done";
              job.message = undefined;
              completed++;
            } catch (error) {
              job.status = "error";
              job.message =
                error instanceof Error &&
                !/fetch|timeout|abort/i.test(error.message)
                  ? error.message
                  : "Portfolioに接続できませんでした。再試行してください。";
            } finally {
              invalidateCache("cms:");
            }
          }
          job.updatedAt = new Date().toISOString();
          writeData("member-activities.json", data);
          return true;
        }),
      );
      if (!processed) break;
    }
  });
  return { attempted, completed };
}
