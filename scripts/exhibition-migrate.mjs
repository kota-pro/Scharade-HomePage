import { readExhibitions, updateExhibitionStore } from "../src/lib/exhibitions.ts";
import { readUsers } from "../src/lib/auth.ts";

const apply = process.argv.includes("--apply"), approved = readUsers().filter(u => u.approved).map(u => u.id);
function migrate(store) {
  let updated = 0;
  for (const e of store.exhibitions) {
    let changed = false;
    if (e.year === undefined) { e.year = new Date(Date.parse(e.createdAt) + 9 * 3600000).getUTCFullYear(); changed = true; }
    if (!e.participation) { e.participation = { state: "draft", opensAt: "", closesAt: "", recipientIds: [...approved], votes: {} }; changed = true; }
    if (!e.notices) { e.notices = []; changed = true; }
    for (const form of e.googleForms) if (!form.connectionId) { form.connectionId = "legacy"; changed = true; }
    if (changed) { e.revision++; e.updatedAt = new Date().toISOString(); updated++; }
  }
  store.outputs ??= [];
  return { updated, exhibitions: store.exhibitions.length, draftsRetained: store.submissions.filter(s => !s.versions.length).length, unboundDrafts: store.submissions.filter(s => !s.userId && !s.inactive && !s.sheetSource).length, submissionsRetained: store.submissions.length, assetsRetained: store.assets.length, googleFormsRetained: store.exhibitions.reduce((n,e) => n + e.googleForms.length,0) };
}
const result = apply ? await updateExhibitionStore(migrate) : migrate(structuredClone(readExhibitions()));
console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", ...result }));
