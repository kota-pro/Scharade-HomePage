import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { publicPages } from "../src/data/publicPages.ts";
import {
  buildSitemapEntries,
  renderSitemap,
  type SitemapSources,
} from "../src/lib/sitemap.ts";
import { GET as robots } from "../src/pages/robots.txt.ts";

const empty: SitemapSources = {
  blogs: async () => [],
  portfolios: async () => [],
  albums: async () => [],
};
const origin = "https://scharade.jp";

test("public fixed pages are real routes and include the five new public guides", async () => {
  const entries = await buildSitemapEntries(empty);
  assert.equal(entries.length, 13);
  for (const pathname of [
    "/AppPrivacy",
    "/AccountDeletion",
    "/exhibition-integration.html",
    "/exhibition-privacy.html",
    "/exhibition-terms.html",
  ]) {
    assert.ok(entries.some((entry) => entry.loc === origin + pathname));
  }
  for (const page of publicPages) {
    const file = page.href.endsWith(".html")
      ? `public${page.href}`
      : `src/pages${page.href === "/" ? "/index" : page.href}.astro`;
    assert.ok(
      fs.existsSync(file) || fs.existsSync(`src/pages${page.href}/index.astro`),
      file,
    );
  }
  assert.ok(entries.every((entry) => entry.lastmod === undefined));
});

test("dynamic entries exclude private content, encode slugs, deduplicate and use real dates", async () => {
  const slug = "撮影会 & <春> #1? 100%";
  const entries = await buildSitemapEntries({
    blogs: async () => [
      { slug, updatedAt: "2026-10-18T09:00:00+09:00" },
      { slug, updatedAt: "2026-10-19T09:00:00+09:00" },
      { slug: "", updatedAt: "2026-10-18" },
      { slug: "invalid-date", updatedAt: "invalid" },
      { slug: "published-only", publishedAt: "2026-10-17T00:00:00Z" },
    ],
    portfolios: async () => [
      { id: "member", updatedAt: "2026-10-18" },
      { id: "w_rozcjvv" },
    ],
    albums: async () => [
      { id: "public", hidden: false, updated: "2026-10-18" },
      { id: "private", hidden: true },
    ],
  });
  const loc = `${origin}/posts/${encodeURIComponent(slug)}`;
  assert.equal(entries.filter((entry) => entry.loc === loc).length, 1);
  assert.equal(
    entries.find((entry) => entry.loc === loc)?.lastmod,
    "2026-10-19T00:00:00.000Z",
  );
  assert.equal(
    entries.find((entry) => entry.loc.endsWith("/invalid-date"))?.lastmod,
    undefined,
  );
  assert.equal(
    entries.find((entry) => entry.loc.endsWith("/published-only"))?.lastmod,
    "2026-10-17T00:00:00.000Z",
  );
  assert.ok(
    entries.some((entry) => entry.loc === origin + "/Portfolio/member"),
  );
  assert.ok(entries.some((entry) => entry.loc === origin + "/Gallery/public"));
  assert.ok(
    !entries.some((entry) =>
      /w_rozcjvv|\/Gallery\/private|\/Member|\/Admin|\/Exhibition|\/api\//.test(
        entry.loc,
      ),
    ),
  );
  const xml = renderSitemap([{ loc: `${origin}/?x=<>&'\"` }]);
  assert.ok(xml.includes("&lt;&gt;&amp;&apos;&quot;"));
});

test("integration failures retain fixed pages and other integrations, including synchronous failures", async () => {
  const fail = () => {
    throw new Error("synthetic service unavailable");
  };
  const entries = await buildSitemapEntries({
    blogs: fail,
    portfolios: async () => [{ id: "available" }],
    albums: async () => {
      throw new Error("unavailable");
    },
  });
  assert.equal(entries.length, publicPages.length + 1);
  assert.ok(
    entries.some((entry) => entry.loc.endsWith("/Portfolio/available")),
  );
  assert.equal(
    (await buildSitemapEntries({ blogs: fail, portfolios: fail, albums: fail }))
      .length,
    publicPages.length,
  );
});

test("robots allows all sitemap pages and public noindex event shares while blocking internal routes", async () => {
  const response = await robots();
  assert.equal(
    response.headers.get("Content-Type"),
    "text/plain; charset=utf-8",
  );
  const body = await response.text();
  assert.ok(body.includes(`Sitemap: ${origin}/sitemap.xml`));
  const rules = body.split("\n").flatMap((line) => {
    const match = /^(Allow|Disallow): (.+)$/.exec(line);
    return match ? [{ allow: match[1] === "Allow", prefix: match[2] }] : [];
  });
  const allowed = (pathname: string) =>
    rules
      .filter((rule) => pathname.startsWith(rule.prefix))
      .sort(
        (a, b) =>
          b.prefix.length - a.prefix.length ||
          Number(b.allow) - Number(a.allow),
      )[0]?.allow ?? true;
  for (const page of publicPages) assert.ok(allowed(page.href), page.href);
  for (const pathname of [
    "/Member",
    "/Member/manage",
    "/Member/notifications/test",
    "/Admin/accounts",
    "/Exhibition/test",
    "/api/member/activities",
    "/Mfa",
    "/SearchResult",
    "/Portfolio/edit",
    "/503",
  ])
    assert.ok(!allowed(pathname), pathname);
  assert.ok(allowed("/Member/events/shared-event"));
  assert.ok(allowed("/Member/tools/shared-tool"));
  assert.ok(allowed("/.well-known/assetlinks.json"));
});

test("XML endpoint collects every CMS page beyond 100 records without accessing real services", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scharade-sitemap-"));
  const oldDirectory = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  t.after(() => {
    if (oldDirectory === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = oldDirectory;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Network disabled in this test");
  });
  const { microcmsClient } = await import("../src/lib/microcms.ts");
  const calls: string[] = [];
  t.mock.method(
    microcmsClient,
    "getList",
    async (options: {
      endpoint: string;
      queries?: { offset?: number; limit?: number };
    }) => {
      const offset = options.queries?.offset ?? 0;
      calls.push(`${options.endpoint}:${offset}`);
      const all = Array.from({ length: 101 }, (_, index) => ({
        id: `entry-${index}`,
        slug: `post-${index}`,
        updatedAt: "2026-10-18T00:00:00Z",
      }));
      return {
        contents: all.slice(offset, offset + (options.queries?.limit ?? 100)),
        totalCount: all.length,
      };
    },
  );
  const { GET } = await import("../src/pages/sitemap.xml.ts");
  const response = await GET();
  assert.equal(
    response.headers.get("Content-Type"),
    "application/xml; charset=utf-8",
  );
  const xml = await response.text();
  assert.ok(xml.includes(`${origin}/posts/post-100`));
  assert.ok(xml.includes(`${origin}/Portfolio/entry-100`));
  assert.equal((xml.match(/<url>/g) ?? []).length, publicPages.length + 202);
  assert.deepEqual(calls.sort(), [
    "blog:0",
    "blog:100",
    "portfolio:0",
    "portfolio:100",
  ]);
});
