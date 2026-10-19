type Entry = { value: unknown; expires: number; generation: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let generation = 0;

export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttl = 60_000,
): Promise<T> {
  const current = entries.get(key);
  if (current && current.expires > Date.now()) return current.value as T;
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const atStart = generation;
  const result = load()
    .then((value) => {
      if (generation === atStart) {
        if (entries.size >= 300) entries.delete(entries.keys().next().value!);
        entries.set(key, { value, expires: Date.now() + ttl, generation });
      }
      return value;
    })
    .finally(() => {
      if (pending.get(key) === result) pending.delete(key);
    });
  pending.set(key, result);
  return result;
}

export function invalidateCache(prefix = "") {
  generation++;
  for (const key of entries.keys())
    if (key.startsWith(prefix)) entries.delete(key);
  for (const key of pending.keys())
    if (key.startsWith(prefix)) pending.delete(key);
}
