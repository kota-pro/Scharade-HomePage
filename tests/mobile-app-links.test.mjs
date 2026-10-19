import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the installer's real Bash retry/validation path with a curl fixture.
// No sockets, elevated privileges, external network, or production access.
const run = promisify(execFile);
const installer = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../deploy/enable-mobile-app-links.sh",
);
async function withCurlFixture(mode, task) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scharade-curl-"));
  const requests = path.join(directory, "requests.json");
  await fs.writeFile(requests, "[]");
  await fs.writeFile(path.join(directory, "curl"), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(process.env.MOBILE_CURL_FIXTURE_DIR, 'requests.json');
const requests = JSON.parse(fs.readFileSync(file, 'utf8'));
const pathname = new URL(process.argv.at(-1)).pathname;
const association = ['/.well-known/apple-app-site-association', '/.well-known/assetlinks.json'].includes(pathname);
const wasRequested = requests.some(value => value.includes('/.well-known/'));
requests.push(pathname);
fs.writeFileSync(file, JSON.stringify(requests));
const mode = process.env.MOBILE_CURL_FIXTURE_MODE;
let status = pathname === '/' ? 200 : 404;
if (association && mode === 'recover') status = wasRequested ? 503 : 404;
if (association && ['configured', 'exposed'].includes(mode)) status = 200;
if (pathname === '/.env' && mode === 'exposed') status = 200;
process.stdout.write(String(status));
`, { mode: 0o755 });
  try {
    await task(
      () => run("bash", [installer, "--check-only", "https://fixture.invalid"], {
        timeout: 30000,
        maxBuffer: 100000,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          MOBILE_CURL_FIXTURE_DIR: directory,
          MOBILE_CURL_FIXTURE_MODE: mode,
        },
      }),
      async () => JSON.parse(await fs.readFile(requests, "utf8")),
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("temporary 404 during reload recovers; all eight routes are checked", async () => {
  await withCurlFixture("recover", async (check, requests) => {
    const result = await check();
    assert.match(result.stdout, /Waiting for Nginx configuration/);
    assert.match(result.stdout, /apple-app-site-association: 503/);
    assert.match(result.stdout, /assetlinks.json: 503/);
    assert.match(result.stdout, /App association routing verified/);
    const paths = await requests();
    assert.equal(new Set(paths).size, 8);
    assert.ok(paths.filter(value => value === '/.well-known/apple-app-site-association').length > 1);
  });
});

test("configured association documents returning 200 are accepted", async () => {
  await withCurlFixture("configured", async (check) => {
    assert.match((await check()).stdout, /assetlinks.json: 200/);
  });
});

test("persistent association 404 fails instead of being ignored", { timeout: 35000 }, async () => {
  await withCurlFixture("missing", async (check) => {
    await assert.rejects(check(), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /apple-app-site-association returned 404/);
      assert.doesNotMatch(error.stdout, /routing verified/);
      return true;
    });
  });
});

test("hidden-file exposure fails even when association documents work", { timeout: 35000 }, async () => {
  await withCurlFixture("exposed", async (check) => {
    await assert.rejects(check(), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /\.env protection returned 200/);
      return true;
    });
  });
});
