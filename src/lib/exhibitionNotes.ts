/** Fixed, optional response outside title-board text and custom schema questions. */
export const exhibitionNotesLimit = 10000;
export function exhibitionNotesText(content?: { notes?: unknown } | null): string {
  return typeof content?.notes === "string" ? content.notes.trim() : "";
}
/** Old clients omit this field; only an explicit empty string clears saved notes. */
export function preserveSubmissionNotes(raw: Record<string, any>, previous?: { notes?: string }) {
  return raw.notes === undefined && previous?.notes !== undefined ? { ...raw, notes: previous.notes } : raw;
}
