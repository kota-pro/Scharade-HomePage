// CVE-2026-111497 is fixed in Node 22.23.4. Node backports the decoder
// fix, so process.versions.brotli alone cannot identify a patched runtime.
export const supportedNodeRange = ">=22.23.4 <23";

export function runtimeSecurityFailure(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match) {
    const [, major, minor, patch] = match.map(Number);
    if (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) return null;
  }
  return `Node.js ${version}: ${supportedNodeRange} is required (CVE-2026-111497 / HTTP2Shell). Use an official patched Node.js release.`;
}

export function assertSecureRuntime(version = process.versions.node) {
  const failure = runtimeSecurityFailure(version);
  if (failure) throw new Error(failure);
}
