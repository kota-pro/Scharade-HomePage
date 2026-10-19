import fs from "node:fs";
import path from "node:path";
import { dataPath, withStoreLock } from "./store.ts";

export async function audit(actorId: string, action: string, target: string) {
  await withStoreLock("audit", () => {
    const file = dataPath("audit.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        actorId,
        action,
        target,
      }) + "\n",
      { mode: 0o600 },
    );
  });
}
