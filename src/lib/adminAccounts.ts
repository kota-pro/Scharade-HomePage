import type { User } from "./auth.ts";
import {
  genderLabels,
  gradeLabels,
  type ActivityRoster,
} from "./activityTypes.ts";

// Name matches are only suggestions; display only the administrator's confirmed binding.
export function toAdminAccountRoster(
  accountId: string,
  roster?: ActivityRoster,
) {
  const key = roster?.bindings[accountId];
  const record = key
    ? [...(roster?.records || []), ...(roster?.retiredRecords || [])].find(
        (row) => row.key === key,
      )
    : undefined;
  const fields: [string, string][] = record
    ? [
        ["名簿上の氏名", record.name],
        ["LINE名", record.lineName || "未記入"],
        ["大学名", record.university || "未記入"],
        ["性別", record.gender ? genderLabels[record.gender] : "要確認"],
        ["学年", record.grade ? gradeLabels[record.grade] : "要確認"],
        [
          "継続状況",
          record.withdrawnAt
            ? "退会（旧名簿の情報）"
            : record.active
              ? "継続する"
              : "継続対象外",
        ],
      ]
    : [];
  return {
    status: !roster
      ? "Google名簿はまだ取得されていません。"
      : !key
        ? "未連携です。Google名簿の連携画面で本人の回答を確認してください。"
        : !record
          ? "連携先の回答が現在の名簿に見つかりません。連携内容を確認してください。"
          : record.withdrawnAt
            ? "新しい名簿に氏名がないため退会扱いです。以下は旧名簿の情報です。"
            : !record.active
              ? "連携済みですが、現在は継続対象外です。"
              : "連携済み",
    fields,
    title: roster?.title || "",
    fetchedAt: roster?.fetchedAt || "",
    source: roster
      ? { spreadsheetId: roster.spreadsheetId, sheetId: roster.sheetId }
      : undefined,
  };
}

// Explicit display fields only: never pass password hashes or session data to a view.
export function toAdminAccount(user: User) {
  return {
    id: user.id,
    name: user.name || "未登録",
    email: user.email,
    portfolioName: user.portfolioName || "記録なし",
    portfolioId: user.portfolioId || null,
    role:
      user.role === "admin"
        ? "管理者"
        : user.role === "staff"
          ? "運営"
          : "一般会員",
    status: user.approved ? "承認済み" : "未承認",
    approved: Boolean(user.approved),
    createdAt: user.createdAt || "",
    approvalNotifiedAt: user.approvalNotifiedAt || "",
    credentials: Boolean(user.providers?.credentials),
    instagramLinked: Boolean(user.providers?.instagram),
    instagramUsername: user.providers?.instagram?.username || "",
  };
}

export type AdminAccount = ReturnType<typeof toAdminAccount>;

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function accountDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? dateFormatter.format(timestamp)
    : "記録なし";
}
