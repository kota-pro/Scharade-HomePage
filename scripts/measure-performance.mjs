import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const options = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const at = argument.indexOf("=");
    if (!argument.startsWith("--") || at < 0)
      throw new Error("Use --base=URL --output=FILE --runs=3");
    return [argument.slice(2, at), argument.slice(at + 1)];
  }),
);
const base = new URL(options.base || "https://scharade.jp");
if (
  !["http:", "https:"].includes(base.protocol) ||
  base.username ||
  base.password
)
  throw new Error("Use an HTTP(S) origin without credentials.");
const runs = Number(options.runs || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 5)
  throw new Error("runs must be 1–5");
const output = options.output || "performance-report.json";
const report = {
  startedAt: new Date().toISOString(),
  base: base.origin,
  environment: {
    browser: "",
    platform: process.platform,
    viewport: { width: 390, height: 844 },
    networkThrottling: "none",
    cpuThrottling: "none",
    browserCache: "new context per sample; server/CDN caches are not reset",
    observation:
      "DOMContentLoaded, then load (up to 15 seconds), then 3 seconds",
  },
  notes: [
    "Lab observations on this computer, not measurements from an iPhone/Android device.",
    "Resource transfer totals include only sizes exposed by Resource Timing.",
    "INP is not measured: the script does not interact with the page.",
    "DOMContentLoaded deadline: 45 seconds. Timeout samples remain in the report.",
  ],
  samples: [],
};
const browser = await chromium.launch({ headless: true });
report.environment.browser = browser.version();
try {
  for (const route of ["/", "/About_us", "/Gallery", "/Portfolio"]) {
    for (let run = 1; run <= runs; run++) {
      const context = await browser.newContext({
        viewport: report.environment.viewport,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        window.__scharadeMetrics = { lcpMs: null, cls: 0 };
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries())
              window.__scharadeMetrics.lcpMs = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            // Layout-shift total is diagnostic, not the session-window CLS metric.
            for (const entry of list.getEntries())
              if (!entry.hadRecentInput)
                window.__scharadeMetrics.cls += entry.value;
          }).observe({ type: "layout-shift", buffered: true });
        } catch {}
      });
      const sample = {
        route,
        run,
        measuredAt: new Date().toISOString(),
        status: null,
        loadComplete: false,
        error: null,
        metrics: null,
      };
      try {
        const response = await page.goto(new URL(route, base.origin).href, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        sample.status = response?.status() ?? null;
        try {
          await page.waitForLoadState("load", { timeout: 15000 });
          sample.loadComplete = true;
        } catch {}
        await page.waitForTimeout(3000);
        sample.metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType("navigation")[0];
          const resources = performance.getEntriesByType("resource");
          return {
            ttfbMs: navigation?.responseStart ?? null,
            documentTransferBytes: navigation?.transferSize ?? null,
            domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
            loadMs: navigation?.loadEventEnd || null,
            lcpMs: window.__scharadeMetrics?.lcpMs ?? null,
            layoutShiftTotal: window.__scharadeMetrics?.cls ?? null,
            resourcesObserved: resources.length,
            resourceTransferBytesObserved: resources.reduce(
              (total, resource) => total + (resource.transferSize || 0),
              0,
            ),
          };
        });
      } catch (error) {
        sample.error =
          error instanceof Error
            ? error.message.split("\n")[0]
            : "Navigation failed";
      } finally {
        report.samples.push(sample);
        await context.close();
      }
      console.log(
        `${route} ${run}/${runs}: status=${sample.status} DCL=${sample.metrics?.domContentLoadedMs?.toFixed(0) ?? "n/a"}ms loadComplete=${sample.loadComplete}`,
      );
      await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
      await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n");
    }
  }
} finally {
  await browser.close();
}
console.log(`Saved ${output}`);
