import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { writeData } from "../src/lib/store.ts";
import { createSession, deleteSession, type User } from "../src/lib/auth.ts";
import { updatePushDevice } from "../src/lib/pushDevices.ts";
import { readPushDevices } from "../src/lib/pushDeviceState.ts";
import {
  activityAction,
  readActivities,
  appendExhibitionNotice,
} from "../src/lib/activities.ts";
import { emptyActivities } from "../src/lib/activityTypes.ts";
import { drainPushQueue } from "../src/lib/pushDelivery.ts";
import { createDueReminders } from "../src/lib/notificationReminders.ts";
import { DAY } from "../src/lib/pushQueue.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-push-"));
process.env.DATA_DIR = dir;
const users: User[] = ["staff", "member", "other"].map((id) => ({
  id,
  name: id,
  email: `${id}@example.invalid`,
  approved: true,
  role: id === "staff" ? "staff" : "member",
  providers: {},
  createdAt: "2026-01-01",
}));
const installationId = crypto.randomUUID(),
  installationSecret = crypto.randomBytes(32).toString("base64url");
const binding = {
  installationId,
  installationSecret,
  token: "ExpoPushToken[fixture_token_1234567890]",
  platform: "ios",
  enabled: true,
  remindersEnabled: true,
};
let now: number;
beforeEach(() => {
  now = Date.now();
  for (const file of fs.readdirSync(dir))
    fs.rmSync(path.join(dir, file), { recursive: true, force: true });
  writeData("users.json", users);
  writeData("sessions.json", []);
  writeData("member-activities.json", emptyActivities());
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));
async function device(user = "member", overrides = {}) {
  const s = await createSession(user, 3600);
  await updatePushDevice(s.token, { ...binding, ...overrides });
  return s;
}
async function notice() {
  const id = crypto.randomUUID();
  await activityAction(
    "staff",
    {
      action: "notification.send",
      id,
      recipientIds: ["member"],
      title: "件名だけ",
      body: "秘密の本文",
    },
    () => now,
  );
  return id;
}
const queue = () => readActivities().push!.jobs;
const okSend = async () =>
  Response.json({ data: [{ status: "ok", id: "receipt-1" }] });
const sendAt = (fetch: typeof globalThis.fetch = okSend, time = now) =>
  drainPushQueue({ fetch, clock: () => time, enabled: true });
async function published() {
  const iso = (days: number) => new Date(now + days * DAY).toISOString();
  const created = await activityAction(
    "staff",
    {
      action: "event.save",
      title: "撮影会",
      description: "説明",
      ownerId: "staff",
      startsAt: iso(3),
      endsAt: iso(3.5),
      deadline: iso(2),
      meeting: "",
      itinerary: "",
      fee: "",
      theme: "",
      recipientIds: ["member", "other"],
    },
    () => now,
  );
  await activityAction(
    "staff",
    { action: "event.publish", eventId: created.eventId, revision: 1 },
    () => now,
  );
  return readActivities().events[0];
}

