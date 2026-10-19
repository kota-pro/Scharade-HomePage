import { drainExhibitionQueues } from "../src/lib/exhibitionIntegrations.ts";
import { siteOrigin } from "../src/lib/config.ts";
let stopping = false;
let running = false;
let timer;
const closeIPC = () => { if (process.connected) process.disconnect(); };
const stop = () => { stopping = true; clearTimeout(timer); if (!running) closeIPC(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
async function tick() {
  running = true;
  try {
    const result = await drainExhibitionQueues(siteOrigin(), 20, () => stopping);
    if (result.attempted) console.log(JSON.stringify({ event: "exhibition.delivery", ...result }));
  } catch { console.error("exhibition.delivery: inspect DATA_DIR and locks"); }
  running = false;
  if (stopping) closeIPC();
  else timer = setTimeout(tick, 30000);
}
await tick();
