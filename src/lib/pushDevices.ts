import crypto from "node:crypto";
import { getUserFromSession } from "./auth.ts";
import { securityHash } from "./mfaState.ts";
import { withStoreLock } from "./store.ts";
import { readPushDevices, writePushDevices } from "./pushDeviceState.ts";

export class PushInputError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
function inputObject(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PushInputError("入力形式を確認してください。");
  return input as Record<string, unknown>;
}
function installation(input: Record<string, unknown>) {
  if (
    typeof input.installationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.installationId,
    ) ||
    typeof input.installationSecret !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.installationSecret)
  )
    throw new PushInputError("端末情報を確認してください。");
  return {
    id: input.installationId,
    hash: securityHash(input.installationSecret),
  };
}
export async function updatePushDevice(
  sessionToken: string,
  input: unknown,
  remove = false,
) {
  const p = inputObject(input),
    { id, hash } = installation(p);
  const keys = remove
    ? ["installationId", "installationSecret"]
    : [
        "installationId",
        "installationSecret",
        "token",
        "platform",
        "enabled",
        "remindersEnabled",
      ];
  if (Object.keys(p).some((key) => !keys.includes(key)))
    throw new PushInputError("変更できる端末情報を確認してください。");
  if (
    !remove &&
    (typeof p.token !== "string" ||
      !/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(
        p.token,
      ) ||
      !["ios", "android"].includes(String(p.platform)) ||
      typeof p.enabled !== "boolean" ||
      typeof p.remindersEnabled !== "boolean")
  )
    throw new PushInputError("通知の登録内容を確認してください。");
  return withStoreLock("auth", () => {
    const { user, session } = getUserFromSession(sessionToken);
    if (!user || !session)
      throw new PushInputError("再度ログインしてください。", 401);
    return withStoreLock("push-devices", () => {
      const data = readPushDevices(),
        previous = data.devices.find((d) => d.id === id);
      if (
        previous &&
        !crypto.timingSafeEqual(
          Buffer.from(previous.secretHash),
          Buffer.from(hash),
        )
      )
        throw new PushInputError("端末の登録を確認できません。", 403);
      if (remove) {
        // Possession of this installation's secret also allows unbinding a previous account on a shared phone.
        data.devices = data.devices.filter((d) => d.id !== id);
        writePushDevices(data);
        return { ok: true };
      }
      // One OS token can belong to one current installation/account. Reinstallation and account switching replace it.
      data.devices = data.devices.filter(
        (d) => d.id !== id && d.token !== p.token,
      );
      const unchanged =
        previous &&
        previous.userId === user.id &&
        previous.authVersion === (user.authVersion ?? 0) &&
        previous.token === p.token &&
        previous.enabled === p.enabled &&
        previous.remindersEnabled === p.remindersEnabled;
      const now = new Date().toISOString();
      data.devices.push({
        id,
        secretHash: hash,
        userId: user.id,
        authVersion: user.authVersion ?? 0,
        sessionId: session.id,
        token: p.token as string,
        platform: p.platform as "ios" | "android",
        enabled: p.enabled as boolean,
        remindersEnabled: p.remindersEnabled as boolean,
        generation: unchanged ? previous.generation : crypto.randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
      // Bound storage for abandoned installations without discarding another member's active devices.
      const own = data.devices
        .filter((d) => d.userId === user.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const retired = new Set(own.slice(10).map((d) => d.id));
      data.devices = data.devices.filter((d) => !retired.has(d.id));
      writePushDevices(data);
      return {
        ok: true,
        enabled: p.enabled,
        remindersEnabled: p.remindersEnabled,
      };
    });
  });
}
