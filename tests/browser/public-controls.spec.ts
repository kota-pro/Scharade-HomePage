import { test, expect } from "@playwright/test";
import path from "node:path";
import { fixtureLogin } from "./fixture-auth";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    if (url.hostname.endsWith("microcms-assets.io"))
      return route.fulfill({ path: path.resolve("public/media/site/activity/Photo1-480.webp"), contentType: "image/webp" });
    return route.abort();
  });
});

for (const width of [390, 1440]) {
  test(`back to top stops before the footer and hides at the top at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const route of ["/", "/Activity", "/Gallery", "/Gallery/public-album", "/Portfolio", "/Portfolio/member", "/Contact", "/Signup", "/Disclaimer", "/SearchResult?q=撮影", "/sitemap", "/posts/test-post"]) {
      await page.goto(route);
      const top = page.getByRole("link", { name: "ページの先頭へ", includeHidden: true });
      await expect(top, route).toHaveCount(1);
      await expect(top, route).toBeHidden();
      await page.evaluate(() => scrollTo({ top: 120, behavior: "instant" }));
      await expect(top, route).toBeHidden();
      await page.evaluate(() => scrollTo({ top: 121, behavior: "instant" }));
      await expect(top, route).toBeVisible();
      await expect(top).toHaveCSS("position", "fixed");
      await expect(top).toHaveCSS("right", width < 800 ? "16px" : "24px");
      const checkPosition = async () => {
        await expect.poll(() => top.evaluate((button, gap) => {
          const footerTop = document.querySelector("body > footer")!.getBoundingClientRect().top;
          return Math.abs(button.getBoundingClientRect().bottom - (Math.min(innerHeight, footerTop) - gap));
        }, width < 800 ? 16 : 24), { message: route }).toBeLessThan(1);
      };
      await checkPosition();
      await top.hover();
      await expect(top.locator("svg")).toHaveCSS("rotate", /^(none|0deg)$/);
      await expect(top.locator("svg")).toHaveCSS("filter", "none");
      await expect(top.locator("svg")).toHaveCSS("color", "rgb(255, 255, 255)");
      const before = await top.boundingBox();
      const footerTop = await page.locator("body > footer").evaluate(footer => footer.getBoundingClientRect().top + scrollY);
      for (const overlap of [-50, 80, 260]) {
        await page.evaluate(y => scrollTo({ top: Math.max(121, y), behavior: "instant" }), footerTop - 844 + overlap);
        await checkPosition();
      }
      await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await checkPosition();
      await expect(top).toBeInViewport();
      const after = await top.boundingBox();
      expect(after!.x, route).toBeCloseTo(before!.x, 0);
      expect(after!.y, route).toBeLessThan(before!.y);
      if (route === "/") {
        await expect(page.locator(".loading-wrapper")).toBeHidden();
        await page.screenshot({ path: info.outputPath(`page-top-${width}.png`) });
      }
      // Exercise both pointer activation and keyboard activation of the link.
      if (route === "/Contact") {
        await top.focus();
        await page.keyboard.press("Enter");
      } else await top.click();
      await expect.poll(() => page.evaluate(() => scrollY), { message: route }).toBe(0);
      await expect(top).toBeHidden();
    }
    await page.goto("/ForgotPassword");
    await expect(page.locator('a.page-top-nav[aria-label="ログイン画面へ戻る"]')).toHaveAttribute("href", "/Login");
    await expect(page.locator("[data-page-top]")).toHaveCount(0);
  });

  test(`carousel keeps its responsive display and Portfolio photo album at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const lists = page.locator(".photo-carousel-contents ul");
    const originals = lists.first().locator("a");
    const copies = lists.last().locator("a");
    await expect(lists).toHaveCount(2);
    await expect(lists.last()).toHaveAttribute("aria-hidden", "true");
    const urls = await originals.evaluateAll(links => links.map(link => link.getAttribute("href")!));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.length).toBeLessThanOrEqual(20);
    expect(new Set(urls).size).toBe(urls.length);
    await expect(page.locator("[data-photo-ref]")).toHaveCount(Math.min(3, urls.length) + urls.length);
    if (width < 768) {
      await expect(page.locator(".photo-carousel")).toBeHidden();
      return;
    }
    await originals.first().click();
    await expect(page.locator("[data-photo-position]")).toHaveText(`1 / ${urls.length}`);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-photo-position]")).toHaveText(`2 / ${urls.length}`);
    await expect(page.locator("[data-photo-image]")).toHaveAttribute("src", urls[1]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#photo-dialog")).toBeHidden();
    await expect(copies.first()).toHaveAttribute("tabindex", "-1");
    // The animation copy starts offscreen in reduced-motion mode.
    // Exercise its forwarding handler without waiting for a full film revolution.
    await copies.first().evaluate(link => (link as HTMLAnchorElement).click());
    await expect(page.locator("[data-photo-position]")).toHaveText(`1 / ${urls.length}`);
    await expect(page.locator("[data-photo-image]")).toHaveAttribute("src", urls[0]);
    await page.keyboard.press("Escape");
    await expect(page.locator("#photo-dialog")).toBeHidden();
  });

  test(`visible public tabs support Tab and arrow keys at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    for (const route of ["/", "/Activity", "/Gallery", "/About_us"]) {
      await page.goto(route);
      const tabs = page.locator(".tab");
      if (route === "/About_us" && width < 768) {
        // The mobile schedule presents all months as swipeable cards, without tabs.
        await expect(tabs.locator('input[type="radio"]:visible')).toHaveCount(0);
        await expect(page.locator("#card-apr-may")).toBeVisible();
        await expect(page.locator("#card-jul")).toBeVisible();
        continue;
      }
      const inputs = tabs.locator("input.tab-radio");
      const count = await inputs.count();
      expect(count, route).toBeGreaterThan(1);
      await inputs.first().focus();
      await expect(inputs.first(), route).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(inputs.first(), route).toBeFocused();
      const checkSelectedTab = async (selected: number) => {
        await expect(inputs.nth(selected), route).toBeChecked();
        await expect(inputs.nth(selected), route).toBeFocused();
        const label = tabs.locator(`label[for="${await inputs.nth(selected).getAttribute("id")}"]`);
        await expect(label).toHaveCSS("outline-style", "solid");
        const panels = tabs.locator(route === "/About_us" ? ".tab-content:visible" : ".tab-panel:visible");
        await expect(panels, route).toHaveCount(1);
        if (route === "/Activity") await expect(panels).toHaveAttribute("data-tab-index", String(selected));
        else await expect(inputs.nth(selected).locator("xpath=following-sibling::*[2]")).toBeVisible();
      };
      // Native radio groups differ across browsers at the ends; verify both directions within the group.
      for (let selected = 1; selected < count; selected++) {
        await page.keyboard.press("ArrowRight");
        await checkSelectedTab(selected);
      }
      for (let selected = count - 2; selected >= 0; selected--) {
        await page.keyboard.press("ArrowLeft");
        await checkSelectedTab(selected);
      }
      if (route === "/Gallery") {
        const select = page.getByRole("combobox", { name: "過去の年度を選択" });
        const year = await select.locator('option:not([value=""])').first().getAttribute("value");
        await select.selectOption(year!);
        await expect(page.locator(`#year-${year}`)).toBeChecked();
        await expect(tabs.locator(".tab-panel:visible")).toContainText(`公開 撮影会 ${year}`);
        await inputs.first().focus();
        await page.keyboard.press("Space");
        await expect(select).toHaveValue("");
        await expect(page.locator(".tab-select-wrapper")).not.toHaveClass(/active/);
      }
    }
  });

  test(`menu keeps keyboard focus inside until it closes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.evaluate(() => scrollTo({ top: 500, behavior: "instant" }));
    const toggle = page.locator(".toggle_btn");
    await expect(toggle).toBeVisible();
    await toggle.click();
    const menu = page.locator("#site-menu");
    if (width <= 767) {
      for (const size of [{ width, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        await expect.poll(() => menu.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return Math.abs(rect.width - innerWidth) <= 1 && Math.abs(rect.height - innerHeight) <= 1 && element.scrollHeight <= element.clientHeight + 1;
        })).toBe(true);
      }
      await page.setViewportSize({ width, height: 844 });
    }
    if (width <= 768) await expect(toggle).toBeFocused();
    else await expect(page.getByRole("searchbox", { name: "サイト内検索" })).toBeFocused();
    const first = menu.locator("a").first();
    await first.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(first).toBeFocused();
    await menu.locator(".member-button").last().focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("#site-menu, .toggle_btn"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await toggle.click();
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
  });
}

test("phone menu fits privileged member controls without scrolling", async ({ page }) => {
  await fixtureLogin(page.request, "/api/auth/login", {
    headers: { Origin: "http://127.0.0.1:4329" },
    data: { email: "admin@example.invalid", password: "fixture-password-123" },
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/Portfolio");
  await page.locator(".toggle_btn").click();
  const menu = page.locator("#site-menu");
  await expect(menu.getByRole("link", { name: "Management", exact: true })).toBeVisible();
  await expect.poll(() => menu.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
});

test("back to top follows footer movement after layout changes and viewport resizing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".loading-wrapper")).toBeHidden();
  await page.evaluate(() => {
    const footerTop = document.querySelector("body > footer")!.getBoundingClientRect().top + scrollY;
    scrollTo({ top: footerTop - 500, behavior: "instant" });
  });
  const checkPosition = async () => {
    await expect.poll(() => page.locator("[data-page-top]").evaluate(button => {
      const footerTop = document.querySelector("body > footer")!.getBoundingClientRect().top;
      const gap = innerWidth <= 800 ? 16 : 24;
      return Math.abs(button.getBoundingClientRect().bottom - (Math.min(innerHeight, footerTop) - gap));
    })).toBeLessThan(1);
  };
  await checkPosition();
  await page.evaluate(() => { document.querySelector<HTMLElement>("main")!.style.paddingBottom = "160px"; });
  await checkPosition();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 740 });
    await checkPosition();
  }
  await page.evaluate(() => scrollTo({ top: 121, behavior: "instant" }));
  await checkPosition();
});

test("back to top restores visibility after history navigation and supports smooth scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.evaluate(() => scrollTo({ top: 650, behavior: "instant" }));
  await expect(page.locator("[data-page-top]")).toBeVisible();
  await page.goto("/Contact");
  await page.goBack();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(120);
  await expect(page.locator("[data-page-top]")).toBeVisible();
  await page.reload();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(120);
  await expect(page.locator("[data-page-top]")).toBeVisible();
  await page.locator("[data-page-top]").click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator("[data-page-top]")).toBeHidden();
});

test("back to top avoids layout reads during scroll bursts and stays fixed before the footer", async ({ page, browserName }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/Disclaimer');
  await page.evaluate(async () => {
    scrollTo({ top: 350, behavior: 'instant' });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const work = await page.evaluate(async () => {
    const footer = document.querySelector<HTMLElement>('body > footer')!;
    const button = document.querySelector<HTMLElement>('[data-page-top]')!;
    const read = footer.getBoundingClientRect.bind(footer);
    let reads = 0, mutations = 0;
    footer.getBoundingClientRect = () => { reads++; return read(); };
    const observer = new MutationObserver(records => mutations += records.length);
    observer.observe(button, { attributes: true, attributeFilter: ['style', 'hidden'] });
    for (let n = 0; n < 120; n++) dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    observer.disconnect(); footer.getBoundingClientRect = read;
    return { reads, mutations };
  });
  expect(work).toEqual({ reads: 0, mutations: 0 });
  const positions = await page.evaluate(async () => {
    const button = document.querySelector<HTMLElement>('[data-page-top]')!;
    const bottom: number[] = [];
    for (let n = 0; n < 24; n++) {
      scrollTo({ top: 350 + n * 5, behavior: 'instant' });
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      bottom.push(button.getBoundingClientRect().bottom);
    }
    return bottom;
  });
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(0.5);
  expect(positions[0]).toBeCloseTo(844 - 16, 0);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'LayoutCount')!.value;
    const before = await layouts();
    await page.evaluate(async () => {
      const footerTop = document.querySelector('body > footer')!.getBoundingClientRect().top + scrollY;
      for (let n = 0; n < 30; n++) {
        scrollTo({ top: footerTop - innerHeight + 10 + n * 5, behavior: 'instant' });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
    });
    const layoutCount = await layouts() - before;
    expect(layoutCount).toBe(0);
    await info.attach('scroll-performance.json', { body: JSON.stringify({ scrollBurst: work, footerScrollSteps: 30, layoutCount }), contentType: 'application/json' });
  }
});

test("back to top keeps its mobile member-nav gap and stops above the footer", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await fixtureLogin(page.request, '/api/auth/login', { headers: { Origin: 'http://127.0.0.1:4329' }, data: { email: 'member@example.invalid', password: 'fixture-password-123' } })).status()).toBe(200);
  await page.goto('/Member');
  const top = page.locator('[data-page-top]');
  for (const width of [320, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
    await expect(top).toBeVisible();
    await expect.poll(() => top.evaluate(button => Math.abs(button.getBoundingClientRect().bottom - (innerHeight - 80)))).toBeLessThan(1);
    await page.evaluate(() => {
      const footerTop = document.querySelector('body > footer')!.getBoundingClientRect().top + scrollY;
      scrollTo({ top: footerTop - innerHeight + 100, behavior: 'instant' });
    });
    await expect.poll(() => top.evaluate(button => {
      const footerTop = document.querySelector('body > footer')!.getBoundingClientRect().top;
      return Math.abs(button.getBoundingClientRect().bottom - (Math.min(innerHeight, footerTop) - 80));
    })).toBeLessThan(1);
  }
  await top.click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(top).toBeHidden();
});

test("film photographs and both perforation strips keep moving together under the pointer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const carousel = page.locator(".photo-carousel-contents");
  await expect(carousel.locator("ul")).toHaveCount(2);
  await expect(page.locator(".upper-film-hole img, .lower-film-hole img")).toHaveCount(4);
  await expect(page.locator(".loading-wrapper")).toBeHidden();
  await carousel.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 50)));
  const positions = () => page.evaluate(() => {
    const x = (element: Element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
    const photo = document.querySelector(".photo-carousel-contents ul")!;
    const holes = [".upper-film-hole", ".lower-film-hole"].map(selector => {
      const strip = document.querySelector(selector)!;
      const images = strip.querySelectorAll("img");
      const first = images[0].getBoundingClientRect(), copy = images[1].getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      return { x: x(images[0]), width: first.width, join: Math.abs(first.right - copy.left), covered: first.left <= bounds.left + 1 && copy.right >= bounds.right - 1 };
    });
    return { photo: x(photo), period: photo.scrollWidth + 20, holes, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  for (const width of [769, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.runFor(50);
    await carousel.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = (await carousel.boundingBox())!;
    // Real pointer hover; animation is deliberately not stable enough for locator.hover().
    await page.mouse.move(box.x + 120, box.y + 80);
    expect(await carousel.evaluate(element => element.matches(":hover"))).toBe(true);
    const before = await positions();
    await page.clock.runFor(1000);
    const after = await positions();
    const movement = before.photo - after.photo;
    expect(movement).toBeGreaterThan(29);
    expect(movement).toBeLessThan(31);
    for (let i = 0; i < 2; i++) {
      expect(before.holes[i].x - after.holes[i].x).toBeCloseTo(movement, 2);
      expect(after.holes[i].join).toBeLessThan(1);
      expect(after.holes[i].covered).toBe(true);
    }
    // Preserve the existing page bounds while the film moves and repeats.
    expect(after.overflow).toBe(before.overflow);
    expect((await carousel.boundingBox())!.width).toBeLessThanOrEqual(width + 1);
  }
  // Pass both a perforation repeat and a photograph repeat, including the remainder.
  const start = await positions();
  const travel = Math.max(start.period, start.holes[0].width) + 90;
  await page.clock.fastForward(travel / 30 * 1000);
  const wrapped = await positions();
  const photoTravel = (start.photo - wrapped.photo + start.period * 2) % start.period;
  expect(photoTravel).toBeCloseTo(travel % start.period, 0);
  wrapped.holes.forEach((hole, i) => {
    const holeTravel = (start.holes[i].x - hole.x + hole.width * 10) % hole.width;
    expect(holeTravel).toBeCloseTo(travel % hole.width, 0);
    expect(hole.join).toBeLessThan(1); expect(hole.covered).toBe(true);
  });
  // Keyboard focus and reduced-motion settings still pause every part together.
  await carousel.locator("ul").first().locator("a").first().focus();
  await page.clock.runFor(50);
  const focused = await positions();
  await page.clock.runFor(1000);
  expect(await positions()).toEqual(focused);
  await carousel.locator("a").first().evaluate(element => (element as HTMLElement).blur());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  // WebKit delivers existing MediaQueryList change events on a native rendering turn,
  // independently of the mocked requestAnimationFrame clock.
  await expect.poll(async () => {
    const before = await positions();
    await page.clock.runFor(250);
    return (await positions()).photo - before.photo;
  }).toBe(0);
  const reduced = await positions();
  await page.clock.runFor(1000);
  expect(await positions()).toEqual(reduced);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(async () => {
    await page.clock.runFor(100);
    return (await positions()).photo;
  }).not.toBe(reduced.photo);
});

test("film drag and horizontal wheel move photos and holes together, coast, and preserve clicks and vertical scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const carousel = page.locator(".photo-carousel-contents"), film = page.locator(".photo-carousel");
  await expect(carousel.locator("ul")).toHaveCount(2);
  await expect(page.locator(".loading-wrapper")).toBeHidden();
  await carousel.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 50)));
  const positions = () => page.evaluate(() => [
    document.querySelector(".photo-carousel-contents ul")!,
    document.querySelector(".upper-film-hole img")!,
    document.querySelector(".lower-film-hole img")!,
  ].map((element, i) => ({ x: new DOMMatrixReadOnly(getComputedStyle(element).transform).m41, period: i === 0 ? element.scrollWidth + 20 : element.getBoundingClientRect().width })));
  const movement = (before: { x: number; period: number }[], after: { x: number; period: number }[]) => after.map((value, i) => {
    const width = value.period;
    return ((value.x - before[i].x + width / 2) % width + width) % width - width / 2;
  });
  const synchronized = (moves: number[]) => {
    expect(moves[1]).toBeCloseTo(moves[0], 2); expect(moves[2]).toBeCloseTo(moves[0], 2);
  };
  const box = (await carousel.boundingBox())!;
  await page.mouse.move(220, box.y + 80);
  await page.mouse.down();
  const before = await positions();
  for (const x of [180, 140]) { await page.clock.runFor(40); await page.mouse.move(x, box.y + 80); }
  const dragged = await positions();
  const dragMoves = movement(before, dragged);
  synchronized(dragMoves);
  // Auto-scroll may advance slightly before the horizontal drag threshold is reached.
  expect(dragMoves[0]).toBeGreaterThan(-82); expect(dragMoves[0]).toBeLessThan(-79);
  await expect(film).toHaveAttribute("data-dragging", "");
  await page.mouse.up();
  await expect(page.locator("#photo-dialog")).toBeHidden();
  await expect(film).not.toHaveAttribute("data-dragging");
  await page.clock.runFor(100);
  const coast = await positions();
  const early = movement(dragged, coast); synchronized(early); expect(early[0]).toBeLessThan(-50);
  await page.clock.runFor(1600);
  const settled = await positions();
  await page.clock.runFor(100);
  const late = movement(settled, await positions()); synchronized(late);
  expect(late[0]).toBeGreaterThan(-4); expect(late[0]).toBeLessThan(-2);
  // The perforations themselves also accept a rightward drag, across the loop edge.
  const holeBox = (await page.locator(".upper-film-hole").boundingBox())!;
  await page.mouse.move(600, holeBox.y + holeBox.height / 2); await page.mouse.down();
  const holeStart = await positions();
  for (const x of [640, 680]) { await page.clock.runFor(40); await page.mouse.move(x, holeBox.y + holeBox.height / 2); }
  const holeMoves = movement(holeStart, await positions()); synchronized(holeMoves);
  expect(holeMoves[0]).toBeGreaterThan(77); expect(holeMoves[0]).toBeLessThan(81);
  await page.mouse.up();
  await page.clock.runFor(1800);
  await page.mouse.move(400, box.y + 80);
  const wheelStart = await positions();
  await page.mouse.wheel(96, 0);
  await expect.poll(async () => (await positions())[0].x).not.toBe(wheelStart[0].x);
  const wheeled = await positions(), wheelMoves = movement(wheelStart, wheeled);
  synchronized(wheelMoves); expect(wheelMoves[0]).toBeCloseTo(-96, 0);
  await page.clock.runFor(180);
  const wheelCoast = movement(wheeled, await positions()); synchronized(wheelCoast); expect(wheelCoast[0]).toBeLessThan(-50);
  await page.clock.runFor(2000);
  const wheelSettled = await positions(); await page.clock.runFor(100);
  const wheelLate = movement(wheelSettled, await positions()); synchronized(wheelLate);
  expect(wheelLate[0]).toBeGreaterThan(-4); expect(wheelLate[0]).toBeLessThan(-2);
  const scrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 120);
  await page.clock.runFor(100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore);
  // A later ordinary click must still open a photo; dragging must not disable links.
  await carousel.evaluate(element => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await page.clock.runFor(500);
  const currentBox = (await carousel.boundingBox())!;
  await page.mouse.click(120, currentBox.y + 80);
  await expect(page.locator("#photo-dialog")).toBeVisible();
  await page.clock.runFor(50);
  const opened = await positions(); await page.clock.runFor(500);
  expect(await positions()).toEqual(opened);
});

test("film starts moving after delayed styles and decoration images without a window resize", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" && (url.pathname.endsWith(".css") || url.pathname.endsWith("film-hole.webp"))) {
      await new Promise(resolve => setTimeout(resolve, 350));
      return route.continue();
    }
    return route.fallback();
  });
  await page.goto("/");
  await expect(page.locator(".loading-wrapper")).toBeHidden();
  const carousel = page.locator(".photo-carousel-contents");
  await carousel.scrollIntoViewIfNeeded();
  const positions = () => page.evaluate(() => [".photo-carousel-contents ul", ".upper-film-hole img", ".lower-film-hole img"].map(selector => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(selector)!).transform).m41));
  const first = await positions();
  await expect.poll(async () => (await positions())[0]).not.toBe(first[0]);
  const before = await positions();
  await page.waitForTimeout(400);
  const after = await positions(), delta = after.map((x, i) => x - before[i]);
  expect(delta[0]).toBeLessThan(-6);
  expect(delta[1]).toBeCloseTo(delta[0], 1);
  expect(delta[2]).toBeCloseTo(delta[0], 1);
  await expect(carousel.locator("ul").last()).toHaveCSS("transform", /^matrix\(/);
});
