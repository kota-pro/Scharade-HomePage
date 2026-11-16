import { test, expect, type Page } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", error => console.error("Portfolio editor error:", error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#ccc"/></svg>' });
    return route.abort();
  });
  expect((await fixtureLogin(page.request, "/api/auth/login", { headers: { Origin: "http://127.0.0.1:4329" }, data: { email: "other@example.invalid", password: "fixture-password-123" } })).status()).toBe(200);
  // Start with plain text so earlier cases cannot leave an active list or text style.
  expect((await page.request.post("/api/portfolio/update", {
    headers: { Origin: "http://127.0.0.1:4329" },
    data: { self_introduction: "" },
  })).status()).toBe(200);
});

async function selectText(page: Page, text: string) {
  await page.locator("#field-self-intro").evaluate((editor, text) => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = node.textContent!.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
      (editor as HTMLElement).focus();
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
      return;
    }
    throw new Error("Text not found: " + text);
  }, text);
}
async function save(page: Page) {
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page).toHaveURL(/\/Portfolio\/other$/);
}

test("formatting, color, links and lists survive saving and reopening on desktop and mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/Portfolio/edit?id=other");
  await expect(page.locator("[data-introduction-editor]")).toHaveAttribute("data-introduction-ready", "true");
  const editor = page.getByRole("textbox", { name: "Self introduction", exact: true });
  await editor.fill("太字 斜体 文字色 下線 リンク");
  for (const [text, button] of [["太字", "太字"], ["斜体", "斜体"], ["下線", "下線"]]) {
    await selectText(page, text);
    await page.getByRole("button", { name: button, exact: true }).click();
  }
  await selectText(page, "文字色");
  await page.getByLabel("文字色", { exact: true }).evaluate((input: HTMLInputElement) => { input.value = "#c42b48"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  await selectText(page, "リンク");
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  await page.getByLabel("URL", { exact: true }).fill("https://example.com/portfolio");
  await page.getByRole("button", { name: "設定する", exact: true }).click();
  await page.screenshot({ path: info.outputPath("introduction-editor-desktop.png"), fullPage: true });
  await save(page);
  const introduction = page.locator(".self-introduction");
  await expect(introduction.getByText("太字", { exact: true })).toHaveCSS("font-weight", "700");
  await expect(introduction.getByText("斜体", { exact: true })).toHaveCSS("font-style", "italic");
  await expect(introduction.getByText("下線", { exact: true })).toHaveCSS("text-decoration-line", "underline");
  await expect(introduction.getByText("文字色", { exact: true })).toHaveCSS("color", "rgb(196, 43, 72)");
  await expect(introduction.getByRole("link", { name: "リンク" })).toHaveAttribute("href", "https://example.com/portfolio");
  await expect(introduction.getByRole("link", { name: "リンク" })).toHaveAttribute("rel", /noopener/);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.goto("/Portfolio/edit?id=other");
  await expect(page.locator("[data-introduction-editor]")).toHaveAttribute("data-introduction-ready", "true");
  await expect(editor.getByText("文字色", { exact: true })).toHaveCSS("color", "rgb(196, 43, 72)");
  await expect(editor.getByRole("link", { name: "リンク" })).toHaveAttribute("href", "https://example.com/portfolio");
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await editor.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByRole("button", { name: "太字", exact: true })).toBeVisible();
  }
  await page.screenshot({ path: info.outputPath("introduction-editor-mobile.png") });
  await editor.fill("一つ目");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "箇条書き", exact: true }).click();
  await editor.locator("li").last().evaluate(item => {
    const range = document.createRange(); range.selectNodeContents(item); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await editor.press("Enter");
  await editor.pressSequentially("二つ目");
  await expect(editor.locator("ul li")).toHaveText(["一つ目", "二つ目"]);
  await save(page);
  await expect(introduction.locator("ul li")).toHaveText(["一つ目", "二つ目"]);
});

test("legacy text remains literal, unsafe URLs are rejected, paste excludes media and empty content saves", async ({ page }) => {
  const headers = { Origin: "http://127.0.0.1:4329" };
  const legacy = '<strong>タグを含む文字</strong>\n  字下げ & 記号';
  expect((await page.request.post("/api/portfolio/update", { headers, data: { self_introduction: legacy } })).status()).toBe(200);
  await page.goto("/Portfolio/edit?id=other");
  await expect(page.locator("[data-introduction-editor]")).toHaveAttribute("data-introduction-ready", "true");
  const editor = page.getByRole("textbox", { name: "Self introduction", exact: true });
  await expect(editor).toContainText("<strong>タグを含む文字</strong>");
  await expect(editor.locator("strong")).toHaveCount(0);
  await editor.fill("紹介");
  await selectText(page, "紹介");
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  await page.getByLabel("URL", { exact: true }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "設定する", exact: true }).click();
  await expect(page.locator("[data-intro-link-error]")).toContainText("URL");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-intro-dialog]")).not.toBeVisible();
  await editor.evaluate(element => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "貼り付け" : '<img src="https://evil.invalid/track"><b onclick="alert(1)">貼り付け</b>' } });
    element.dispatchEvent(event);
  });
  await expect(editor.locator("img, [onclick]")).toHaveCount(0);
  await expect(editor).toContainText("貼り付け");
  await editor.fill("");
  await save(page);
  await expect(page.locator(".self-introduction")).toBeEmpty();
});

test("undo, redo, link editing and validation keep the entered introduction available", async ({ page }) => {
  await page.goto("/Portfolio/edit?id=other");
  await expect(page.locator("[data-introduction-editor]")).toHaveAttribute("data-introduction-ready", "true");
  const editor = page.getByRole("textbox", { name: "Self introduction", exact: true });
  await editor.fill("戻す文字");
  await selectText(page, "戻す文字");
  await page.getByRole("button", { name: "太字", exact: true }).click();
  await expect(editor.getByText("戻す文字", { exact: true })).toHaveCSS("font-weight", "700");
  const formattedHtml = await editor.innerHTML();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect.poll(() => editor.innerHTML()).not.toBe(formattedHtml);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect.poll(() => editor.innerHTML()).toBe(formattedHtml);
  await expect(editor.getByText("戻す文字", { exact: true })).toHaveCSS("font-weight", "700");
  await editor.fill("紹介するサイト");
  await selectText(page, "紹介するサイト");
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  await page.getByLabel("URL", { exact: true }).fill("https://example.com/old");
  await page.getByRole("button", { name: "設定する", exact: true }).click();
  await selectText(page, "紹介するサイト");
  await page.getByRole("button", { name: "リンク", exact: true }).click();
  await expect(page.getByLabel("URL", { exact: true })).toHaveValue("https://example.com/old");
  await page.getByLabel("表示テキスト", { exact: true }).fill("公開サイト");
  await page.getByLabel("URL", { exact: true }).fill("https://example.com/new");
  await page.getByRole("button", { name: "設定する", exact: true }).click();
  await expect(editor.getByRole("link", { name: "公開サイト" })).toHaveAttribute("href", "https://example.com/new");
  await selectText(page, "公開サイト");
  await page.getByRole("button", { name: "リンクを解除", exact: true }).click();
  await expect(editor.locator("a")).toHaveCount(0);
  await expect(editor).toHaveText("公開サイト");
  await editor.fill("あ".repeat(5001));
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.locator("#introduction-error")).toContainText("5,000文字");
  await expect(editor).toHaveText("あ".repeat(5001));
  await editor.fill("保存できる文章");
  await save(page);
  await expect(page.locator(".self-introduction")).toHaveText("保存できる文章");
});
