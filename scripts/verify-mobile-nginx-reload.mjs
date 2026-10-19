import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

// Run as an ordinary user on a Linux host with Nginx installed. The only
// processes controlled here are children created by this test, on loopback.
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nginx = "/usr/sbin/nginx";
await fs.access(nginx);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scharade-reload-"));
const config = path.join(directory, "nginx.conf");
const installer = path.join(root, "deploy/enable-mobile-app-links.sh");
let associationStatus = 503;
const upstream = http.createServer((request, response) => {
  const association = [
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ].includes(request.url);
  response.writeHead(association ? associationStatus : request.url === "/" ? 200 : 404, {
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify({ test: true }));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const source = await fs.readFile(path.join(root, "deploy/security-nginx.conf"), "utf8");
const start = source.indexOf("    # Only the two app association documents");
const end = source.indexOf("    location ~* ^/(src", start);
assert.ok(start >= 0 && end > start, "Association exception and hidden-path rule must exist");
const candidateRoutes = source.slice(start, end).replaceAll(
  "http://127.0.0.1:4321", `http://127.0.0.1:${upstreamPort}`,
);
const originalRoutes = "location ~ /\\. { return 404; }";
const configuration = (routes) => `
daemon off;
master_process on;
worker_processes 2;
pid ${directory}/nginx.pid;
error_log ${directory}/error.log notice;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path ${directory}/body;
  proxy_temp_path ${directory}/proxy;
  server {
    listen 127.0.0.1:${port};
    server_name scharade.jp;
    ${routes}
    location / { proxy_pass http://127.0.0.1:${upstreamPort}; }
  }
}
`;
const argumentsFor = ["-p", directory, "-c", config, "-e", "stderr"];
const curlStatus = async (pathname) => {
  const { stdout } = await run("curl", [
    "--silent", "--show-error", "--http1.1", "--max-time", "3",
    "--header", "Connection: close", "--output", "/dev/null",
    "--write-out", "%{http_code}", `${base}${pathname}`,
  ]);
  return Number(stdout);
};
const waitForStatus = async (pathname, expected) => {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if (await curlStatus(pathname) === expected) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Temporary Nginx did not return ${expected} for ${pathname}`);
};
const check = () => run("bash", [installer, "--check-only", base], {
  timeout: 30000, maxBuffer: 100000,
});
await fs.writeFile(config, configuration(originalRoutes));
await run(nginx, ["-t", ...argumentsFor]);
const master = spawn(nginx, argumentsFor, { stdio: "ignore" });
let paused = false;
let resumeTimer;
try {
  await waitForStatus("/", 200);
  await waitForStatus("/.well-known/apple-app-site-association", 404);
  await fs.writeFile(config, configuration(candidateRoutes));
  await run(nginx, ["-t", ...argumentsFor]);

  // Delay only this test's master to make the real asynchronous reload race
  // deterministic: old workers continue accepting requests until it resumes.
  master.kill("SIGSTOP");
  paused = true;
  await run(nginx, ["-s", "reload", ...argumentsFor]);
  assert.equal(await curlStatus("/.well-known/apple-app-site-association"), 404);
  console.log("Reproduced: reload command succeeds while old workers still return 404.");

  const checker = spawn("bash", [installer, "--check-only", base], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "", errors = "";
  checker.stdout.on("data", (chunk) => {
    output += chunk;
    if (output.includes("Waiting for Nginx configuration") && !resumeTimer) {
      resumeTimer = setTimeout(() => { master.kill("SIGCONT"); paused = false; }, 250);
    }
  });
  checker.stderr.on("data", (chunk) => { errors += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { checker.kill("SIGTERM"); }, 30000);
    checker.once("error", reject);
    checker.once("exit", (value) => { clearTimeout(timeout); resolve(value); });
  });
  assert.equal(code, 0, errors + output);
  assert.match(output, /Waiting for Nginx configuration/);
  assert.match(output, /apple-app-site-association: 503/);
  assert.match(output, /assetlinks.json: 503/);
  console.log("Passed: the actual installer waits for activation and checks all 8 routes.");

  associationStatus = 200;
  assert.match((await check()).stdout, /App association routing verified/);
  console.log("Passed: configured association documents with HTTP 200 are accepted.");

  await fs.writeFile(config, configuration(originalRoutes));
  await run(nginx, ["-s", "reload", ...argumentsFor]);
  await waitForStatus("/.well-known/apple-app-site-association", 404);
  await assert.rejects(check(), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /returned 404/);
    assert.doesNotMatch(error.stdout, /routing verified/);
    return true;
  });
  console.log("Passed: persistent 404 fails after the bounded readiness wait.");

  await fs.writeFile(config, configuration(
    `location = /.env { return 200; }\n${candidateRoutes}`,
  ));
  await run(nginx, ["-s", "reload", ...argumentsFor]);
  await waitForStatus("/.env", 200);
  await assert.rejects(check(), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /\.env protection returned 200/);
    return true;
  });
  console.log("Passed: an exposed hidden path fails even when association routes work.");
  console.log("All reload regression checks passed. Production Nginx was not changed.");
} finally {
  clearTimeout(resumeTimer);
  if (paused) master.kill("SIGCONT");
  if (master.exitCode === null && master.signalCode === null) {
    const stopped = new Promise((resolve) => master.once("exit", resolve));
    const stopTimer = setTimeout(() => master.kill("SIGTERM"), 3000);
    master.kill("SIGQUIT");
    await stopped;
    clearTimeout(stopTimer);
  }
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
