export const inquiries = [
  "入会希望",
  "見学・体験希望",
  "撮影依頼",
  "その他",
] as const;
export function validateContact(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("入力を確認してください。");
  const value = input as Record<string, unknown>,
    result: Record<string, string> = {};
  for (const [key, max] of Object.entries({
    name: 80,
    furigana: 100,
    institution: 200,
    faculty: 100,
    grade: 30,
    email: 254,
    inquiry: 30,
    message: 5000,
  })) {
    if (typeof value[key] !== "string" || value[key].length > max)
      throw new Error("入力の文字数・形式を確認してください。");
    result[key] = value[key].trim();
  }
  for (const key of [
    "name",
    "furigana",
    "institution",
    "grade",
    "email",
    "inquiry",
  ])
    if (!result[key]) throw new Error("必須項目を入力してください。");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email) ||
    /[\r\n]/.test(result.name)
  )
    throw new Error("お名前・メールアドレスを確認してください。");
  if (!inquiries.includes(result.inquiry as (typeof inquiries)[number]))
    throw new Error("お問い合わせ内容を選択してください。");
  if (result.inquiry === "その他" && !result.message)
    throw new Error("お問い合わせ詳細を入力してください。");
  return result;
}
