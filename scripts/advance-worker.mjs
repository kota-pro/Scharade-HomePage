import "./require-secure-runtime.mjs";
import { drainAdvanceQueue } from "../src/lib/advanceRequests.ts";
import { drainRosterPortfolioUpdates } from "../src/lib/rosterPortfolioUpdates.ts";
import { drainAccountSetups } from "../src/lib/accountSetup.ts";
import { drainAccountingRoster } from "../src/lib/accountingRoster.ts";
let stopping = false;
let timer;
const stop = () => { stopping = true; clearTimeout(timer); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
async function tick() {
  try {
    const result = stopping ? {attempted:0} : await drainAccountSetups(1, () => stopping);
    if (result.attempted) console.log(JSON.stringify({ event: "account.setup", ...result }));
  } catch { console.error("account.setup: inspect DATA_DIR and locks"); }
  try {
    const result = await drainAdvanceQueue();
    if (result.attempted) console.log(JSON.stringify({ event: "advance.delivery", ...result }));
  } catch { console.error("advance.delivery: persistent queue could not be processed; inspect DATA_DIR and locks"); }
  try {
    const result = stopping ? {attempted:0} : await drainRosterPortfolioUpdates(5, () => stopping);
    if (result.attempted) console.log(JSON.stringify({ event: "roster.portfolio", ...result }));
  } catch { console.error("roster.portfolio: queue could not be processed; inspect DATA_DIR and locks"); }
  try {
    const result = stopping ? { attempted: 0 } : await drainAccountingRoster();
    if (result.attempted) console.log(JSON.stringify({ event: "accounting.roster", ...result }));
  } catch { console.error("accounting.roster: inspect queue and connection"); }
  if (!stopping) timer = setTimeout(tick, 30000);
}
await tick();
