import {compactTitleBoard,reconcileTitleRuby} from '../lib/exhibitionTitleText.ts';
import { normalizeMetadataInput } from "../lib/exhibitionText.ts";
/** A draft ACK advances the revision, never the editor's current input. */
export type DraftSnapshot<T> = { revision: number; content: T };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Backup<T> = { version: 1; id: string; at: number; base: DraftSnapshot<T>; pending?: T; content: T; parents?: { key: string; id: string }[] };
export class DraftSaveError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}
export type DraftSyncState = { kind: "saved" | "pending" | "saving" | "offline" | "auth" | "conflict" | "blocked"; local: boolean; message?: string };

/** Ignore parser key order, trimmed text, and the optional empty book-image UI slot. */
export function draftFingerprint(value: unknown): string {
  const normalize = (v: any): any => {
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v)) return v.map(normalize);
    if (!v || typeof v !== "object") return v;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(v).sort()) {
      if (key === "details" && Object.values(v[key] ?? {}).every(item => typeof item === "string" ? !item.trim() : !item)) continue;
      if (key === "details" && v[key] && typeof v[key] === "object") {
        result[key]=Object.fromEntries(Object.entries(v[key]).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>[name,typeof value==="string"?name==="prefecture"?value.trim():normalizeMetadataInput(value):normalize(value)]));
        continue;
      }
      if (key === "titleBoard") {let board=v[key]&&compactTitleBoard(v[key]);if(board&&typeof v.title==="string"){const work={title:v.title,titleBoard:board};reconcileTitleRuby(work,v.title,v.title.trim());board=work.titleBoard;}if(board)result[key]=normalize(board);continue;}
      if (key === "notes" && typeof v[key] === "string" && !v[key].trim()) continue;
      if (key === "portfolioUrl" && v[key]) { try { result[key] = new URL(v[key].trim()).href; continue; } catch {} }
      const item = key === "fields" ? Object.fromEntries(Object.entries(v[key] ?? {}).map(([id, value]) => [id, normalize(value)]).filter(([, value]) => value !== "" && !(Array.isArray(value) && !value.length))) : key === "photos" && v.kind === "book" ? v[key].filter((p: any) => p.assetId) : v[key];
      result[key] = normalize(item);
    }
    return result;
  };
  return JSON.stringify(normalize(value));
}

