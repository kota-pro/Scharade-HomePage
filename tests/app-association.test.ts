import test from "node:test";
import assert from "node:assert/strict";
import { GET as apple } from "../src/pages/.well-known/apple-app-site-association.ts";
import { GET as android } from "../src/pages/.well-known/assetlinks.json.ts";
test("unconfigured app links fail closed; configured links use the exact bundle/package and signing certificate", async () => {
  const oldTeam = process.env.APPLE_TEAM_ID,
    oldAndroid = process.env.ANDROID_APP_SIGNING_SHA256;
  try {
    delete process.env.APPLE_TEAM_ID;
    delete process.env.ANDROID_APP_SIGNING_SHA256;
    assert.equal(((await apple({} as any)) as Response).status, 503);
    assert.equal(((await android({} as any)) as Response).status, 503);
    process.env.APPLE_TEAM_ID = "AB12CD34EF";
    const a = (await apple({} as any)) as Response;
    assert.equal(a.status, 200);
    assert.deepEqual((await a.json()).applinks.details[0].appIDs, [
      "AB12CD34EF.jp.scharade.app",
    ]);
    process.env.ANDROID_APP_SIGNING_SHA256 = Array(32).fill("AB").join(":");
    const b = (await android({} as any)) as Response;
    assert.equal(b.status, 200);
    const links = await b.json();
    assert.equal(links[0].target.package_name, "jp.scharade.app");
    assert.deepEqual(links[0].target.sha256_cert_fingerprints, [
      process.env.ANDROID_APP_SIGNING_SHA256,
    ]);
    process.env.ANDROID_APP_SIGNING_SHA256 = "not-a-certificate";
    assert.equal(((await android({} as any)) as Response).status, 503);
  } finally {
    if (oldTeam === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = oldTeam;
    if (oldAndroid === undefined) delete process.env.ANDROID_APP_SIGNING_SHA256;
    else process.env.ANDROID_APP_SIGNING_SHA256 = oldAndroid;
  }
});
