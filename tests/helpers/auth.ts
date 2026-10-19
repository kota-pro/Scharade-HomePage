import { readUsers, createSession } from "../../src/lib/auth.ts";
import { startMfaChallenge, completeMfaChallenge } from "../../src/lib/mfa.ts";

/** Exercise real email proof and grants when a unit fixture needs a privileged session. */
export async function privilegedSession(userId: string, seconds = 300) {
  process.env.MFA_ENCRYPTION_KEY = "ab".repeat(32);
  const user = readUsers().find(u => u.id === userId)!;
  let emailCode = "";
  const challenge = await startMfaChallenge(user, "/", seconds, async (_email, code) => { emailCode = code; });
  const completed = await completeMfaChallenge(challenge.token, emailCode);
  return createSession(userId, seconds, user.passwordHash, user.email, completed.grant);
}
