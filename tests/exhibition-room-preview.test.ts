import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { roomPreview } from '../src/lib/exhibitionRoomPreview.ts';
import { roomOutline } from '../src/lib/exhibitionRoomPath.ts';
import type { RoomLayout } from '../src/lib/exhibitionTypes.ts';

const room = (): RoomLayout => ({
  id: crypto.randomUUID(), name: 'プレビュー会場',
  vertices: [{ x: -1000, y: 0, radius: 250 }, { x: 5000, y: 0 }, { x: 5000, y: 4000 }, { x: -1000, y: 4000 }],
  wallHeights: [3000, 3000, 3000, 3000], placements: [], books: [],
  openings: [{ id: crypto.randomUUID(), wall: 0, kind: 'door', offset: 1000, width: 900, bottom: 0, height: 2000 }],
  tables: [{ id: crypto.randomUUID(), name: '受付', x: 6800, y: 800, width: 1000, depth: 600, rotation: 30 }],
  boardGroups: [{ id: crypto.randomUUID(), name: '連結ボード', x: 1000, y: 2000, rotation: 0,
    panels: [0, 1].map(i => ({ id: crypto.randomUUID(), name: `パネル${i + 1}`, width: 900, height: 1800, thickness: 30, hingeAngle: i ? 45 : 0 })) }],
  annotations: [{ id: crypto.randomUUID(), kind: 'image', assetId: 'fixture', x: 2000, y: 900, width: 600, height: 500, rotation: 0, fontSize: 100, text: '' }],
});

test('overview uses curved room, fixtures and images, fits all visible geometry and does not change saved data', () => {
  const r = room(), before = structuredClone(r);
  for (const width of [650, 300]) {
    const p = roomPreview(r, [], { width, imageUrl: id => `/images/${id}` });
    assert.ok(p.svg.includes(`d="${roomOutline(r).svg}"`));
    assert.match(p.svg, /data-preview-layout-kind="opening"/);
    assert.match(p.svg, /data-preview-layout-kind="table"/);
    assert.equal([...p.svg.matchAll(/data-preview-board-panel=/g)].length, 2);
    assert.match(p.svg, /href="\/images\/fixture"/);
    assert.doesNotMatch(p.svg, /\sdata-(layout|label|board)-/);
    assert.ok(p.frame.x < p.bounds.x && p.frame.y < p.bounds.y);
    assert.ok(p.frame.x + p.frame.width > p.bounds.x + p.bounds.width);
    assert.ok(p.frame.y + p.frame.height > p.bounds.y + p.bounds.height);
    assert.ok(Math.abs(p.unit / (p.frame.width / width) - 1) < .01);
    const rendered = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="320" viewBox="${p.viewBox}">${p.svg.replace(/<image[^>]+\/>/g, '')}</svg>`).render();
    assert.ok(rendered.asPng().length > 2000);
  }
  assert.deepEqual(r, before);
});

test('overview respects hidden layers and excludes their labels', () => {
  const r = room();
  r.editor = { order: [], hidden: [`board:${r.boardGroups![0].id}`, `table:${r.tables[0].id}`], locked: [], groups: [] };
  const p = roomPreview(r, []);
  assert.doesNotMatch(p.svg, /data-preview-layout-kind="(board|table)"/);
  assert.doesNotMatch(p.svg, /展示ボード|受付/);
});
