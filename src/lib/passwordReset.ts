import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./dataDir";

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

type PasswordResetToken = {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
};

const DATA_DIR = getDataDir(import.meta.url);
const TOKENS_PATH = path.join(DATA_DIR, "password-reset-tokens.json");

function readTokens(): PasswordResetToken[] {
  if (!fs.existsSync(TOKENS_PATH)) return [];
  const raw = fs.readFileSync(TOKENS_PATH, "utf8");
  if (!raw.trim()) return [];

  try {
    return JSON.parse(raw) as PasswordResetToken[];
  } catch {
    return [];
  }
}

function writeTokens(tokens: PasswordResetToken[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function validTokens(now = Date.now()) {
  return readTokens().filter(
    (entry) => new Date(entry.expiresAt).getTime() > now,
  );
}

export function createPasswordResetToken(userId: string) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString("base64url");
  const tokens = validTokens(now).filter((entry) => entry.userId !== userId);

  tokens.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PASSWORD_RESET_TTL_MS).toISOString(),
  });
  writeTokens(tokens);

  return token;
}

export function findPasswordResetToken(token: string) {
  if (!token) return null;
  const now = Date.now();
  const tokens = validTokens(now);
  const tokenHash = hashToken(token);
  const entry = tokens.find((candidate) => {
    const actual = Buffer.from(candidate.tokenHash, "hex");
    const expected = Buffer.from(tokenHash, "hex");
    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  });

  if (tokens.length !== readTokens().length) writeTokens(tokens);
  return entry ?? null;
}

export function consumePasswordResetToken(token: string) {
  const tokenHash = hashToken(token);
  const tokens = validTokens();
  const entry = tokens.find((candidate) => candidate.tokenHash === tokenHash);
  if (!entry) return null;

  writeTokens(
    tokens.filter(
      (candidate) =>
        candidate.tokenHash !== tokenHash && candidate.userId !== entry.userId,
    ),
  );
  return entry;
}

export function revokePasswordResetToken(token: string) {
  if (!token) return;
  const tokenHash = hashToken(token);
  writeTokens(
    validTokens().filter((candidate) => candidate.tokenHash !== tokenHash),
  );
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
