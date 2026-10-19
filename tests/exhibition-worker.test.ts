import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

for (const duringDelivery of [false, true]) {
  test(`exhibition worker closes PM2 IPC ${duringDelivery ? "after in-flight delivery" : "while idle"}`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exhibition-worker-"));
    // Keep PM2's message listener present: an open IPC channel otherwise prevents exit.
    fs.writeFileSync(path.join(dir, "wrapper.mjs"), 'process.on("message", () => {}); await import("./worker.mjs");');
    fs.writeFileSync(path.join(dir, "fixture.mjs"), 'export const siteOrigin = () => "https://example.invalid"; export async function drainExhibitionQueues() { console.log("started"); await new Promise(resolve => setTimeout(resolve, 150)); console.log("finished"); return {attempted:1,uploads:0,delivered:1}; }');
    fs.writeFileSync(path.join(dir, "worker.mjs"), fs.readFileSync("scripts/exhibition-worker.mjs", "utf8").replace('"../src/lib/exhibitionIntegrations.ts"', '"./fixture.mjs"').replace('"../src/lib/config.ts"', '"./fixture.mjs"'));
    const child = spawn(process.execPath, [path.join(dir, "wrapper.mjs")], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let output = "", errors = "", sent = false;
    child.stdout!.on("data", chunk => {
      output += chunk.toString();
      if (!sent && output.includes(duringDelivery ? "started" : '"event":"exhibition.delivery"')) { sent = true; child.kill("SIGTERM"); }
    });
    child.stderr!.on("data", chunk => errors += chunk.toString());
    const guard = setTimeout(() => child.kill("SIGKILL"), 3000);
    try {
      const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      assert.equal(sent, true);
      assert.deepEqual(result, { code: 0, signal: null }, errors);
      assert.ok(output.includes("finished"), "active delivery must finish before stopping");
    } finally { clearTimeout(guard); child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
