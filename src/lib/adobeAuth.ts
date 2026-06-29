import fs from "node:fs";
import path from "node:path";
import { getDataDir } from "./dataDir";

const CLIENT_ID = import.meta.env.ADOBE_CLIENT_ID;
const CLIENT_SECRET = import.meta.env.ADOBE_CLIENT_SECRET;
const INITIAL_REFRESH_TOKEN = import.meta.env.ADOBE_REFRESH_TOKEN;

const DATA_DIR = getDataDir(import.meta.url);
const ADOBE_AUTH_PATH = path.join(DATA_DIR, "adobe-auth.json");

type AdobeAuthState = {
  accessToken: string | null;
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  updatedAt: string | null;
};

const DEFAULT_STATE: AdobeAuthState = {
  accessToken: null,
  accessTokenExpiresAt: 0,
  refreshToken: null,
  updatedAt: null,
};

let inMemoryState: AdobeAuthState | null = null;
let pendingRefresh: Promise<string> | null = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStateFromDisk(): AdobeAuthState {
  ensureDataDir();
  if (!fs.existsSync(ADOBE_AUTH_PATH)) {
    return {
      ...DEFAULT_STATE,
      refreshToken: INITIAL_REFRESH_TOKEN ?? null,
    };
  }

  try {
    const raw = fs.readFileSync(ADOBE_AUTH_PATH, "utf8");
    if (!raw.trim()) {
      return {
        ...DEFAULT_STATE,
        refreshToken: INITIAL_REFRESH_TOKEN ?? null,
      };
    }

    const parsed = JSON.parse(raw) as Partial<AdobeAuthState>;
    return {
      accessToken:
        typeof parsed.accessToken === "string" ? parsed.accessToken : null,
      accessTokenExpiresAt:
        typeof parsed.accessTokenExpiresAt === "number"
          ? parsed.accessTokenExpiresAt
          : 0,
      refreshToken:
        typeof parsed.refreshToken === "string"
          ? parsed.refreshToken
          : INITIAL_REFRESH_TOKEN ?? null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch (error) {
    console.error("[Adobe Auth] Failed to read cached auth state:", error);
    return {
      ...DEFAULT_STATE,
      refreshToken: INITIAL_REFRESH_TOKEN ?? null,
    };
  }
}

function writeStateToDisk(state: AdobeAuthState) {
  ensureDataDir();
  fs.writeFileSync(ADOBE_AUTH_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getState() {
  if (!inMemoryState) {
    inMemoryState = readStateFromDisk();
  }

  // Keep legacy env-based refresh token as fallback bootstrap.
  if (!inMemoryState.refreshToken && INITIAL_REFRESH_TOKEN) {
    inMemoryState = {
      ...inMemoryState,
      refreshToken: INITIAL_REFRESH_TOKEN,
    };
  }

  return inMemoryState;
}

function saveState(nextState: AdobeAuthState) {
  inMemoryState = nextState;
  writeStateToDisk(nextState);
}

async function refreshAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      "Adobe OAuth is not configured. Missing ADOBE_CLIENT_ID or ADOBE_CLIENT_SECRET.",
    );
  }

  const state = getState();
  if (!state.refreshToken) {
    throw new Error(
      "Adobe refresh token is not configured. Run the initial Adobe authorization first.",
    );
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("client_id", CLIENT_ID);
  params.append("client_secret", CLIENT_SECRET);
  params.append("refresh_token", state.refreshToken);

  const response = await fetch("https://ims-na1.adobelogin.com/ims/token/v3", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[Adobe Auth] Token refresh failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(
      `Adobe token refresh failed (${response.status}). Stored refresh token may be expired or revoked.`,
    );
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number | string;
    refresh_token?: string;
  };

  if (!data.access_token) {
    throw new Error("Adobe token refresh succeeded without access_token.");
  }

  const expiresInRaw =
    typeof data.expires_in === "string"
      ? Number(data.expires_in)
      : data.expires_in;
  const expiresInMs =
    Number.isFinite(expiresInRaw) && typeof expiresInRaw === "number"
      ? expiresInRaw
      : 86_400_000;

  const nextState: AdobeAuthState = {
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + expiresInMs,
    refreshToken: data.refresh_token || state.refreshToken,
    updatedAt: new Date().toISOString(),
  };

  saveState(nextState);
  return data.access_token;
}

export async function getAdobeAccessToken(): Promise<string> {
  const state = getState();

  if (state.accessToken && Date.now() < state.accessTokenExpiresAt - 60_000) {
    return state.accessToken;
  }

  if (!pendingRefresh) {
    pendingRefresh = refreshAccessToken().finally(() => {
      pendingRefresh = null;
    });
  }

  return pendingRefresh ?? refreshAccessToken();
}
