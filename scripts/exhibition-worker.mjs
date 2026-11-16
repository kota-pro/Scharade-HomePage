import "./require-secure-runtime.mjs";
import { drainExhibitionQueues } from "../src/lib/exhibitionIntegrations.ts";
import { siteOrigin } from "../src/lib/config.ts";
import { drainShiftGeneration } from "../src/lib/exhibitionShiftJobs.ts";
let generationRunning = false, generationTimer;
async function generationTick() { generationRunning = true; try { await drainShiftGeneration(() => stopping); } catch { console.error("exhibition.shift: generation retry pending"); } generationRunning = false; if (stopping) { if (!running) closeIPC(); } else generationTimer = setTimeout(generationTick, 1000); }
let stopping = false;
let running = false;
let timer;
const closeIPC = () => { if (process.connected) process.disconnect(); };
const stop = () => { stopping = true; clearTimeout(timer); clearTimeout(generationTimer); if (!running && !generationRunning) closeIPC(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
async function tick() {
  running = true;
  try {
    const result = await drainExhibitionQueues(siteOrigin(), 20, () => stopping);
    if (result.attempted) console.log(JSON.stringify({ event: "exhibition.delivery", ...result }));
  } catch { console.error("exhibition.delivery: inspect DATA_DIR and locks"); }
  running = false;
  if (stopping) { if (!generationRunning) closeIPC(); }
  else timer = setTimeout(tick, 30000);
}
void generationTick();
await tick();
