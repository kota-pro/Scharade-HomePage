import test from "node:test";
import assert from "node:assert/strict";
import { privateNavigation, privateSection } from "../src/lib/privateNavigation.ts";

test("private navigation exposes only authorized workspaces and keeps account at the right edge", () => {
  assert.equal(privateNavigation({ staff: true, admin: false }).find(e => e.key === "staff")?.href, "/Management");
  assert.deepEqual(privateNavigation({ staff: false, admin: false }).map(e => e.key), ["home", "events", "account"]);
  assert.deepEqual(privateNavigation({ staff: true, admin: false }).map(e => e.key), ["home", "events", "staff", "account"]);
  assert.deepEqual(privateNavigation({ staff: true, admin: true }).map(e => e.key), ["home", "events", "staff", "admin", "account"]);
});

test("nested pages, calendar links and dashboard anchors highlight their own destination", () => {
  for (const path of ["/Admin", "/Admin/", "/Admin/accounts/member"]) assert.equal(privateSection(path), "admin");
  for (const path of ["/Management", "/Dashboard", "/Member/manage", "/Member/manage/events/new", "/Member/manage/exhibitions/1/layout"]) assert.equal(privateSection(path), "staff");
  for (const path of ["/Member/events/1", "/Member/exhibitions/1"]) assert.equal(privateSection(path), "events");
  for (const path of ["/Member/profile", "/Member/security", "/Member/advance", "/Member/account-deletion"]) assert.equal(privateSection(path), "account");
  assert.equal(privateSection("/Member", "#my-page", "calendar"), "account");
  assert.equal(privateSection("/Member", "#events-heading"), "events");
  assert.equal(privateSection("/Member", "", "calendar"), "events");
  assert.equal(privateSection("/Member/notifications/1"), "home");
  assert.equal(privateSection("/Member"), "home");
  assert.equal(privateSection("/Administrator"), "home");
});
