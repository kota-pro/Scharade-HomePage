import crypto from "node:crypto";
import { readData, writeData } from "./store.ts";

export type MfaChallenge = {
  userId: string; authVersion: number; passwordFingerprint: string; emailFingerprint: string;
  expiresAt: number; attempts: number; returnPath: string; maxAge: number;
  emailCodeHash: string; delivered: boolean; deliveryId: string;
};
export type MfaDelivery = { windowStart: number; lastSentAt: number; sent: number; failedAttempts: number };
export type MfaState = {
  version: 2; method: "email"; challenges: Record<string, MfaChallenge>;
  deliveries: Record<string, MfaDelivery>;
  grants: Record<string, { userId: string; authVersion: number; passwordFingerprint: string; emailFingerprint: string; expiresAt: number; method: "email" }>;
};
export const securityHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export const emptyMfaState = (): MfaState => ({ version: 2, method: "email", challenges: {}, deliveries: {}, grants: {} });
const objectMap = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value);
export function readMfaState(): MfaState {
  const state = readData<any>("auth-security.json", emptyMfaState());
  // Old app enrollments, recovery codes and grants never authorize email MFA.
  // Deployment backs up this file before persisting the new format.
  if (state.version === 1 && objectMap(state.accounts) && objectMap(state.challenges) && objectMap(state.grants)) return emptyMfaState();
  if (state.version !== 2 || state.method !== "email" || !objectMap(state.challenges) || !objectMap(state.deliveries) || !objectMap(state.grants)) throw new Error("認証保護データを読み込めません。");
  return state;
}
/** Caller holds the auth lock, shared with sessions, account changes and resets. */
export function writeMfaState(state: MfaState) {
  for (const [key, value] of Object.entries(state.challenges)) if (value.expiresAt <= Date.now()) delete state.challenges[key];
  for (const [key, value] of Object.entries(state.grants)) if (value.expiresAt <= Date.now()) delete state.grants[key];
  for (const [key, value] of Object.entries(state.deliveries)) if (value.windowStart + 15 * 60_000 <= Date.now()) delete state.deliveries[key];
  writeData("auth-security.json", state);
}
export function consumeMfaGrant(userId: string, authVersion: number, passwordHash: string, email: string, token?: string) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const state = readMfaState(), key = securityHash(token), grant = state.grants[key];
  if (!grant || grant.method !== "email" || grant.userId !== userId || grant.authVersion !== authVersion || grant.expiresAt <= Date.now() || grant.passwordFingerprint !== securityHash(passwordHash) || grant.emailFingerprint !== securityHash(email)) return false;
  delete state.grants[key]; writeMfaState(state); return true;
}
