import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeData } from '../src/lib/store.ts';
import { numberErrorResponse } from '../src/lib/siteErrorResponse.ts';
import { GET as exhibition } from '../src/pages/api/member/exhibitions/[id].ts';
import { GET as layout } from '../src/pages/api/member/exhibitions/[id]/layout.ts';
import { GET as participation } from '../src/pages/api/member/exhibitions/[id]/participation.ts';
import { GET as output } from '../src/pages/api/member/exhibitions/[id]/output.ts';
import { GET as asset } from '../src/pages/api/exhibitions/[id]/assets/[assetId].ts';
import { GET as archivedOutput } from '../src/pages/api/member/exhibitions/[id]/outputs/[outputId].ts';
import { exhibitionAction, readExhibitions } from '../src/lib/exhibitions.ts';
import { siteErrorDetails, siteErrorBody, formatSiteError } from '../src/lib/siteErrors.ts';
import { normalizeErrorReport, isReportableError, errorReportDescription } from '../src/lib/siteErrorReport.ts';

test('exhibition route serializers retain the feature number instead of reclassifying its text as a SITE error', async () => {
  const previous = process.env.DATA_DIR, directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scharade-api-errors-'));
  process.env.DATA_DIR = directory;
  try {
    const user = { id: 'staff', name: '確認', email: 'staff@example.invalid', role: 'staff', approved: true, providers: {} };
    writeData('users.json', [user]);
    for (const handler of [exhibition, layout, participation, output, asset]) {
      const response = await numberErrorResponse(await handler({ locals: { user }, params: { id: crypto.randomUUID(), assetId: crypto.randomUUID() }, url: new URL('http://localhost/fixture'), request: new Request('http://localhost/fixture') } as any));
      const body = await response.json();
      assert.equal(response.status, 404); assert.equal(body.code, 'EXH-019');
      assert.equal(body.errorCode, 'EXH-019'); assert.equal(response.headers.get('X-Error-Code'), 'EXH-019');
      assert.match(body.message, /^エラー番号：EXH-019\n/);
    }
    const created = (await exhibitionAction(user.id, { action: 'create', title: 'ファイル欠落の検証' })).exhibition;
    const data = readExhibitions(), assetId = crypto.randomUUID(), outputId = crypto.randomUUID();
    data.assets.push({ id: assetId, exhibitionId: created.id, mimeType: 'image/png', name: 'synthetic.png' } as any);
    data.outputs = [{ id: outputId, exhibitionId: created.id, mimeType: 'image/png', name: 'synthetic-output.png' } as any];
    writeData('exhibitions.json', data);
    for (const handler of [asset, archivedOutput]) {
      const response = await handler({ locals: { user }, params: { id: created.id, assetId, outputId }, url: new URL('http://localhost/fixture') } as any);
      assert.equal(response.status, 503, 'metadata exists but its file is missing: storage incident, not an ordinary 404');
      assert.equal((await response.json()).errorCode, 'EXH-014');
    }
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('registered configuration and partial-success explanations survive API/UI/mail without accepting arbitrary message text', () => {
  for (const [detail, value] of Object.entries(siteErrorDetails)) {
    const body = siteErrorBody({ ok: false, message: value.message }, 422) as any;
    assert.equal(body.errorCode, value.code); assert.equal(body.errorDetail, detail);
    assert.equal(body.message, formatSiteError(value.message, value.code));
    const report = normalizeErrorReport({ code: body.errorCode, detail: body.errorDetail, kind: 'server', status: 422, route: '/api/portfolio/update' })!;
    assert.equal(isReportableError(report), true);
    assert.equal(body.message, `エラー番号：${report.code}\n${errorReportDescription(report.code, report.detail)}`);
  }
  const report = normalizeErrorReport({ code: 'SITE-001', detail: 'cms-generation-field', kind: 'server', status: 422, route: '/' })!;
  assert.equal(report.detail, undefined); assert.equal(isReportableError(report), false);
  assert.equal((siteErrorBody({ ok: false, errorDetail: 'cms-generation-field', message: 'private-user-text' }, 400) as any).errorDetail, undefined);
});
