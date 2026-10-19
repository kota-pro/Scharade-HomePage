import { operationNotice } from "./siteNotice";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __scharadeAppChallenge?: string;
  }
}
let setupDone = false;
let nativeImageCopy: ((blob: Blob) => Promise<void>) | null = null;
export const canCopyAppImage = () => nativeImageCopy !== null;
export async function copyAppImage(blob: Blob) {
  if (!nativeImageCopy) throw new Error("アプリの画像コピーを利用できません。");
  await nativeImageCopy(blob);
}
function setup() {
  const native = window.ReactNativeWebView;
  if (
    !native ||
    setupDone ||
    !window.__scharadeAppChallenge ||
    window.top !== window.self ||
    !document.body.hasAttribute("data-app-client")
  )
    return;
  setupDone = true;
  const nonce = crypto.randomUUID(),
    challenge = window.__scharadeAppChallenge;
  const pending = new Map<
    string,
    {
      resolve(): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const post = (type: string, value: Record<string, unknown> = {}) =>
    native.postMessage(
      JSON.stringify({ version: 1, nonce, challenge, type, ...value }),
    );
  const originalFetch = window.fetch.bind(window);
  let authExpired = false;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (response.status === 401 && !authExpired) {
      const target = new URL(response.url || location.href, location.origin);
      if (
        target.origin === location.origin &&
        target.pathname.startsWith("/api/") &&
        target.pathname !== "/api/member/app-context"
      ) {
        authExpired = true;
        post("auth-expired");
      }
    }
    return response;
  };
  const operation = (type: string, value: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error("端末からの応答がありません。もう一度お試しください。"),
          );
        }, 60000);
      pending.set(id, { resolve, reject, timer });
      post(type, { id, ...value });
    });
  window.addEventListener("scharade:native", async (event) => {
    const message = (event as CustomEvent).detail;
    if (
      !message ||
      message.version !== 1 ||
      message.nonce !== nonce ||
      message.challenge !== challenge ||
      typeof message.id !== "string"
    )
      return;
    if (message.command === "native-result") {
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(message.id);
      if (message.ok) task.resolve();
      else
        task.reject(
          new Error(
            "保存・共有を完了できませんでした。もう一度お試しください。",
          ),
        );
      return;
    }
    try {
      let path: string,
        options: RequestInit = {};
      switch (message.command) {
        case "context":
          path = "/api/member/app-context";
          break;
        case "notifications":
          path = `/api/member/activities?offset=${Math.max(0, Math.floor(Number(message.payload?.offset) || 0))}`;
          break;
        case "registerPush":
          path = "/api/member/push-devices";
          options = { method: "POST", body: JSON.stringify(message.payload) };
          break;
        case "unregisterPush":
          path = "/api/member/push-devices";
          options = { method: "DELETE", body: JSON.stringify(message.payload) };
          break;
        case "logout":
          path = "/api/auth/logout";
          options = { method: "POST" };
          break;
        default:
          throw new Error("Unsupported native command");
      }
      const response = await fetch(path, {
        ...options,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json();
      post("response", {
        id: message.id,
        ok: response.ok && result.ok === true,
        status: response.status,
        result,
      });
    } catch {
      post("response", {
        id: message.id,
        ok: false,
        status: 503,
        result: { message: "通信できませんでした。再度お試しください。" },
      });
    }
  });
  let transferring = false;
  async function transfer(
    blob: Blob,
    filename: string,
    action: "share" | "copy" = "share",
  ) {
    if (transferring)
      throw new Error("別のファイルを処理しています。完了後にお試しください。");
    if (blob.size > 100 * 1024 * 1024)
      throw new Error("アプリで共有できるファイルは100MB以下です。");
    transferring = true;
    const fileId = crypto.randomUUID();
    try {
      await operation("file-start", {
        fileId,
        name: filename,
        mime: blob.type || "application/octet-stream",
        bytes: blob.size,
        action,
      });
      let sequence = 0;
      for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
        const bytes = new Uint8Array(
          await blob.slice(offset, offset + 192 * 1024).arrayBuffer(),
        );
        let value = "";
        for (const byte of bytes) value += String.fromCharCode(byte);
        await operation("file-chunk", {
          fileId,
          sequence: sequence++,
          value: btoa(value),
        });
      }
      await operation("file-end", { fileId });
    } catch (error) {
      post("file-cancel", { fileId });
      throw error;
    } finally {
      transferring = false;
    }
  }
  async function download(url: string, name: string) {
    const parsed = new URL(url, location.origin);
    if (
      parsed.origin !== location.origin ||
      !["https:", "http:", "blob:"].includes(parsed.protocol)
    )
      throw new Error("このファイルはアプリで保存できません。");
    const response = await fetch(parsed, { credentials: "same-origin" });
    if (!response.ok)
      throw new Error(
        "ファイルを取得できませんでした。再ログインしてお試しください。",
      );
    await transfer(await response.blob(), name || "Scharade-file");
  }
  document.addEventListener(
    "click",
    (event) => {
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[download]");
      if (!anchor?.href) return;
      event.preventDefault();
      void download(anchor.href, anchor.download).catch((error) =>
        operationNotice(error.message, true, "mobile-file"),
      );
    },
    true,
  );
  // Existing copy/share buttons keep their behavior using the OS clipboard in the app.
  try {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: (value: string) =>
          operation("copy-text", { value: String(value).slice(0, 1_000_000) }),
        write: async (items: ClipboardItem[]) => {
          if (items.length !== 1 || !items[0].types.includes("image/png"))
            throw new Error("画像はPNG形式でコピーしてください。");
          await transfer(
            await items[0].getType("image/png"),
            "Scharade.png",
            "copy",
          );
        },
      },
    });
  } catch {
    /* Normal download/share controls remain available. */
  }
  nativeImageCopy = (blob) => transfer(blob, "Scharade.png", "copy");
  post("ready");
}
setup();
window.addEventListener("scharade:bootstrap", setup);
