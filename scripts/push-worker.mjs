import { createDueReminders } from "../src/lib/notificationReminders.ts";
import { drainPushQueue } from "../src/lib/pushDelivery.ts";
import { drainDeletionEmails } from "../src/lib/accountDeletionProcessing.ts";

let stopping = false,
  running = false,
  timer;
const close = () => {
  if (process.connected) process.disconnect();
};
const stop = () => {
  stopping = true;
  clearTimeout(timer);
  if (!running) close();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
async function tick() {
  running = true;
  try {
    const deletionEmails = await drainDeletionEmails(
      undefined,
      Date.now,
      () => stopping,
    );
    if (deletionEmails)
      console.log(
        JSON.stringify({
          event: "account-deletion.mail",
          sent: deletionEmails,
        }),
      );
    if (!stopping && process.env.PUSH_DELIVERY_ENABLED === "1") {
      const reminders = await createDueReminders();
      const result = stopping ? { attempted: 0 } : await drainPushQueue();
      if (reminders || result.attempted)
        console.log(
          JSON.stringify({ event: "push.delivery", reminders, ...result }),
        );
    }
  } catch {
    console.error("push.delivery: inspect configuration, DATA_DIR and locks");
  }
  running = false;
  if (stopping) close();
  else timer = setTimeout(tick, 30000);
}
await tick();
