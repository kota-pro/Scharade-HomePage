import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { fixtureLogin, fixtureMfaCode } from "./fixture-auth";
const origin = "http://127.0.0.1:4329";
async function login(context: BrowserContext, id: string) {
  const response = await fixtureLogin(context.request, "/api/auth/login", {
    headers: { Origin: origin },
    data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
  });
  expect(response.ok()).toBeTruthy();
}
async function mockNative(page: Page) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__nativePackets = [];
    w.__scharadeAppChallenge = "00000000-0000-4000-8000-000000000001";
    w.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw);
        w.__nativePackets.push(message);
        if (
          ["file-start", "file-chunk", "file-end", "copy-text"].includes(
            message.type,
          )
        )
          queueMicrotask(() => {
            window.dispatchEvent(
              new CustomEvent("scharade:native", {
                detail: {
                  version: 1,
                  nonce: message.nonce,
                  challenge: message.challenge,
                  id: message.id,
                  command: "native-result",
                  ok: true,
                },
              }),
            );
          });
      },
    };
  });
}
async function rpc(
  page: Page,
  command: string,
  payload?: unknown,
  nonce?: string,
) {
  const id = `request-${Math.random()}`;
  await page.evaluate(
    ({ id, command, payload, nonce }) => {
      const packets = (window as any).__nativePackets;
      window.dispatchEvent(
        new CustomEvent("scharade:native", {
          detail: {
            version: 1,
            id,
            command,
            challenge: (window as any).__scharadeAppChallenge,
            payload,
            nonce:
              nonce || packets.findLast((p: any) => p.type === "ready").nonce,
          },
        }),
      );
    },
    { id, command, payload, nonce },
  );
  return id;
}
const response = (page: Page, id: string) =>
  page.evaluate(
    (id) =>
      (window as any).__nativePackets.find(
        (p: any) => p.type === "response" && p.id === id,
      ),
    id,
  );

test("app mode keeps same-origin authorization, native RPC and private cookies, while browser mode keeps the website", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    userAgent: "Mozilla/5.0 ScharadeApp/1",
    viewport: { width: 390, height: 844 },
  });
  try {
    await login(context, "member");
    const page = await context.newPage();
    await mockNative(page);
    await page.goto("/Member");
    await expect(page.locator("body")).toHaveAttribute("data-app-client", "1");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__nativePackets.some((p: any) => p.type === "ready"),
        ),
      )
      .toBeTruthy();
    const id = await rpc(page, "context");
    await expect.poll(async () => (await response(page, id))?.ok).toBeTruthy();
    const result = await response(page, id);
    expect(result.result.user.role).toBe("member");
    expect(JSON.stringify(result)).not.toMatch(
      /password|tokenHash|member@example|session/,
    );
    const wrong = await rpc(page, "logout", undefined, "invalid-nonce");
    await page.waitForTimeout(100);
    expect(await response(page, wrong)).toBeUndefined();
    expect(
      (await context.request.get("/api/member/app-context")).status(),
    ).toBe(200);
    expect(
      (
        await context.request.post("/api/member/push-devices", {
          headers: { Origin: "https://evil.invalid" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    expect((await context.request.get("/Admin")).status()).toBe(403);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    await context.close();
  }
});

test("app bridge continues in an Admin preview and can transfer a generated file and clipboard text", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    userAgent: "Mozilla/5.0 ScharadeApp/1",
  });
  try {
    await login(context, "admin");
    const page = await context.newPage();
    await mockNative(page);
    await page.goto("/?preview=draft&editor=common");
    await expect(page.locator(".preview-banner")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-app-client", "1");
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__nativePackets.some((p: any) => p.type === "ready"),
        ),
      )
      .toBeTruthy();
    await page.evaluate(async () => {
      await navigator.clipboard.writeText("Scharadeのリンク");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob(["%PDF-1.7\nfixture\n%%EOF"], { type: "application/pdf" }),
      );
      link.download = "確認.pdf";
      document.body.append(link);
      link.click();
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as any).__nativePackets.some(
            (p: any) => p.type === "file-end",
          ),
        ),
      )
      .toBeTruthy();
    const packets = await page.evaluate(() => (window as any).__nativePackets);
    expect(packets.find((p: any) => p.type === "copy-text").value).toBe(
      "Scharadeのリンク",
    );
    expect(packets.find((p: any) => p.type === "file-start").name).toBe(
      "確認.pdf",
    );
    expect(
      Buffer.from(
        packets.find((p: any) => p.type === "file-chunk").value,
        "base64",
      ).toString(),
    ).toContain("%PDF-1.7");
  } finally {
    await context.close();
  }
});

test("approval-pending accounts can request deletion publicly, then Admin can start the reviewed workflow", async ({
  browser,
  browserName,
}) => {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage(),
      email = `app-delete-${browserName}@example.invalid`;
    await page.goto("/AccountDeletion");
    await page.getByLabel("登録メールアドレス").fill(email);
    await page
      .getByRole("button", { name: "確認コードをメールで受け取る" })
      .click();
    await expect(page.locator("[data-deletion-confirm]")).toBeVisible();
    await page
      .getByLabel("メールに届いた6桁の確認コード")
      .fill(fixtureMfaCode(email));
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "削除を申請する", exact: true })
      .click();
    await expect(page.locator("[data-deletion-status]")).toContainText(
      "削除申請を受け付けました",
    );
    await login(context, "admin");
    await page.goto("/Admin/account-deletion-requests");
    await page
      .getByRole("link", { name: new RegExp(`アプリ削除申請${browserName}`) })
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "削除処理を開始する", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "ローカル削除を再試行する",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "アカウント・Portfolioの削除を確定する",
        exact: true,
      }),
    ).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("native QR image copying works even when ClipboardItem is unavailable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: origin,
    userAgent: "Mozilla/5.0 ScharadeApp/1",
    viewport: { width: 390, height: 844 },
  });
  try {
    await login(context, "member");
    const page = await context.newPage();
    await mockNative(page);
    await page.addInitScript(() =>
      Object.defineProperty(window, "ClipboardItem", {
        configurable: true,
        value: undefined,
      }),
    );
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "127.0.0.1" || url.protocol === "blob:"
        ? route.continue()
        : route.abort();
    });
    await page.goto("/Portfolio/member");
    await page.locator(".portfolio-share-trigger:visible").click();
    const button = page.getByRole("button", {
      name: "QR画像をコピー",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.locator(".portfolio-share-status")).toContainText(
      "QR画像をコピーしました",
    );
    const packets = await page.evaluate(() => (window as any).__nativePackets);
    expect(packets.find((p: any) => p.type === "file-start").action).toBe(
      "copy",
    );
    expect(packets.find((p: any) => p.type === "file-start").mime).toBe(
      "image/png",
    );
  } finally {
    await context.close();
  }
});
