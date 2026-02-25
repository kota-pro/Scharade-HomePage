import fs from "node:fs";
import path from "node:path";

export type User = {
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
  portfolioId?: string | null;
};

export type Session = {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const SESSIONS_PATH = path.join(DATA_DIR, "sessions.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, fallback: T): T {
  ensureDataDir();
  if (!fs.existsSync(file)) return fallback;
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) return fallback;
  return JSON.parse(raw) as T;
}

function writeJson<T>(file: string, data: T) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function readUsers(): User[] {
  return readJson<User[]>(USERS_PATH, []);
}

export function writeUsers(users: User[]) {
  writeJson(USERS_PATH, users);
}

export function readSessions(): Session[] {
  return readJson<Session[]>(SESSIONS_PATH, []);
}

export function writeSessions(sessions: Session[]) {
  writeJson(SESSIONS_PATH, sessions);
}

function parseCookies(header: string | null) {
  if (!header) return {} as Record<string, string>;
  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [name, ...rest] = part.trim().split("=");
    if (!name) return acc;
    acc[name] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function pruneExpiredSessions(sessions: Session[]): Session[] {
  const now = Date.now();
  return sessions.filter((session) => new Date(session.expiresAt).getTime() > now);
}

export function getUserFromSession(sessionId?: string) {
  if (!sessionId) return { user: null, session: null };

  const sessions = readSessions();
  const validSessions = pruneExpiredSessions(sessions);
  if (validSessions.length !== sessions.length) {
    writeSessions(validSessions);
  }

  const session = validSessions.find((entry) => entry.id === sessionId);
  if (!session) return { user: null, session: null };

  const users = readUsers();
  const user = users.find((u) => u.id === session.userId) ?? null;

  if (!user) {
    writeSessions(validSessions.filter((entry) => entry.id !== sessionId));
    return { user: null, session: null };
  }

  return { user, session };
}

export function getUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies.session;
  return getUserFromSession(sessionId);
}