test("device identity is proved, settings rotate generations, and another account can bind only with the installation secret", async () => {
  const s = await device(),
    initial = readPushDevices().devices[0];
  await updatePushDevice(s.token, binding);
  assert.equal(readPushDevices().devices[0].generation, initial.generation);
  await assert.rejects(
    updatePushDevice(s.token, {
      ...binding,
      installationSecret: "x".repeat(43),
    }),
    /端末の登録/,
  );
  await assert.rejects(
    updatePushDevice(s.token, { ...binding, userId: "staff" }),
    /変更できる/,
  );
  await updatePushDevice(s.token, { ...binding, remindersEnabled: false });
  assert.notEqual(readPushDevices().devices[0].generation, initial.generation);
  await device("other");
  assert.equal(readPushDevices().devices[0].userId, "other");
  await assert.rejects(
    updatePushDevice(
      s.token,
      { installationId, installationSecret: "z".repeat(43) },
      true,
    ),
    /端末の登録/,
  );
  await updatePushDevice(s.token, { installationId, installationSecret }, true);
  assert.equal(readPushDevices().devices.length, 0);
});
test("notification and outbox save atomically; repeated sends and exhibition retries do not duplicate jobs", async () => {
  await device();
  const id = await notice();
  await activityAction("staff", { action: "notification.send", id }, () => now);
  assert.equal(queue().length, 1);
  const n = {
    id: crypto.randomUUID(),
    exhibitionId: "exhibition",
    senderId: "staff",
    senderName: "staff",
    title: "写真展",
    body: "本文",
    recipientIds: ["member"],
    createdAt: new Date(now).toISOString(),
  };
  await appendExhibitionNotice(n);
  await appendExhibitionNotice(n);
  assert.equal(queue().length, 2);
  const state = fs.readFileSync(
    path.join(dir, "member-activities.json"),
    "utf8",
  );
  fs.writeFileSync(path.join(dir, "push-devices.json"), "broken");
  await assert.rejects(notice());
  assert.equal(
    fs.readFileSync(path.join(dir, "member-activities.json"), "utf8"),
    state,
  );
});
test("only the subject is sent; no message body, email or auth token reaches the provider; receipt is checked later", async () => {
  await device();
  const id = await notice();
  let messages: any[] = [];
  await sendAt(async (_url, options) => {
    messages = JSON.parse(String(options!.body));
    return okSend();
  });
  assert.equal(messages[0].title, "件名だけ");
  assert.equal(messages[0].body, undefined);
  assert.deepEqual(messages[0].data, { version: 1, notificationId: id });
  assert.equal(JSON.stringify(messages).includes("秘密"), false);
  assert.equal(queue()[0].status, "receipt");
  await sendAt(
    async (url, options) => {
      assert.ok(String(url).endsWith("getReceipts"));
      assert.deepEqual(JSON.parse(String(options!.body)), {
        ids: ["receipt-1"],
      });
      return Response.json({ data: { "receipt-1": { status: "ok" } } });
    },
    now + 15 * 60_000,
  );
  assert.equal(queue()[0].status, "done");
});
test("transient failures retry durably and concurrent workers claim a delivery only once", async () => {
  await device();
  await notice();
  await sendAt(async () => {
    throw new Error("offline");
  });
  assert.equal(queue()[0].status, "pending");
  assert.equal(queue()[0].attempts, 1);
  let calls = 0;
  const mock: typeof fetch = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return okSend();
  };
  await Promise.all([sendAt(mock, now + 31_000), sendAt(mock, now + 31_000)]);
  assert.equal(calls, 1);
  assert.equal(queue()[0].attempts, 2);
});
test("logout unlinks its device, and role/auth-version changes prevent stale deliveries", async () => {
  const s = await device();
  await notice();
  await deleteSession(s.token);
  let calls = 0;
  await sendAt(async () => {
    calls++;
    return okSend();
  });
  assert.equal(calls, 0);
  assert.equal(readPushDevices().devices.length, 0);
  await device();
  await notice();
  writeData(
    "users.json",
    users.map((u) => (u.id === "member" ? { ...u, authVersion: 1 } : u)),
  );
  await sendAt(async () => {
    calls++;
    return okSend();
  });
  assert.equal(calls, 0);
});
test("an invalid old token receipt cannot delete a freshly rotated token", async () => {
  const s = await device();
  await notice();
  await sendAt(async () => {
    await updatePushDevice(s.token, {
      ...binding,
      token: "ExpoPushToken[rotated_token_1234567890]",
    });
    return Response.json({
      data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
    });
  });
  assert.equal(
    readPushDevices().devices[0].token,
    "ExpoPushToken[rotated_token_1234567890]",
  );
  assert.equal(queue()[0].status, "failed");
});
test("legacy notification history is never backfilled when a device registers", async () => {
  await notice();
  await device();
  await activityAction("member", {
    action: "notification.read",
    id: readActivities().notifications[0].id,
  });
  assert.equal(queue().length, 0);
});
test("event reminders fire exactly once, exclude answered members, and recheck answers before push", async () => {
  await device();
  const e = await published();
  await createDueReminders(now + DAY - 1);
  assert.equal(
    readActivities().notifications.filter((n) => n.reminder).length,
    0,
  );
  await activityAction(
    "other",
    { action: "vote", eventId: e.id, vote: "absent" },
    () => now,
  );
  await createDueReminders(now + DAY);
  await createDueReminders(now + DAY + 1);
  const reminders = readActivities().notifications.filter((n) => n.reminder);
  assert.equal(reminders.length, 1);
  assert.deepEqual(reminders[0].recipientIds, ["member"]);
  await activityAction(
    "member",
    { action: "vote", eventId: e.id, vote: "attending" },
    () => now + DAY + 1,
  );
  let sentTitles: string[] = [];
  await sendAt(
    async (_url, options) => {
      const messages = JSON.parse(String(options!.body));
      sentTitles = messages.map((m: any) => m.title);
      return Response.json({
        data: messages.map(() => ({ status: "ok", id: crypto.randomUUID() })),
      });
    },
    now + DAY + 2,
  );
  assert.ok(!sentTitles.some((title) => title.includes("締切")));
  await createDueReminders(now + 2 * DAY);
  assert.deepEqual(
    readActivities().notifications.find(
      (n) => n.reminder?.kind === "event-start",
    )?.recipientIds,
    ["member"],
  );
});
test("short-notice publication skips missed reminders; cancellation invalidates future reminders", async () => {
  const e = await published();
  const data = readActivities();
  data.events[0].deadline = new Date(now + DAY / 2).toISOString();
  data.push!.reminders = [];
  writeData("member-activities.json", data);
  await createDueReminders(now);
  assert.ok(
    !readActivities().push!.reminders.some((s) => s.kind === "event-deadline"),
  );
  await activityAction(
    "staff",
    { action: "event.cancel", eventId: e.id, revision: e.revision },
    () => now,
  );
  await createDueReminders(now + 2 * DAY);
  assert.equal(
    readActivities().notifications.filter((n) => n.reminder).length,
    0,
  );
});
test("exhibition reminders exclude submitted/inactive accounts and cover the vote and submission deadlines", async () => {
  const iso = (days: number) => new Date(now + days * DAY).toISOString();
  const exhibition = {
    id: "ex",
    title: "写真展",
    revision: 1,
    status: "open",
    opensAt: iso(2),
    closesAt: iso(4),
    schemas: [{ version: 1, sections: [], fields: [], captionLabel: "" }],
    rooms: [],
    participation: {
      state: "published",
      opensAt: iso(-1),
      closesAt: iso(2),
      recipientIds: ["member", "other"],
      votes: {},
    },
  };
  const data: any = {
    version: 1,
    exhibitions: [exhibition],
    submissions: [],
    assets: [],
  };
  writeData("exhibitions.json", data);
  await createDueReminders(now);
  await createDueReminders(now + DAY);
  assert.equal(
    readActivities().notifications.find(
      (n) => n.reminder?.kind === "exhibition-vote",
    )?.recipientIds.length,
    2,
  );
  data.exhibitions[0].participation.votes = {
    member: { value: "attending" },
    other: { value: "attending" },
  };
  data.submissions = [
    {
      id: "submitted",
      exhibitionId: "ex",
      userId: "other",
      versions: [{ version: 1 }],
    },
  ];
  writeData("exhibitions.json", data);
  await createDueReminders(now + 3 * DAY);
  assert.deepEqual(
    readActivities().notifications.find(
      (n) => n.reminder?.kind === "exhibition-submission",
    )?.recipientIds,
    ["member"],
  );
});

