import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readData, withStoreLock, writeData } from "../../src/lib/store.ts";
import type { ExhibitionStore, RoomLayout } from "../../src/lib/exhibitionTypes.ts";

type Options = {
  source?: "layout" | "form" | "book";
  rooms?: (rooms: RoomLayout[], workIds: string[]) => RoomLayout[];
};

export async function fixtureExhibition(engine: string, title: string, { source = "layout", rooms }: Options = {}) {
  const engineIndex = ["chromium", "firefox", "webkit"].indexOf(engine);
  if (engineIndex < 0) throw new Error("Unknown browser fixture: " + engine);
  const prefix = { form: "f1000000", layout: "f2000000", book: "f3000000" }[source];
  const seedId = `${prefix}-0000-4000-8000-00000000000${engineIndex + 1}`;
  const { directory } = JSON.parse(fs.readFileSync(".data/browser-fixture-path.json", "utf8"));
  if (!directory.startsWith(path.join(os.tmpdir(), "scharade-browser-"))) throw new Error("Invalid synthetic fixture directory");

  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  try {
    return await withStoreLock("exhibitions", () => {
      const store = readData<ExhibitionStore>("exhibitions.json", { version: 1, exhibitions: [], submissions: [], assets: [], outputs: [] });
      const templates = readData<Pick<ExhibitionStore, "exhibitions" | "submissions">>(
        "browser-exhibition-seeds.json", { exhibitions: [], submissions: [] },
      );
      const seed = templates.exhibitions.find(exhibition => exhibition.id === seedId);
      const submission = templates.submissions.find(item => item.exhibitionId === seedId);
      if (!seed || (source === "layout" && !submission)) throw new Error("Missing synthetic exhibition fixture");
      const exhibition = structuredClone(seed);
      exhibition.id = crypto.randomUUID();
      exhibition.title = title;
      if (rooms) exhibition.rooms = rooms(exhibition.rooms, submission?.draft.works.map(work => work.id) ?? []);
      store.exhibitions.push(exhibition);
      if (submission) {
        store.submissions.push({ ...structuredClone(submission), id: crypto.randomUUID(), exhibitionId: exhibition.id });
      }
      writeData("exhibitions.json", store);
      return exhibition.id;
    });
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
}
