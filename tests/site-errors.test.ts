import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeSiteError, formatSiteError, siteErrorBody, siteErrorCode, siteErrors } from '../src/lib/siteErrors.ts';
import { numberErrorResponse, siteFailurePage } from '../src/lib/siteErrorResponse.ts';
import { json } from '../src/lib/http.ts';
import { exhibitionErrors, exhibitionErrorCode } from '../src/lib/exhibitionErrors.ts';
import { errorReportDescription } from '../src/lib/siteErrorReport.ts';
import { readApiResponse } from '../src/scripts/apiResponse.ts';
import { readExhibitionResponse } from '../src/scripts/exhibitionResponse.ts';

test('HTTP outcomes win over incidental words in login, MFA, uploads and integration instructions', () => {
  for (const message of ['ログイン試行が集中しています。15分後に再度お試しください。', '確認コードを再取得してください。', 'パスワードを確認してください。', '写真ファイルを確認してください。']) {
    for (const [status, site, exhibition] of [[429,'SITE-008','EXH-020'],[413,'SITE-005','EXH-021'],[403,'SITE-003','EXH-010'],[404,'SITE-006','EXH-019'],[409,'SITE-004','EXH-012'],[503,'SITE-011','EXH-015'],[0,'SITE-012','EXH-013']] as const) {
      assert.equal(siteErrorCode(message, status), site, `${status}: ${message}`);
      assert.equal(exhibitionErrorCode(message, status), exhibition, `${status}: ${message}`);
    }
  }
});
test('every incident code survives API middleware, generic and exhibition clients and legacy message-only clients with exactly the emailed description', async () => {
  for (const code of [...Object.keys(siteErrors), ...Object.keys(exhibitionErrors)] as (keyof typeof siteErrors | keyof typeof exhibitionErrors)[]) {
    const source = Response.json({ ok: false, errorCode: code, code: 'legacy-operation', message: '非公開の入力内容。' }, { status: 503 });
    const numbered = await numberErrorResponse(source), body = await numbered.clone().json();
    const expected = `エラー番号：${code}\n${errorReportDescription(code)}`;
    assert.equal(body.message, expected, code);
    assert.equal(body.errorCode, code); assert.equal(body.code, 'legacy-operation');
    assert.equal(numbered.headers.get('X-Error-Code'), code);
    assert.equal((await readApiResponse(numbered.clone())).message, expected);
    assert.equal((await readExhibitionResponse(numbered.clone())).message, expected);
    assert.equal(formatSiteError(body.message), expected);
    assert.deepEqual(await (await numberErrorResponse(numbered)).json(), body);
  }
});
test('invalid JSON error shapes, empty messages and HTTP-200 error envelopes always have usable numbering', async () => {
  for (const value of [null, [], 'bad', 123, {}]) {
    const response = await numberErrorResponse(Response.json(value, { status: 503 }));
    assert.equal((await response.json()).message, `エラー番号：SITE-011\n${siteErrors['SITE-011']}`);
  }
  const result = await numberErrorResponse(Response.json({ ok: false, message: 'ログインが必要です。', errorCode: 'SITE-002' }));
  assert.equal(result.headers.get('X-Error-Code'), 'SITE-002');
  assert.match((await result.json()).message, /^エラー番号：SITE-002\n/);
  assert.equal((siteErrorBody({ ok: false, errorCode: 'unknown', code: 'EXH-004', message: '文字数や改行を減らしてください。' }, 400) as any).errorCode, 'EXH-004');
  const malformed = await numberErrorResponse(new Response('{broken', { headers: { 'Content-Type': 'application/json' } }));
  assert.equal(malformed.status, 502); assert.equal((await malformed.json()).errorCode, 'SITE-009');
  for (const value of [null, [], 'value']) {
    const valid = Response.json(value); assert.equal(await numberErrorResponse(valid), valid);
  }
  const html = await numberErrorResponse(new Response('<h1>private exception text</h1>', { status: 500, headers: { 'Content-Type': 'text/html', 'Set-Cookie': 'session=; Max-Age=0' } }));
  assert.equal(html.status, 500); assert.equal(html.headers.get('Set-Cookie'), 'session=; Max-Age=0');
  const text = await html.text(); assert.match(text, /エラー番号：SITE-011/); assert.doesNotMatch(text, /private exception/);
});

