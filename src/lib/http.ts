export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

export function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export function safeReturnPath(
  value: string | null,
  fallback = "/Portfolio/edit",
) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x1f\x7f]/.test(value)
  )
    return fallback;
  try {
    if (new URL(value, "https://return-path.invalid").origin !== "https://return-path.invalid") return fallback;
  } catch { return fallback; }
  return value;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export class HttpInputError extends Error {
  status: number;
  constructor(message = "送信内容が大きすぎます。", status = 413) { super(message); this.status = status; }
}
export async function boundedBody(request: Request, maximum: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximum)) throw new HttpInputError();
  const reader = request.body?.getReader(); if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = []; let bytes = 0;
  const deadline = AbortSignal.timeout(30000);
  try {
    while (true) {
      deadline.throwIfAborted();
      const part = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        const cancel = () => reject(new HttpInputError("送信がタイムアウトしました。", 408));
        deadline.addEventListener("abort", cancel, { once: true });
        reader.read().then(resolve, reject).finally(() => deadline.removeEventListener("abort", cancel));
      });
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw new HttpInputError();
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
export async function boundedFormData(request: Request, maximum = 512 * 1024) {
  const bytes = await boundedBody(request, maximum);
  try { return await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new HttpInputError("送信形式を確認してください。", 400); }
}

export async function fetchWithTimeout(
  url: string | URL,
  options: RequestInit = {},
  timeout = 8000,
) {
  return fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(timeout),
    redirect: "error",
  });
}
