import test from "node:test";
import assert from "node:assert/strict";
import { portfolioIntroductionHtml, portfolioIntroductionText, sanitizePortfolioIntroduction, serializePortfolioIntroduction } from "../src/lib/portfolioIntroduction.ts";
import { INTRODUCTION_HTML_PREFIX, introductionColor, introductionLink } from "../src/utils/portfolioIntroduction.ts";

test("legacy introductions preserve line breaks, indentation and literal HTML without interpreting it", () => {
  const plain = '<strong>文字</strong> & 記号\n  字下げ\r\n次の行';
  assert.equal(portfolioIntroductionHtml(plain), '<p>&lt;strong&gt;文字&lt;/strong&gt; &amp; 記号<br>  字下げ<br>次の行</p>');
  assert.equal(portfolioIntroductionHtml(), "");
});

test("formatted introductions round-trip formatting, lists, browser colors and safe links", () => {
  const input = '<p><b>太字</b><i>斜体</i><u>下線</u><span style="color:rgb(12, 34, 56);font-weight:700">色</span><font color="#abc">旧式色</font></p><ul><li>一</li></ul><ol><li>二</li></ol><a href="https://example.com/a?x=1&amp;y=2" target="_top">URL</a>';
  const saved = serializePortfolioIntroduction(input);
  const html = portfolioIntroductionHtml(saved);
  assert.ok(saved.startsWith(INTRODUCTION_HTML_PREFIX));
  assert.match(html, /<strong>太字<\/strong><em>斜体<\/em><u>下線<\/u>/);
  assert.match(html, /color:#0c2238;font-weight:700/);
  assert.match(html, /color:#aabbcc/);
  assert.match(html, /<ul><li>一<\/li><\/ul><ol><li>二<\/li><\/ol>/);
  assert.match(html, /target="_blank" rel="noopener noreferrer ugc"/);
  assert.equal(serializePortfolioIntroduction(html), saved);
  assert.equal(portfolioIntroductionText(html), "太字斜体下線色旧式色一二URL");
});

test("stored rich text strips active content, images, unsafe links and layout or external CSS", () => {
  const html = portfolioIntroductionHtml(INTRODUCTION_HTML_PREFIX + '<p id="site-menu" class="auth-link" onclick="alert(1)" style="position:fixed;color:#ff0000;background:url(https://evil.invalid/x);font-size:99px">本文</p><script>alert(1)</script><svg onload="alert(1)"><a href="https://evil.invalid">SVG</a></svg><img src="https://images.microcms-assets.io/x.jpg" onerror="alert(1)"><iframe src="https://evil.invalid">fallback</iframe><a href="javascript:alert(1)">危険</a><a href="data:text/html,x">データ</a><a href="//evil.invalid">相対</a><a href="https://name:pass@example.com">認証</a><span style="color:rgb(999,0,0);font-style:italic">斜体</span>');
  assert.match(html, /<p style="color:#ff0000">本文<\/p>/);
  assert.match(html, /<span style="font-style:italic">斜体<\/span>/);
  assert.doesNotMatch(html, /script|alert|svg|img|iframe|evil\.invalid|javascript:|data:|position|background|font-size|onclick|onerror|id=|class=|999|name:pass/);
});

test("preserves browser underline formats through repeated sanitizing", () => {
  const input = '<span style="text-decoration-line: underline; color: rgb(196, 43, 72); font-size: x-large">一</span>'
    + '<span style="text-decoration: underline solid rgb(0, 0, 0)">二</span>'
    + '<span style="text-decoration-line: line-through underline">三</span>'
    + '<span style="text-decoration-line: url(https://example.invalid/); position: fixed">四</span>';
  const clean = sanitizePortfolioIntroduction(input, true);
  assert.equal(clean, '<span style="text-decoration:underline;color:#c42b48;font-size:24px">一</span>'
    + '<span style="text-decoration:underline">二</span>'
    + '<span style="text-decoration:line-through underline">三</span><span>四</span>');
  assert.equal(sanitizePortfolioIntroduction(clean, true), clean);
});

test("empty formatted introductions clear the field and text counting decodes entities once", () => {
  assert.equal(serializePortfolioIntroduction("<p><br></p>"), "");
  assert.equal(serializePortfolioIntroduction('<p><img src="https://images.microcms-assets.io/x.jpg"></p>'), "");
  assert.equal(portfolioIntroductionText("<p>&amp; &lt; &gt; &amp;lt; &#x1F4F7;</p>"), "& < > &lt; 📷");
});

test("link and color validation accepts common values while rejecting executable and credential URLs", () => {
  assert.equal(introductionLink("https://example.com"), "https://example.com/");
  assert.equal(introductionLink("http://example.com/a"), "http://example.com/a");
  assert.equal(introductionLink("mailto:contact@example.com"), "mailto:contact@example.com");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//example.com", "/internal", "https://user:pass@example.com", "https://example.com/\nx"]) assert.equal(introductionLink(url), "");
  assert.equal(introductionColor("rgb(12, 34, 56)"), "#0c2238");
  assert.equal(introductionColor("#AbC"), "#aabbcc");
  assert.equal(introductionColor("rgb(256,0,0)"), "");
  assert.equal(introductionColor("url(https://example.com)"), "");
  assert.equal(sanitizePortfolioIntroduction('<span style="color:#abc">色</span>'), '<span style="color:#aabbcc">色</span>');
});
