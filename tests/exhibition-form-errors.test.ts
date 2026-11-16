import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { exhibitionErrors, exhibitionErrorCode, formatExhibitionError } from '../src/lib/exhibitionErrors.ts';
import { ExhibitionError, exhibitionErrorBody, parseContent } from '../src/lib/exhibitionValidation.ts';
import { emptySubmission, type SubmissionContent } from '../src/lib/exhibitionTypes.ts';
import { exhibitionAction, publicAction, readExhibitions, updateExhibitionStore, uploadExhibitionAsset } from '../src/lib/exhibitions.ts';
import { writeData } from '../src/lib/store.ts';
import { POST } from '../src/pages/api/exhibitions/[id].ts';
import { createTextMeasurement } from '../src/scripts/exhibitionTextMeasurement.ts';

const sectionId = crypto.randomUUID();
const schema = { version: 1, sections: [{ id: sectionId, title: '通常展示', description: '' }], fields: [], captionLabel: 'キャプション' };
const photo = (assetId = '') => ({ assetId, x: -20, y: 0, width: 120, height: 80, rotation: 0 });
function content(kind: 'single' | 'series' | 'book' = 'single', targetSection: string = sectionId): SubmissionContent {
  return { ...emptySubmission(), name: '作者', authorName: '作者', grade: '2年',
    sections: [{ sectionId: targetSection, singles: kind === 'single' ? 1 : 0, series: kind === 'series' ? 1 : 0, books: kind === 'book' ? 1 : 0, seriesPhotoCounts: kind === 'series' ? [2] : [], fields: {} }],
    works: [{ id: crypto.randomUUID(), sectionId: targetSection, kind, title: '光', caption: '', location: '', equipment: '', settings: '', fields: {}, photos: kind === 'series' ? [photo(), photo()] : [photo()] }] };
}
test('missing single/series uploads give an actionable numbered error; drafts retain empty slots and coordinates', () => {
  for (const kind of ['single', 'series'] as const) {
    const value = content(kind);
    assert.deepEqual(parseContent(value, schema, [], false).works[0].photos, value.works[0].photos);
    assert.throws(() => parseContent(value, schema, [], true), (error: unknown) => {
      assert.ok(error instanceof ExhibitionError); assert.equal(error.code, 'EXH-001');
      assert.match(error.message, /提出する写真の枚数分、写真を添付してください。通常展示・作品1/);
      assert.doesNotMatch(error.message, /識別番号/); return true;
    });
  }
  assert.equal(parseContent(content('book'), schema, [], true).works[0].photos.length, 0);
});
test('malformed and foreign photo references remain rejected, with a reattach instruction', () => {
  for (const assetId of ['invalid-id', crypto.randomUUID()]) {
    const value = content(); value.works[0].photos[0].assetId = assetId;
    assert.throws(() => parseContent(value, schema, [], true), (error: unknown) => {
      assert.ok(error instanceof ExhibitionError); assert.equal(error.code, 'EXH-002');
      assert.match(exhibitionErrorBody(error).message, /もう一度選んで添付/); return true;
    });
  }
});
test('the public API numbers errors and does not create a submitted version for an incomplete series', async () => {
  const previous = process.env.DATA_DIR, directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scharade-form-errors-'));
  process.env.DATA_DIR = directory;
  try {
    writeData('users.json', [
      { id: 'staff', name: '運営', email: 'staff@example.invalid', approved: true, role: 'staff', createdAt: '', providers: {} },
      { id: 'author', name: '作者', email: 'author@example.invalid', approved: true, role: 'member', createdAt: '', providers: {} },
    ]);
    const e = (await exhibitionAction('staff', { action: 'create', title: '提出エラーの確認' })).exhibition;
    await updateExhibitionStore(data => { const ex = data.exhibitions[0], now = Date.now(); ex.status = 'open'; ex.opensAt = new Date(now - 60000).toISOString(); ex.closesAt = new Date(now + 60000).toISOString(); ex.participation = { state: 'published', opensAt: ex.opensAt, closesAt: ex.closesAt, recipientIds: ['author'], votes: { author: { value: 'attending', at: ex.opensAt, actorId: 'author' } } }; });
    let s = (await publicAction(e.id, '', { action: 'begin' }, 'author')).submission;
    const value = content('series', e.schemas[0].sections[0].id), assetId = crypto.randomUUID();
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
    await uploadExhibitionAsset(e.id, '', assetId, new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }), 'author');
    value.works[0].photos[0].assetId = assetId;
    s = (await publicAction(e.id, '', { action: 'save', revision: s.revision, content: value }, 'author')).submission;
    const response = await POST({ params: { id: e.id }, locals: { user: { id: 'author' } }, request: new Request(`http://localhost/api/exhibitions/${e.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', revision: s.revision, content: value }) }) } as any);
    assert.equal(response.status, 400); const body = await response.json();
    assert.equal(body.code, 'EXH-001'); assert.match(body.message, /写真2枚目/);
    assert.equal(readExhibitions().submissions[0].versions.length, 0);
    assert.deepEqual(readExhibitions().submissions[0].draft, s.draft);
    const secondId = crypto.randomUUID();
    await uploadExhibitionAsset(e.id, '', secondId, new File([new Uint8Array(bytes)], 'second.png', { type: 'image/png' }), 'author');
    value.works[0].photos[1].assetId = secondId;
    s = (await publicAction(e.id, '', { action: 'submit', revision: s.revision, content: value }, 'author')).submission;
    assert.equal(s.versions.length, 1);
  } finally { if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous; fs.rmSync(directory, { recursive: true, force: true }); }
});
test('error numbers are stable, documented, idempotent, and replace internal ID terminology', () => {
  const doc = fs.readFileSync(new URL('../docs/exhibition-errors.md', import.meta.url), 'utf8');
  for (const code of Object.keys(exhibitionErrors)) assert.ok(doc.includes(`| ${code} |`), code);
  const formatted = formatExhibitionError('識別番号を確認してください。');
  assert.match(formatted, /^エラー番号：EXH-003\n作品や展示の情報/);
  assert.equal(formatExhibitionError(formatted), formatted);
  assert.equal(formatExhibitionError(formatted, 'EXH-015'), formatted);
  assert.equal(exhibitionErrorCode('Failed to fetch'), 'EXH-013');
  assert.equal(exhibitionErrorBody(new Error('private internal detail')).message, exhibitionErrors['EXH-015']);
});
test('failed font acquisition is retried; simultaneous callers share work and successful measurements are reused', async () => {
  let attempts = 0;
  const measure = () => 12;
  const loader = createTextMeasurement(async () => { if (++attempts === 1) throw new Error('temporary'); return measure; });
  await assert.rejects(loader.load(), /temporary/); assert.equal(loader.unavailable(), true);
  await Promise.all([loader.load(), loader.load()]); await loader.load();
  assert.equal(attempts, 2); assert.equal(loader.get(), measure); assert.equal(loader.unavailable(), false);
});
test('a stalled font load times out and cannot overwrite a subsequent successful retry', async () => {
  let resolve!: (measure: () => number) => void, attempts = 0;
  const good = () => 10;
  const loader = createTextMeasurement(() => ++attempts === 1 ? new Promise(r => { resolve = r; }) : Promise.resolve(good), 15);
  await assert.rejects(loader.load(), /timed out/);
  await loader.load(); resolve(() => 99); await Promise.resolve();
  assert.equal(loader.get(), good); assert.equal(attempts, 2);
});