export function createDraftSync<T>(options: {
  initial: DraftSnapshot<T>; prefix: string; tab: string; storage: StorageLike | null;
  read: () => T; restore: (value: T) => void; enabled: () => boolean;
  send: (value: T, revision: number) => Promise<DraftSnapshot<T>>;
  fetch: () => Promise<DraftSnapshot<T>>; state: (state: DraftSyncState) => void;
  debounce?: number;
}) {
  let base = structuredClone(options.initial), pending: T | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined, running: Promise<void> | undefined, refreshing: Promise<void> | undefined;
  let stopped: DraftSyncState["kind"] | undefined, latest: DraftSnapshot<T> | undefined;
  let local = false, failures = 0, disposed = false, recovery: Backup<T> | undefined, retryOnEdit = false;
  let lastMessage: string | undefined, lastWriteAt = 0;
  let adopted: { key: string; id: string }[] = [];
  const key = options.prefix + options.tab;
  const equal = (a: T, b: T) => draftFingerprint(a) === draftFingerprint(b);
  const clearAdopted = () => {
    for (const parent of adopted) {
      if (!parent.key.startsWith(options.prefix)) continue;
      try { if (JSON.parse(options.storage?.getItem(parent.key) ?? "null")?.id === parent.id) options.storage?.removeItem(parent.key); } catch {}
    }
    adopted = [];
  };
  const dirty = () => !equal(options.read(), base.content);
  const notify = (kind: DraftSyncState["kind"], message?: string) => { if(message) lastMessage = message; options.state({ kind, local, message: stopped ? lastMessage : message }); };
  const cancel = () => { clearTimeout(timer); timer = undefined; };
  const persist = () => {
    try {
      if (!options.storage) throw new Error("unavailable");
      if (!dirty() && pending === undefined) options.storage.removeItem(key);
      else {
        lastWriteAt = Math.max(Date.now(), lastWriteAt + 1);
        options.storage.setItem(key, JSON.stringify({ version: 1, id: crypto.randomUUID(), at: lastWriteAt, base, ...(pending === undefined ? {} : { pending }), content: options.read(), parents: adopted } satisfies Backup<T>));
      }
      local = true;
    } catch { local = false; }
    return local;
  };
  const schedule = (delay = options.debounce ?? 900) => {
    cancel();
    if (!disposed && !stopped && !refreshing && dirty() && options.enabled()) timer = setTimeout(() => void flush().catch(() => {}), delay);
  };
  const touch = () => {
    if (disposed) return;
    if (retryOnEdit) { stopped = undefined; retryOnEdit = false; }
    persist();
    if (!running) notify(stopped ?? (dirty() ? "pending" : "saved"));
    schedule();
  };
  const reconcile = (server: DraftSnapshot<T>, record?: Backup<T>) => {
    const previous = record?.base ?? base, sent = record?.pending ?? pending, value = record?.content ?? options.read();
    latest = structuredClone(server);
    if (!equal(value, previous.content) && !equal(value, server.content) && server.revision !== previous.revision && !equal(server.content, previous.content) && (sent === undefined || !equal(server.content, sent))) {
      if (record) { base = record.base; pending = record.pending; options.restore(structuredClone(value)); }
      stopped = "conflict"; persist(); notify("conflict"); return;
    }
    base = structuredClone(server); pending = undefined; stopped = undefined; failures = 0;
    if (record || equal(value, previous.content)) options.restore(structuredClone(equal(value, previous.content) ? server.content : value));
    persist(); if (!dirty()) clearAdopted(); notify(dirty() ? "pending" : "saved"); schedule();
  };
  const flush = async (force = false): Promise<void> => {
    cancel();
    if (refreshing) { await refreshing; return flush(force); }
    if (running) { await running; if (dirty()) return flush(force); return; }
    if (!dirty()) { persist(); notify("saved"); return; }
    if (stopped) throw new DraftSaveError("未送信の入力があります。保存状態を確認してください。");
    if (!force && !options.enabled()) { persist(); schedule(); return; }
    pending = structuredClone(options.read()); persist(); notify("saving");
    const snapshot = pending;
    running = (async () => {
      try {
        const saved = await options.send(snapshot, base.revision);
        base = structuredClone(saved); pending = undefined; failures = 0;
        persist();
        clearAdopted();
        notify(dirty() ? "pending" : "saved");
      } catch (error) {
        persist();
        const code = error instanceof DraftSaveError ? error.status : 0;
        retryOnEdit = code === 400 || code === 413;
        stopped = code === 401 ? "auth" : code === 409 ? "conflict" : code >= 400 && code < 500 && code !== 429 ? "blocked" : undefined;
        notify(stopped ?? "offline", error instanceof Error ? error.message : "保存できませんでした。");
        if (code === 409) {
          try { reconcile(await options.fetch()); } catch { /* Keep both copies until a successful recheck. */ }
        }
        if (!stopped) { failures++; schedule(Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4))); }
        throw error;
      } finally { running = undefined; }
    })();
    try { await running; } finally { if (!stopped && !timer && dirty()) schedule(); }
  };
  const restore = () => {
    try {
      const candidates: { record: Backup<T>; key: string; raw: string }[] = [];
      for (let i = 0; options.storage && i < options.storage.length; i++) {
        const name = options.storage.key(i); if (!name?.startsWith(options.prefix)) continue;
        const raw = options.storage.getItem(name); if (!raw) continue;
        try {
          const record = JSON.parse(raw) as Backup<T>;
          if (record.version === 1 && typeof record.id === "string" && Number.isInteger(record.base?.revision) && record.content && record.base.content) candidates.push({ record, key: name, raw });
        } catch { /* One damaged record must not hide other drafts. */ }
      }
      const candidate = candidates.find(item => item.key === key) ?? candidates.sort((a, b) => b.record.at - a.record.at)[0];
      if (candidate) {
        lastWriteAt = candidate.record.at;
        recovery = candidate.record;
        adopted = [...(candidate.record.parents ?? []), ...(candidate.key !== key ? [{ key: candidate.key, id: candidate.record.id }] : [])];
        reconcile(base, recovery); recovery = undefined; return;
      }
    } catch { local = false; }
    touch();
  };
  const resume = async (): Promise<void> => {
    if (refreshing) return refreshing;
    cancel();
    refreshing = (async () => {
      if (running) await running.catch(() => {});
      try { reconcile(await options.fetch()); }
      catch (error) {
        persist(); const code = error instanceof DraftSaveError ? error.status : 0;
        stopped = code === 401 ? "auth" : code >= 400 && code < 500 && code !== 429 ? "blocked" : undefined;
        notify(stopped ?? "offline", error instanceof Error ? error.message : "保存状態を確認できませんでした。");
      }
    })();
    try { await refreshing; } finally { refreshing = undefined; schedule(2000); }
  };
  const resolve = async (choice: "local" | "server") => {
    if (!latest || stopped !== "conflict") return;
    base = structuredClone(latest); pending = undefined; stopped = undefined;
    if (choice === "server") { options.restore(structuredClone(base.content)); clearAdopted(); }
    touch();
    if (choice === "local") await flush(true);
  };
  return { touch, persist, flush, restore, resume, resolve, dirty, retained: () => local, revision: () => base.revision,
    dispose: () => { disposed = true; cancel(); persist(); } };
}
