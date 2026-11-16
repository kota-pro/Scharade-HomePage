import fs from "node:fs";
import path from "node:path";
import { dataPath, withStoreLock } from "./store.ts";
import { requestIdentity } from "./requestIdentity.ts";

export async function audit(actorId: string, action: string, target: string) {
  await withStoreLock("audit", () => {
    const file = dataPath("audit.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        actorId: requestIdentity()?.actorId ?? actorId,
        ...(requestIdentity() ? { actingAsUserId: actorId, adminView: requestIdentity()!.mode, viewKey: requestIdentity()!.key } : {}),
        action,
        target,
      }) + "\n",
      { mode: 0o600 },
    );
  });
}
