import crypto from "node:crypto";
import { readUsers } from "./auth.ts";
import { readActivities } from "./activities.ts";
import { readExhibitions } from "./exhibitions.ts";
import { readPushDevices, writePushDevices } from "./pushDeviceState.ts";
import { pushQueue } from "./pushQueue.ts";
import { reminderAudience } from "./reminderRules.ts";
import { withStoreLock, writeData } from "./store.ts";
import { env } from "./config.ts";
import type { PushJob } from "./pushTypes.ts";

type Claim = {
  id: string;
  lease: string;
  ticketId?: string;
  token: string;
  title: string;
  noticeId: string;
  unread: number;
  ttl: number;
};
type ProviderResult = {
  status?: string;
  id?: string;
  details?: { error?: string };
};
const knownErrors = new Set([
  "DeviceNotRegistered",
  "MessageTooBig",
  "MessageRateExceeded",
  "InvalidCredentials",
  "MismatchSenderId",
]);
const providerError = (value: ProviderResult) =>
  knownErrors.has(String(value.details?.error))
    ? value.details!.error!
    : "provider-error";

async function claimJobs(now: number): Promise<Claim[]> {
  return withStoreLock("auth", () =>
    withStoreLock("exhibitions", () =>
      withStoreLock("member-activities", () => {
        const data = readActivities(),
          devices = readPushDevices().devices,
          users = readUsers(),
          exhibitions = readExhibitions(),
          claims: Claim[] = [];
        for (const job of pushQueue(data).jobs) {
          if (claims.length >= 100) break;
          if (
            !["pending", "receipt"].includes(job.status) ||
            job.nextAttemptAt > now ||
            (job.leaseUntil ?? 0) > now
          )
            continue;
          const notice = data.notifications.find((n) => n.id === job.noticeId),
            device = devices.find(
              (d) => d.id === job.deviceId && d.generation === job.generation,
            );
          const user =
            device &&
            users.find(
              (u) =>
                u.id === device.userId &&
                u.approved &&
                !u.mustResetPassword &&
                (u.authVersion ?? 0) === device.authVersion,
            );
          const event = notice?.eventId
            ? data.events.find((e) => e.id === notice.eventId)
            : undefined;
          const audience = notice?.reminder
            ? reminderAudience(notice.reminder, data, exhibitions, users, now)
            : undefined;
          if (
            job.expiresAt <= now ||
            !notice ||
            !device?.enabled ||
            !user ||
            !notice.recipientIds.includes(user.id) ||
            (job.status === "pending" &&
              (notice.readBy[user.id] ||
                (notice.eventId &&
                  (!event ||
                    (event.status === "cancelled" &&
                      notice.kind !== "cancellation"))) ||
                (notice.reminder &&
                  (!device.remindersEnabled ||
                    !audience?.recipients.includes(user.id)))))
          ) {
            job.status = "done";
            job.error = "expired-or-no-longer-eligible";
            delete job.leaseToken;
            delete job.leaseUntil;
            continue;
          }
          job.leaseToken = crypto.randomUUID();
          job.leaseUntil = now + 120_000;
          if (job.status === "pending") job.attempts++;
          claims.push({
            id: job.id,
            lease: job.leaseToken,
            ticketId: job.ticketId,
            token: device.token,
            title: Array.from(notice.title).slice(0, 180).join(""),
            noticeId: notice.id,
            unread: data.notifications.filter(
              (n) => n.recipientIds.includes(user.id) && !n.readBy[user.id],
            ).length,
            ttl: Math.max(
              1,
              Math.min(86400, Math.floor((job.expiresAt - now) / 1000)),
            ),
          });
        }
        writeData("member-activities.json", data);
        return claims;
      }),
    ),
  );
}
type Outcome = {
  claim: Claim;
  result?: ProviderResult;
  receipt?: boolean;
  missingReceipt?: boolean;
  networkError?: boolean;
};
async function settle(outcomes: Outcome[], now: number) {
  return withStoreLock("auth", () =>
    withStoreLock("member-activities", () =>
      withStoreLock("push-devices", () => {
        const data = readActivities(),
          devices = readPushDevices();
        let changedDevices = false;
        for (const {
          claim,
          result,
          receipt,
          missingReceipt,
          networkError,
        } of outcomes) {
          const job = pushQueue(data).jobs.find(
            (j) => j.id === claim.id && j.leaseToken === claim.lease,
          );
          if (!job) continue;
          delete job.leaseToken;
          delete job.leaseUntil;
          if (networkError || missingReceipt) {
            job.nextAttemptAt =
              now +
              (receipt
                ? 60_000
                : Math.min(
                    900_000,
                    30_000 * 2 ** Math.min(job.attempts - 1, 5),
                  ));
            job.error = missingReceipt
              ? "receipt-not-ready"
              : "network-or-provider-unavailable";
            if (!receipt && job.attempts >= 8) job.status = "failed";
          } else if (result?.status === "ok") {
            delete job.error;
            if (receipt) job.status = "done";
            else {
              job.status = "receipt";
              job.ticketId = result.id;
              job.nextAttemptAt = now + 15 * 60_000;
            }
          } else {
            const error = result ? providerError(result) : "provider-error";
            job.error = error;
            if (error === "DeviceNotRegistered") {
              devices.devices = devices.devices.filter(
                (d) => d.id !== job.deviceId || d.generation !== job.generation,
              );
              changedDevices = true;
              job.status = "failed";
            } else if (
              error === "MessageTooBig" ||
              error === "MismatchSenderId"
            )
              job.status = "failed";
            else {
              job.status = "pending";
              delete job.ticketId;
              job.nextAttemptAt =
                now +
                (error === "InvalidCredentials"
                  ? 30 * 60_000
                  : Math.min(
                      900_000,
                      30_000 * 2 ** Math.min(job.attempts - 1, 5),
                    ));
              if (job.attempts >= 8) job.status = "failed";
            }
          }
        }
        if (changedDevices) writePushDevices(devices);
        writeData("member-activities.json", data);
      }),
    ),
  );
}

