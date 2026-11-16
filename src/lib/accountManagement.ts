import crypto from "node:crypto";
import { accountRole } from "./roles.ts";
import { isAdmin, isExecutive, canManageAccount, updateUsers, type User } from "./auth.ts";
import { revokeUserPasswordResetTokens } from "./passwordReset.ts";
import { audit } from "./audit.ts";
import { isMemberAccount } from "./accountVisibility.ts";

export function accountRegistration(user: User) {
  return {
    name: user.name ?? "",
    email: user.email,
    portfolioName: user.portfolioName ?? "",
    role: accountRole(user),
  };
}

export function accountRevision(user: User) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(accountRegistration(user)))
    .digest("hex");
}

export class AccountUpdateError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function updateAccountRegistration(
  actorId: string,
  targetId: string,
  input: unknown,
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AccountUpdateError("入力形式が正しくありません。", 400);
  const data = input as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        !["name", "email", "portfolioName", "role", "revision"].includes(key),
    ) ||
    ["name", "email", "portfolioName", "role", "revision"].some(
      (key) => typeof data[key] !== "string",
    )
  )
    throw new AccountUpdateError(
      "編集できる項目と入力形式を確認してください。",
      400,
    );
  const name = (data.name as string).trim();
  const email = (data.email as string).trim().toLowerCase();
  const portfolioName = (data.portfolioName as string).trim();
  if (data.role !== "member" && data.role !== "staff" && data.role !== "executive" && data.role !== "admin")
    throw new AccountUpdateError(
      "権限は一般会員・運営・幹部・管理者から選択してください。",
      400,
    );
  const role = data.role;
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    throw new AccountUpdateError(
      "アカウント名は80文字以内で入力してください。",
      400,
    );
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /[\u0000-\u001f\u007f]/.test(email)
  )
    throw new AccountUpdateError("メールアドレスを確認してください。", 400);
  if (portfolioName.length > 50 || /[\u0000-\u001f\u007f]/.test(portfolioName))
    throw new AccountUpdateError(
      "登録時のPortfolio名は50文字以内で入力してください。",
      400,
    );

  let emailChanged = false;
  let roleChanged = false;
  let changed = false;
  let relink = false;
  await updateUsers((users) => {
    // Recheck the actor under the same lock as the write.
    const actor = users.find((user) => user.id === actorId);
    if (!isExecutive(actor))
      throw new AccountUpdateError("幹部以上の権限が必要です。", 403);
    const user = users.find((user) => user.id === targetId);
    if (!user)
      throw new AccountUpdateError(
        "該当するアカウントが見つかりませんでした。",
        404,
      );
    if (!canManageAccount(actor, user) || (!isAdmin(actor) && (role === "executive" || role === "admin")))
      throw new AccountUpdateError("このアカウントや権限を変更する権限がありません。", 403);
    if (data.revision !== accountRevision(user))
      throw new AccountUpdateError(
        "ほかの操作で登録内容が更新されました。入力内容を控えてからページを再読み込みしてください。",
        409,
      );
    if (
      users.some(
        (other) =>
          other.id !== targetId && other.email.trim().toLowerCase() === email,
      )
    )
      throw new AccountUpdateError(
        "このメールアドレスは別のアカウントで使用されています。",
        409,
      );
    emailChanged = user.email.trim().toLowerCase() !== email;
    roleChanged = (user.role ?? "member") !== role;
    if (
      roleChanged &&
      role !== "admin" &&
      isAdmin(user) &&
      !users.some((other) => other.id !== user.id && isAdmin(other))
    )
      throw new AccountUpdateError(
        "最後の承認済み管理者は降格できません。先に別の承認済みアカウントを管理者にしてください。",
        409,
      );
    changed =
      user.name !== name ||
      user.email !== email ||
      (user.portfolioName ?? "") !== portfolioName ||
      roleChanged;
    if (emailChanged || roleChanged) {
      // Invalidate sessions and reset links before changing identity or privileges.
      revokeUserPasswordResetTokens(user.id);
      user.authVersion = (user.authVersion ?? 0) + 1;
    }
    const nameChanged = user.name !== name;
    user.name = name;
    user.email = email;
    if (roleChanged) user.role = role;
    if (portfolioName) user.portfolioName = portfolioName;
    else delete user.portfolioName;
    if (nameChanged && isMemberAccount(user)) {
      user.rosterRelink = { id: crypto.randomUUID(), name, attempts: 0, nextAttemptAt: 0 };
      relink = true;
    }
  });
  if (changed) {
    try {
      await audit(
        actorId,
        roleChanged ? "account.role.update" : "account.registration.update",
        targetId,
      );
    } catch {
      console.error("[admin/accounts] audit write failed after saving");
    }
  }
  let rosterSync: "linked" | "unlinked" | "pending" | undefined;
  if (relink) {
    const { syncAccountRosterAfterRename } = await import("./accountSetup.ts");
    rosterSync = await syncAccountRosterAfterRename(targetId);
  }
  return {
    ...(rosterSync ? { rosterSync } : {}),
    emailChanged,
    roleChanged,
    reauthenticate: (emailChanged || roleChanged) && actorId === targetId,
  };
}
