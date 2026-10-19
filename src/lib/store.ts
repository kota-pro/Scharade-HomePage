import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getDataDir } from "./dataDir.ts";

export function dataPath(name: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Invalid data filename");
  return path.join(getDataDir(import.meta.url), name);
}

/** Missing files may be initialized; empty or corrupt files must never be erased. */
export function readData<T>(name: string, fallback: T): T {
  const file = dataPath(name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(fallback);
    throw new Error(
      `保存データ ${name} を読めません。バックアップを確認してください。`,
      { cause: error },
    );
  }
}

/** Call inside the matching transaction lock for read-modify-write operations. */
export function writeData<T>(name: string, value: T) {
  const file = dataPath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
  }
}

/** A filesystem lock serializes updates across PM2 processes, not just promises. */
export async function withStoreLock<T>(
  name: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const lock = dataPath(`${name}.lock`);
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  const started = Date.now();
  const owner = path.join(lock, "owner.json");
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      try {
        fs.writeFileSync(owner, JSON.stringify({ pid: process.pid }), {
          mode: 0o600,
        });
      } catch (error) {
        fs.rmSync(lock, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Never remove a lock based on an old owner observation: another process
      // may already have acquired it. Crash recovery is an explicit offline task.
      if (Date.now() - started > 10_000)
        throw new Error("保存処理が混み合っています。再度お試しください。");
      await delay(20 + Math.random() * 30);
    }
  }
  try {
    return await action();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

export function updateData<T>(
  name: string,
  fallback: T,
  update: (value: T) => T,
  lock = name,
) {
  return withStoreLock(lock, () => {
    const next = update(readData(name, fallback));
    writeData(name, next);
    return next;
  });
}
