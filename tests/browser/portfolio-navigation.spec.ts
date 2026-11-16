import { test, expect } from "@playwright/test";
import { fixtureLogin } from "./fixture-auth";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const width of [390, 1440]) {
  test(`Portfolio return link opens the list after direct entry and unrelated navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const previous of [null, "/Contact", "/Portfolio"]) {
      if (previous) await page.goto(previous);
      await page.goto("/Portfolio/member" + (previous === "/Portfolio" ? "?from=portfolio" : ""));
      const back = page.getByRole("link", { name: "Portfolioへ戻る", exact: true });
      await expect(back).toBeVisible();
      await expect(back).toHaveAttribute("href", "/Portfolio");
      await back.click();
      await expect(page).toHaveURL("http://127.0.0.1:4329/Portfolio");
    }
  });
}

test("edited Portfolio returns to the list and uses the Member heading for both account roles", async ({ page }) => {
  for (const id of ["admin", "member"]) {
    expect((await fixtureLogin(page.request, "/api/auth/login", {
      headers: { Origin: "http://127.0.0.1:4329" },
      data: { email: `${id}@example.invalid`, password: "fixture-password-123" },
    })).status()).toBe(200);
    await page.goto(`/Portfolio/edit?id=${id}`);
    await expect(page.locator(".auth-heading .auth-pill")).toHaveText("Member");
    await expect(page.locator(".auth-heading h1")).toHaveText("Edit Portfolio");
    await page.getByRole("link", { name: "View portfolio", exact: true }).click();
    await page.getByRole("link", { name: "Portfolioへ戻る", exact: true }).click();
    await expect(page).toHaveURL("http://127.0.0.1:4329/Portfolio");
  }
});

test("signup heading uses Sign up", async ({ page }) => {
  await page.goto("/Signup");
  await expect(page.locator(".auth-heading h1")).toHaveText("Sign up");
});
