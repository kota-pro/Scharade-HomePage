import { env } from "./config.ts";
import { readData, writeData, withStoreLock } from "./store.ts";
import { fetchWithTimeout } from "./http.ts";
type State = {
  accessToken: string | null;
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  updatedAt: string | null;
};
const initial = (): State => ({
  accessToken: null,
  accessTokenExpiresAt: 0,
  refreshToken: env("ADOBE_REFRESH_TOKEN") || null,
  updatedAt: null,
});
export async function getAdobeAccessToken(): Promise<string> {
  const current = readData<State>("adobe-auth.json", initial());
  if (current.accessToken && Date.now() < current.accessTokenExpiresAt - 60_000)
    return current.accessToken;
  return withStoreLock("adobe-auth", async () => {
    const state = readData<State>("adobe-auth.json", initial());
    if (state.accessToken && Date.now() < state.accessTokenExpiresAt - 60_000)
      return state.accessToken;
    const id = env("ADOBE_CLIENT_ID"),
      secret = env("ADOBE_CLIENT_SECRET");
    if (!id || !secret || !state.refreshToken)
      throw new Error("Adobe OAuth is not configured");
    const response = await fetchWithTimeout(
      "https://ims-na1.adobelogin.com/ims/token/v3",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: id,
          client_secret: secret,
          refresh_token: state.refreshToken,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`Adobe authentication: ${response.status}`);
    const data = await response.json();
    if (typeof data.access_token !== "string")
      throw new Error("Adobe access token missing");
    const expiry = Number(data.expires_in);
    // Current IMS v3 uses seconds; legacy Lightroom responses used milliseconds.
    const milliseconds =
      Number.isFinite(expiry) && expiry > 0
        ? expiry > 604800
          ? expiry
          : expiry * 1000
        : 3_600_000;
    writeData("adobe-auth.json", {
      accessToken: data.access_token,
      accessTokenExpiresAt: Date.now() + Math.min(milliseconds, 86_400_000),
      refreshToken: data.refresh_token || state.refreshToken,
      updatedAt: new Date().toISOString(),
    });
    return data.access_token as string;
  });
}