/** Receipts prove handoff to APNs/FCM, never that a person saw the notification. */
export async function drainPushQueue(
  options: {
    fetch?: typeof fetch;
    clock?: () => number;
    enabled?: boolean;
  } = {},
) {
  if (!(options.enabled ?? env("PUSH_DELIVERY_ENABLED") === "1"))
    return { attempted: 0 };
  const send = options.fetch ?? fetch,
    clock = options.clock ?? Date.now,
    claims = await claimJobs(clock());
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(env("EXPO_ACCESS_TOKEN")
      ? { Authorization: `Bearer ${env("EXPO_ACCESS_TOKEN")}` }
      : {}),
  };
  for (const receipt of [false, true]) {
    const batch = claims.filter((c) => Boolean(c.ticketId) === receipt);
    if (!batch.length) continue;
    let outcomes: Outcome[];
    try {
      const response = await send(
        `https://exp.host/--/api/v2/push/${receipt ? "getReceipts" : "send"}`,
        {
          method: "POST",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify(
            receipt
              ? { ids: batch.map((c) => c.ticketId) }
              : batch.map((c) => ({
                  to: c.token,
                  title: c.title,
                  sound: "default",
                  badge: c.unread,
                  ttl: c.ttl,
                  channelId: "member-notices",
                  data: { version: 1, notificationId: c.noticeId },
                })),
          ),
        },
      );
      if (!response.ok) throw new Error("provider-http-error");
      const payload = (await response.json()) as { data?: unknown };
      if (receipt) {
        if (
          !payload.data ||
          typeof payload.data !== "object" ||
          Array.isArray(payload.data)
        )
          throw new Error("invalid-receipts");
        outcomes = batch.map((claim) => {
          const result = (payload.data as Record<string, ProviderResult>)[
            claim.ticketId!
          ];
          if (result && !["ok", "error"].includes(String(result.status)))
            throw new Error("invalid-receipt");
          return { claim, result, receipt: true, missingReceipt: !result };
        });
      } else {
        if (
          !Array.isArray(payload.data) ||
          payload.data.length !== batch.length ||
          payload.data.some(
            (r) =>
              !r ||
              !["ok", "error"].includes(r.status) ||
              (r.status === "ok" &&
                (typeof r.id !== "string" ||
                  !r.id.length ||
                  r.id.length > 200)),
          )
        )
          throw new Error("invalid-tickets");
        outcomes = batch.map((claim, index) => ({
          claim,
          result: (payload.data as ProviderResult[])[index],
        }));
      }
    } catch {
      outcomes = batch.map((claim) => ({ claim, receipt, networkError: true }));
    }
    await settle(outcomes, clock());
  }
  return { attempted: claims.length };
}

export function pushDiagnostics(jobs: PushJob[]) {
  return {
    pending: jobs.filter((j) => j.status === "pending").length,
    awaitingReceipts: jobs.filter((j) => j.status === "receipt").length,
    failed: jobs.filter((j) => j.status === "failed").length,
  };
}
