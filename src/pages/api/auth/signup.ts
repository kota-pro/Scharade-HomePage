import type { APIRoute } from "astro";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), ".data");
const USERS_PATH = path.join(DATA_DIR, "users.json");

const SERVICE_DOMAIN =
  (import.meta as any).env?.MICROCMS_SERVICE_DOMAIN ??
  process.env.MICROCMS_SERVICE_DOMAIN;
const API_KEY =
  (import.meta as any).env?.MICROCMS_API_KEY ?? process.env.MICROCMS_API_KEY;
const PORTFOLIO_ENDPOINT =
  (import.meta as any).env?.MICROCMS_PORTFOLIO_ENDPOINT ??
  process.env.MICROCMS_PORTFOLIO_ENDPOINT ??
  "portfolio";

type User = {
  id: string;
  name: string;
  portfolioName: string;
  email: string;
  passwordHash: string;
  approved: boolean;
  createdAt: string;
  providers: { credentials?: true };
  portfolioId?: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readUsers(): User[] {
  ensureDataDir();
  if (!fs.existsSync(USERS_PATH)) return [];
  const raw = fs.readFileSync(USERS_PATH, "utf8");
  if (!raw.trim()) return [];
  return JSON.parse(raw) as User[];
}

function writeUsers(users: User[]) {
  ensureDataDir();
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), "utf8");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const keylen = 32;
  const hash = crypto.scryptSync(password, salt, keylen);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function json(status: number, data: any) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function createPortfolioInMicroCMS(
  portfolioName: string,
): Promise<string> {
  if (!SERVICE_DOMAIN || !API_KEY) {
    const missing = [
      !SERVICE_DOMAIN ? "MICROCMS_SERVICE_DOMAIN" : null,
      !API_KEY ? "MICROCMS_API_KEY" : null,
    ].filter(Boolean);
    throw new Error(
      `microCMS is not configured. Missing: ${missing.join(", ")}`,
    );
  }

  const url = `https://${SERVICE_DOMAIN}.microcms.io/api/v1/${PORTFOLIO_ENDPOINT}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-API-KEY": API_KEY,
    },
    body: JSON.stringify({
      name: portfolioName,
      hashtags: [],
      pictures: [],
      self_introduction: "",
      instagram: "",
      x_url: "",
      camera: "",
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(
      `microCMS error (${res.status}): ${text || res.statusText}`,
    );
  }

  const data = JSON.parse(text || "{}");
  const id = (data as any).id;
  if (!id || typeof id !== "string") {
    throw new Error("microCMS did not return an id.");
  }
  return id;
}

export const POST: APIRoute = async ({ request }) => {
  let name = "";
  let portfolioName = "";
  let email = "";
  let password = "";
  let passwordConfirm = "";

  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as any;
    name = String(body?.name ?? "");
    portfolioName = String(body?.portfolioName ?? "");
    email = String(body?.email ?? "");
    password = String(body?.password ?? "");
    passwordConfirm = String(body?.passwordConfirm ?? "");
  } else {
    const form = await request.formData();
    name = String(form.get("name") ?? "");
    portfolioName = String(form.get("portfolioName") ?? "");
    email = String(form.get("email") ?? "");
    password = String(form.get("password") ?? "");
    passwordConfirm = String(form.get("passwordConfirm") ?? "");
  }

  name = name.trim();
  portfolioName = portfolioName.trim();
  email = normalizeEmail(email);

  if (!name) return json(400, { ok: false, message: "Name is required." });

  if (!portfolioName) {
    return json(400, { ok: false, message: "Portfolio name is required." });
  }
  if (portfolioName.length > 50) {
    return json(400, {
      ok: false,
      message: "Portfolio name is too long (max 50).",
    });
  }

  if (!email) return json(400, { ok: false, message: "Email is required." });
  if (password.length < 8) {
    return json(400, {
      ok: false,
      message: "Password must be at least 8 characters.",
    });
  }
  if (password !== passwordConfirm) {
    return json(400, { ok: false, message: "Passwords do not match." });
  }

  const users = readUsers();
  if (users.some((u) => u.email === email)) {
    return json(409, { ok: false, message: "Email already exists." });
  }

  let portfolioId: string;
  try {
    portfolioId = await createPortfolioInMicroCMS(portfolioName);
  } catch (err: any) {
    return json(502, {
      ok: false,
      message:
        "Account was not created because portfolio provisioning failed. " +
        (err?.message ? `(${err.message})` : ""),
    });
  }

  users.push({
    id: crypto.randomUUID(),
    name,
    portfolioName,
    email,
    passwordHash: hashPassword(password),
    approved: true,
    createdAt: new Date().toISOString(),
    providers: { credentials: true },
    portfolioId,
  });

  writeUsers(users);

  return json(200, { ok: true, message: "Account created." });
};
