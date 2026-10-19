import crypto from "node:crypto";
import { env } from "./config.ts";

export type ReviewAction = "approve" | "reject";

type ReviewTokenInput = {
  action: ReviewAction;
  expires: string;
  userId: string;
};

function getSecret() {
  const secret = env("SIGNUP_REVIEW_SECRET");
  if (secret.length < 32) {
    throw new Error("SIGNUP_REVIEW_SECRET is not securely configured.");
  }
  return secret;
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

export function validateReviewParameters(params: URLSearchParams) {
  const action = params.get("action") as ReviewAction,
    userId = params.get("userId") ?? "",
    expires = params.get("expires") ?? "",
    signature = params.get("sig") ?? "";
  if (
    !["approve", "reject"].includes(action) ||
    !userId ||
    !signature ||
    !Number.isFinite(Date.parse(expires)) ||
    Date.parse(expires) < Date.now()
  )
    return null;
  try {
    if (!verifyReviewSignature({ action, userId, expires, signature }))
      return null;
  } catch {
    return null;
  }
  return { action, userId };
}
