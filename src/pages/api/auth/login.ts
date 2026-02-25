import type { APIRoute } from "astro";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

type User = {
  id: string;
  name: string;
  email: string;
  passwordHash?: string;
  approved: boolean;
  createdAt: string;
  providers: {
    credentials?: true;
    instagram?: { id: string; username?: string };
  };
  portfolioId?: string;
};

type Session = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(p: string, fallback: T): T {
  ensureDataDir();
  if (!fs.existsSync(p)) return fallback;
  const raw = fs.readFileSync(p, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}

function writeJson<T>(p: string, data: T) {
  ensureDataDir();
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [algo, saltB64, hashB64] = parts;
  if (algo !== "scrypt") return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function badRequest(message: string) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  let email = "";
  let password = "";
  let remember = false;

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as any;
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
    remember = Boolean(body?.remember ?? false);
  } else {
    const form = await request.formData();
    email = String(form.get("email") ?? "");
    password = String(form.get("password") ?? "");
    remember = form.get("remember") != null;
  }

  email = normalizeEmail(email);

  if (!email) return badRequest("Email is required.");
  if (!password) return badRequest("Password is required.");

  const users = readJson<User[]>(USERS_PATH, []);
  const user = users.find((u) => u.email === email);
  if (!user || !user.passwordHash) return badRequest("Invalid email or password.");

  if (!verifyPassword(password, user.passwordHash)) {
    return badRequest("Invalid email or password.");
  }

  if (!user.approved) {
    return new Response(JSON.stringify({ ok: false, message: "Your account is pending approval." }), {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const sessions = readJson<Session[]>(SESSIONS_PATH, []);
  const sessionId = crypto.randomUUID();

  const now = Date.now();
  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
  const expiresAt = new Date(now + maxAgeSeconds * 1000).toISOString();

  sessions.push({
    id: sessionId,
    userId: user.id,
    createdAt: new Date(now).toISOString(),
    expiresAt,
  });

  const pruned = sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  writeJson(SESSIONS_PATH, pruned);

  cookies.set("session", sessionId, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    maxAge: maxAgeSeconds,
    expires: new Date(now + maxAgeSeconds * 1000),
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
