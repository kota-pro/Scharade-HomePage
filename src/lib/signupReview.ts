import crypto from "node:crypto";

const REVIEW_SECRET =
  (import.meta as any).env?.SIGNUP_REVIEW_SECRET ??
  process.env.SIGNUP_REVIEW_SECRET;

export type ReviewAction = "approve" | "reject";

type ReviewTokenInput = {
  action: ReviewAction;
  expires: string;
  userId: string;
};

function getSecret() {
  if (!REVIEW_SECRET) {
    throw new Error("SIGNUP_REVIEW_SECRET is not configured.");
  }
  return REVIEW_SECRET;
}

function buildPayload({ action, expires, userId }: ReviewTokenInput) {
  return `${action}:${userId}:${expires}`;
}

export function createReviewSignature(input: ReviewTokenInput) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(buildPayload(input))
    .digest("hex");
}

export function verifyReviewSignature(
  input: ReviewTokenInput & { signature: string },
) {
  const expected = createReviewSignature(input);
  const actual = input.signature;

  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function assertReviewConfig() {
  getSecret();
}
