import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { assertSecureRuntime, runtimeSecurityFailure } from "../scripts/runtime-policy.mjs";

test("runtime policy accepts only patched stable Node 22 releases", () => {
  for (const version of ["22.23.4", "22.23.5", "22.24.0", "22.100.0"]) {
    assert.equal(runtimeSecurityFailure(version), null, version);
    assert.doesNotThrow(() => assertSecureRuntime(version));
  }
  for (const version of ["20.20.0", "22.12.0", "22.23.1", "22.23.3", "23.0.0", "24.22.1", "26.12.1", "22.23.4-rc.1", "", "garbage"]) {
    assert.match(runtimeSecurityFailure(version), /CVE-2026-111497/, version);
    assert.throws(() => assertSecureRuntime(version), /22\.23\.4/);
  }
});

test("runtime preloader runs before the application entry", () => {
  const guard = new URL("../scripts/require-secure-runtime.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--import", guard, "-e", "console.log('entry reached')"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "entry reached");
});

test("an unsupported runtime stops before entry code and preflight reports JSON", () => {
  const override = "data:text/javascript," + encodeURIComponent("Object.defineProperty(process.versions, 'node', {value:'22.23.3'})");
  const guard = new URL("../scripts/require-secure-runtime.mjs", import.meta.url).href;
  const stopped = spawnSync(process.execPath, ["--import", override, "--import", guard, "-e", "console.log('entry reached')"], { encoding: "utf8" });
  assert.notEqual(stopped.status, 0);
  assert.equal(stopped.stdout, "");
  assert.match(stopped.stderr, /CVE-2026-111497/);
  const preflight = new URL("../scripts/security-preflight.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", override, preflight.pathname, "--offline"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.ok(report.failures.some(failure => failure.includes("CVE-2026-111497")));
});
