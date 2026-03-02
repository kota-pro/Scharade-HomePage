import type { APIRoute } from "astro";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

type Session = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readSessions(): Session[] {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_PATH)) return [];
  const raw = fs.readFileSync(SESSIONS_PATH, "utf8");
  if (!raw.trim()) return [];
  return JSON.parse(raw) as Session[];
}

function writeSessions(sessions: Session[]) {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), "utf8");
}

export const POST: APIRoute = async ({ cookies }) => {
  const sessionId = cookies.get("session")?.value;

  if (sessionId) {
    const sessions = readSessions();
    writeSessions(sessions.filter((s) => s.id !== sessionId));
  }

  cookies.delete("session", { path: "/" });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
