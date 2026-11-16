import { readData } from "./store.ts";
import type { ActivityRoster } from "./activityTypes.ts";
import type { ClubFormsStore, TermRosterSource } from "./clubFormsTypes.ts";

type Source = { spreadsheetId: string; term?: TermRosterSource };
function sheetIds(source?: Source) {
  return new Set(
    [
      source?.spreadsheetId,
      source?.term?.admission.spreadsheetId,
      source?.term?.continuation.spreadsheetId,
    ].filter((id): id is string => Boolean(id)),
  );
}
export function activeClubFormSheets() {
  return sheetIds(
    readData<{ roster?: ActivityRoster }>("member-activities.json", {}).roster,
  );
}
export function unavailableClubFormSource(source: Source) {
  const ids = sheetIds(source);
  return readData<Pick<ClubFormsStore, "forms">>("club-forms.json", {
    forms: [],
  }).forms.some(
    (form) =>
      Boolean(form.deleteRequestedAt || form.deletedAt) &&
      Boolean(form.remote && ids.has(form.remote.spreadsheetId)),
  );
}
