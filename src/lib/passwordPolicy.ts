export const MIN_PASSWORD_LENGTH = 7;
export const MAX_PASSWORD_LENGTH = 1024;
export const PASSWORD_REQUIREMENTS =
  "パスワードは7文字以上で、半角英大文字・半角英小文字・数字・記号をそれぞれ1文字以上含めてください。";
export const PASSWORD_POLICY_ERROR =
  `${PASSWORD_REQUIREMENTS} 上限は${MAX_PASSWORD_LENGTH}文字です。`;
// Use the same Unicode-aware expression for HTML constraints and server checks.
// Spaces and letters from other scripts do not count as punctuation or symbols.
export const PASSWORD_PATTERN = String.raw`(?=[\s\S]*[A-Z])(?=[\s\S]*[a-z])(?=[\s\S]*[0-9])(?=[\s\S]*[\p{P}\p{S}])[\s\S]{${MIN_PASSWORD_LENGTH},}`;
const passwordPattern = new RegExp(`^(?:${PASSWORD_PATTERN})$`, "u");

export function validNewPassword(password: string) {
  return password.length <= MAX_PASSWORD_LENGTH && passwordPattern.test(password);
}
