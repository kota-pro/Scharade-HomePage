import "./require-secure-runtime.mjs";
import {
  drainClubFormOperations,
  refreshClubFormStatuses,
} from "../src/lib/clubForms.ts";
import { drainRosterExports } from "../src/lib/rosterExports.ts";

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
    const forms = await drainClubFormOperations(2, () => stopping);
    const rosters = stopping
      ? { attempted: 0 }
      : await drainRosterExports(2, () => stopping);
    if (!stopping) await refreshClubFormStatuses();
    if (forms.attempted || rosters.attempted)
      console.log(
        JSON.stringify({ event: "club-forms.delivery", forms, rosters }),
      );
  } catch {
    console.error(
      "club-forms.delivery: inspect configuration, DATA_DIR and locks",
    );
  }
  running = false;
  if (stopping) close();
  else timer = setTimeout(tick, 5000);
}
await tick();
