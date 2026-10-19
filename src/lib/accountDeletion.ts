import crypto from "node:crypto";
import { readUsers, readSessions, isAdmin, type User } from "./auth.ts";
import { accountRevision, AccountUpdateError } from "./accountManagement.ts";
import { withStoreLock, writeData } from "./store.ts";
import { revokeUserPasswordResetTokens } from "./passwordReset.ts";
import { env } from "./config.ts";
import { fetchWithTimeout } from "./http.ts";
import { invalidateCache } from "./cache.ts";
import { audit } from "./audit.ts";

export function accountDeletionRevision(user: User) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        user.id,
        accountRevision(user),
        user.role ?? "member",
        user.approved,
        user.portfolioId ?? null,
        user.createdAt ?? "",
      ]),
    )
    .digest("hex");
}

async function deletePortfolioContent(id: string) {
  const domain = env("MICROCMS_SERVICE_DOMAIN");
  const key = env("MICROCMS_SERVER_API_KEY");
  const endpoint = env("MICROCMS_PORTFOLIO_ENDPOINT") || "portfolio";
  if (!domain || !key)
    throw new AccountUpdateError(
      "Portfolioの削除設定を確認してください。アカウントは削除していません。",
      503,
    );
  const base = `https://${domain}.microcms.io/api/v1/${endpoint}`;
  const headers = { "X-MICROCMS-API-KEY": key };
  try {
    const response = await fetchWithTimeout(
      `${base}/${encodeURIComponent(id)}`,
      { method: "DELETE", headers },
      6000,
    );
    if (response.ok) return;
    if (response.status === 400 || response.status === 404) {
      // Content API 404 can also mean unpublished. Use management metadata
      // to distinguish absence from unpublished content or denied deletion.
      const managementKey = env("MICROCMS_SERVER_API_KEY");
      if (managementKey) {
        const managementBase = `https://${domain}.microcms-management.io/api/v1/contents/${endpoint}`;
        const checks = await Promise.all([
          fetchWithTimeout(
            `${managementBase}/${encodeURIComponent(id)}`,
            { headers: { "X-MICROCMS-API-KEY": managementKey } },
            2000,
          ),
          fetchWithTimeout(
            `${managementBase}?limit=1`,
            { headers: { "X-MICROCMS-API-KEY": managementKey } },
            2000,
          ),
        ]);
        if (checks[0].status === 404 && checks[1].ok) return;
      }
    }
    throw new AccountUpdateError(
      response.status === 401 || response.status === 403
        ? "microCMSのPortfolioに対するDELETE権限を確認してください。アカウントは削除していません。"
        : "Portfolioの削除を確認できませんでした。アカウントは残しています。microCMSのDELETE権限・コンテンツの参照関係・取得権限を確認して再試行してください。",
      502,
    );
  } catch (error) {
    if (error instanceof AccountUpdateError) throw error;
    throw new AccountUpdateError(
      "Portfolioの削除結果を確認できませんでした。アカウントは残しています。時間をおいて再試行してください。",
      502,
    );
  } finally {
    // A timed-out DELETE can still have completed upstream.
    invalidateCache("cms:");
  }
}

export async function deleteAccount(
  actorId: string,
  targetId: string,
  input: unknown,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AccountUpdateError("削除の確認内容を確認してください。", 400);
  const data = input as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !["revision", "confirmationEmail"].includes(key),
    ) ||
    typeof data.revision !== "string" ||
    typeof data.confirmationEmail !== "string"
  )
    throw new AccountUpdateError("削除の確認内容を確認してください。", 400);
  // Use the same lock order as approval, so a pending approval cannot outlive deletion.
  await withStoreLock("account-review", () =>
    withStoreLock("auth", async () => {
      const users = readUsers();
      if (!isAdmin(users.find((user) => user.id === actorId)))
        throw new AccountUpdateError("管理者権限が必要です。", 403);
      if (actorId === targetId)
        throw new AccountUpdateError(
          "ログイン中の管理者自身は削除できません。",
          403,
        );
      const user = users.find((user) => user.id === targetId);
      if (!user)
        throw new AccountUpdateError(
          "対象のアカウントは見つかりません。一覧を確認してください。",
          404,
        );
      if (data.revision !== accountDeletionRevision(user))
        throw new AccountUpdateError(
          "登録内容が更新されています。ページを再読み込みし、対象を確認してください。",
          409,
        );
      if (
        (data.confirmationEmail as string).trim().toLowerCase() !==
        user.email.trim().toLowerCase()
      )
        throw new AccountUpdateError(
          "確認用のメールアドレスが一致しません。",
          400,
        );
      if (
        user.portfolioId &&
        users.some(
          (other) =>
            other.id !== user.id && other.portfolioId === user.portfolioId,
        )
      )
        throw new AccountUpdateError(
          "このPortfolioは別のアカウントにも紐づいています。紐付けを確認してから削除してください。",
          409,
        );
      const remainingSessions = readSessions().filter(
        (session) => session.userId !== user.id,
      );
      if (user.portfolioId) await deletePortfolioContent(user.portfolioId);
      try {
        revokeUserPasswordResetTokens(user.id);
        writeData("sessions.json", remainingSessions);
        writeData(
          "users.json",
          users.filter((other) => other.id !== user.id),
        );
      } catch {
        throw new AccountUpdateError(
          user.portfolioId
            ? "Portfolioの削除は完了しましたが、アカウントの削除を完了できませんでした。時間をおいて再試行してください。"
            : "アカウントを削除できませんでした。時間をおいて再試行してください。",
          503,
        );
      }
    }),
  );
  try {
    await audit(actorId, "account.delete.with-portfolio", targetId);
  } catch {
    console.error("[admin/accounts] deletion audit write failed");
  }
}
