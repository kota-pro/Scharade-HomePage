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

function isProd() {
  return process.env.NODE_ENV === "production";
}

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return json(500, { ok: false, message: "Missing Instagram env vars." });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("ig_state")?.value;
  const next = cookies.get("ig_next")?.value || "/";

  cookies.delete("ig_state", { path: "/" });
  cookies.delete("ig_next", { path: "/" });

  if (!code) return json(400, { ok: false, message: "Missing code." });
  if (!state || !expectedState || state !== expectedState) {
    return json(400, { ok: false, message: "Invalid state." });
  }

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);
  form.set("code", code);

  const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    return json(502, { ok: false, message: "Token exchange failed.", detail: text });
  }

  const tokenJson = (await tokenRes.json()) as any;
  const accessToken = String(tokenJson?.access_token ?? "");
  const igUserId = String(tokenJson?.user_id ?? "");

  if (!accessToken || !igUserId) {
    return json(502, { ok: false, message: "Invalid token response." });
  }

  let username: string | undefined;
  try {
    const meUrl = new URL("https://graph.instagram.com/me");
    meUrl.searchParams.set("fields", "id,username");
    meUrl.searchParams.set("access_token", accessToken);

    const meRes = await fetch(meUrl);
    if (meRes.ok) {
      const me = (await meRes.json()) as any;
      username = me?.username ? String(me.username) : undefined;
    }
  } catch {
  }

  const users = readJson<User[]>(USERS_PATH, []);
  let user = users.find((u) => u.providers?.instagram?.id === igUserId);

  if (!user) {
    user = {
      id: crypto.randomUUID(),
      name: username ? username : "Instagram User",
      email: "",
      approved: true,
      createdAt: new Date().toISOString(),
      providers: { instagram: { id: igUserId, username } },
    };
    users.push(user);
  } else {
    user.providers.instagram = { id: igUserId, username };
  }

  writeJson(USERS_PATH, users);

  const sessions = readJson<Session[]>(SESSIONS_PATH, []);
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const maxAgeSeconds = 60 * 60 * 8;
  const expiresAt = new Date(now + maxAgeSeconds * 1000).toISOString();

  const pruned = sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  pruned.push({ id: sessionId, userId: user.id, createdAt: new Date(now).toISOString(), expiresAt });
  writeJson(SESSIONS_PATH, pruned);

  cookies.set("session", sessionId, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });

  return redirect(next);
};
