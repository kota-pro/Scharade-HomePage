/** Reject unapproved container formats before handing bytes to native decoders. */
export function imageSignature(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) return "webp";
  return null;
}
export class ImageBusyError extends Error {
  status = 429;
  constructor() { super("画像処理が混み合っています。少し待って再度お試しください。"); }
}
let active = 0;
const waiting: Array<() => void> = [];
const MAX_ACTIVE = 2, MAX_WAITING = 4;
async function acquire() {
  if (active < MAX_ACTIVE) { active++; return; }
  if (waiting.length >= MAX_WAITING) throw new ImageBusyError();
  await new Promise<void>((resolve, reject) => {
    const resume = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { const index = waiting.indexOf(resume); if (index >= 0) waiting.splice(index, 1); reject(new ImageBusyError()); }, 15000);
    waiting.push(resume);
  });
}
/** Each admitted job must use the decoder's own execution timeout. */
export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  await acquire();
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