test("a delayed first exhibition poll catches a scheduled reminder but never backfills short-notice publication", async () => {
  const iso = (delta: number) => new Date(now + delta).toISOString();
  const e = {
    id: "poll-exhibition",
    title: "巡回境界",
    status: "open",
    schemas: [{ version: 1, sections: [], fields: [] }],
    rooms: [],
    opensAt: iso(-DAY),
    closesAt: iso(3 * DAY),
    participation: {
      state: "published",
      opensAt: iso(-DAY),
      closesAt: iso(DAY + 1000),
      recipientIds: ["member"],
      votes: {},
    },
    reminderConfiguredAt: { vote: iso(0), submission: iso(0) },
  };
  writeData("exhibitions.json", {
    version: 1,
    exhibitions: [e],
    submissions: [],
    assets: [],
  });
  await createDueReminders(now + 2000);
  assert.equal(
    readActivities().notifications.filter(
      (n) => n.reminder?.kind === "exhibition-vote",
    ).length,
    1,
  );
  await createDueReminders(now + 3000);
  assert.equal(
    readActivities().notifications.filter(
      (n) => n.reminder?.kind === "exhibition-vote",
    ).length,
    1,
  );
  const short = {
    ...e,
    id: "short-exhibition",
    participation: { ...e.participation, closesAt: iso(DAY - 1000) },
  };
  writeData("exhibitions.json", {
    version: 1,
    exhibitions: [e, short],
    submissions: [],
    assets: [],
  });
  await createDueReminders(now + 4000);
  assert.equal(
    readActivities().notifications.some((n) => n.exhibitionId === short.id),
    false,
  );
});