test('common failures have stable numbers and useful instructions without browser or internal diagnostics', () => {
  const examples: [string, number, string][] = [
    ['名前を入力してください。', 400, 'SITE-001'], ['ログインが必要です。', 401, 'SITE-002'],
    ['管理者権限が必要です。', 403, 'SITE-003'], ['別の画面で変更されています。', 409, 'SITE-004'],
    ['送信内容が大きすぎます。', 413, 'SITE-005'], ['ページが見つかりません。', 404, 'SITE-006'],
    ['現在は受付期間外です。', 400, 'SITE-007'], ['操作が集中しています。', 429, 'SITE-008'],
    ['処理結果を確認できませんでした。', 502, 'SITE-009'], ['識別番号を確認してください。', 400, 'SITE-010'],
    ['保存できませんでした。', 503, 'SITE-011'], ['Failed to fetch', 0, 'SITE-012'],
    ['コピーできませんでした。', 400, 'SITE-013'], ['Google連携の設定を確認してください。', 400, 'SITE-014'],
    ['確認コードが違います。', 400, 'SITE-015'], ['パスワードが違います。', 401, 'SITE-016'],
  ];
  for (const [message, status, code] of examples) {
    assert.equal(siteErrorCode(message, status), code);
    const detail = describeSiteError(message, status);
    const displayed = formatSiteError(detail.message, detail.code);
    assert.ok(displayed.startsWith(`エラー番号：${code}\n`));
    assert.match(detail.message, /ください|ご確認|お試し|お問い合わせ/);
    assert.doesNotMatch(detail.message, /識別番号|Failed to fetch/);
    assert.equal(formatSiteError(displayed), displayed);
  }
});
test('successful responses, feature codes, details and uncertain submission warnings are preserved', async () => {
  const success = { ok: true, code: '123456', value: 12 }; assert.equal(siteErrorBody(success, 200), success);
  assert.deepEqual(await json(success).json(), success);
  const feature = { ok: false, code: 'EXH-001', message: '提出する写真の枚数分、写真を添付してください。', issues: [{ path: 'photo' }] };
  assert.deepEqual(siteErrorBody(feature, 400), { ...feature, errorCode: 'EXH-001', message: formatSiteError(feature.message, feature.code) });
  const legacy = siteErrorBody({ ok: false, code: 'legacy-machine-code', message: '確認コードを再取得してください。' }, 400) as any;
  assert.equal(legacy.code, 'legacy-machine-code'); assert.equal(legacy.errorCode, 'SITE-015');
  const uncertain = '処理結果を確認できませんでした。重複して送信せず、送信先の状態を確認してください。';
  assert.equal(describeSiteError(uncertain, 502).message, siteErrors['SITE-009']);
  const mail = '承認は完了しましたが、メールを送信できませんでした。「確定する」で通知を再試行できます。';
  assert.deepEqual(describeSiteError(mail), { code: 'SITE-009', message: mail });
  assert.match(formatSiteError('エラー番号：EXH-001\n提出する写真の枚数分、写真を添付してください。'), /^エラー番号：EXH-001\n/);
});
test('middleware numbering includes local JSON serializers and plain denials, retaining status and cookies', async () => {
  const response = new Response(JSON.stringify({ ok: false, message: 'ログインが必要です。' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'mfa=; Max-Age=0', 'Cache-Control': 'no-store', 'Content-Length': '1' } });
  const numbered = await numberErrorResponse(response);
  assert.equal(numbered.status, 401); assert.equal(numbered.headers.get('X-Error-Code'), 'SITE-002');
  assert.equal(numbered.headers.get('Set-Cookie'), 'mfa=; Max-Age=0'); assert.equal(numbered.headers.get('Cache-Control'), 'no-store');
  assert.equal(numbered.headers.get('Content-Length'), null);
  assert.equal((await numbered.json()).errorCode, 'SITE-002');
  const plain = await numberErrorResponse(new Response('管理者権限が必要です。', { status: 403 }));
  assert.match(await plain.text(), /^エラー番号：SITE-003\n/);
  const stream = new Response('data: ready\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  assert.equal(await numberErrorResponse(stream), stream);
  const page = siteFailurePage(); assert.equal(page.status, 503); assert.match(page.headers.get('Content-Type')!, /text\/html/);
  const html = await page.text(); assert.match(html, /エラー番号：SITE-011/); assert.match(html, /時間をおいて/); assert.doesNotMatch(html, /JSON|stack|undefined/);
});
test('all public numbers are present in the support mapping', () => {
  const docs = fs.readFileSync(new URL('../docs/error-codes.md', import.meta.url), 'utf8');
  for (const code of Object.keys(siteErrors)) assert.ok(docs.includes(`| ${code} |`), code);
});
