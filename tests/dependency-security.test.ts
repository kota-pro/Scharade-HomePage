import { test } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { createRequire } from "node:module";
import { sanitizeArticleHtml } from "../src/lib/contentSecurity.ts";
import { sanitizePortfolioIntroduction } from "../src/lib/portfolioIntroduction.ts";

test("URI normalization cannot turn an encoded scheme into an executable or trusted scheme", () => {
  const uri = createRequire(import.meta.url)("fast-uri");
  for (const value of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)", "%68ttp://example.invalid/"]) {
    assert.equal(uri.normalize(value), value);
    assert.doesNotMatch(uri.parse(value).scheme, /^(?:javascript|http)$/);
  }
  assert.equal(uri.equal("%68ttp://example.invalid/", "http://example.invalid/"), false);
  assert.equal(uri.parse("https://example.invalid/").scheme, "https");
});

test("discarded nested iframe content cannot overflow the article or Portfolio sanitizer stack", () => {
  const input = "<iframe>".repeat(1500) + '<script>alert(1)</script><p>架空の本文</p>';
  for (const sanitize of [sanitizeArticleHtml, sanitizePortfolioIntroduction]) {
    let result = "";
    assert.doesNotThrow(() => { result = sanitize(input); });
    assert.doesNotMatch(result, /<iframe|<script/i);
    assert.ok(result.length <= input.length * 6);
  }
});

for (const [name, address, expected] of [
  ["nested comments", "Recipient (x(y) <unintended@example.invalid>) <intended@example.invalid>", "intended@example.invalid"],
  ["semicolon in a group comment", "Group: (x; <unintended@example.invalid>) <intended@example.invalid>;", "intended@example.invalid"],
  ["semicolon in a quoted group name", 'Group: "x;" "<unintended@example.invalid>" <intended@example.invalid>;', "intended@example.invalid"],
] as const) {
  test(`mail transport preserves the intended recipient with ${name}`, async () => {
    // This transport only builds a message in memory; it cannot open an SMTP connection.
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const message = await transport.sendMail({
      from: "sender@example.invalid", to: address,
      subject: "Synthetic local recipient test", text: "No network transport or real recipients.",
    });
    assert.deepEqual(message.envelope.to, [expected]);
  });
}

test("an angle bracket inside a quoted mailbox cannot change its destination domain", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const message = await transport.sendMail({
    from: "sender@example.invalid", to: '<"x@unintended.invalid>"@intended.invalid>',
    subject: "Synthetic local recipient test", text: "No network transport or real recipients.",
  });
  assert.equal(message.envelope.to.length, 1);
  assert.match(message.envelope.to[0], /@intended\.invalid$/);
});
