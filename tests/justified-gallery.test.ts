import { test } from "node:test";
import assert from "node:assert/strict";
import { justifiedRows } from "../src/utils/justifiedGallery.ts";

function check(ratios: number[], width: number, gap: number) {
  const rows = justifiedRows(ratios, width, gap);
  let count = 0;
  for (const row of rows) {
    assert.equal(row.start, count, "photo order is preserved");
    assert.ok(row.height > 0 && Number.isFinite(row.height));
    const extent = row.widths.reduce((a, b) => a + b, 0) + (row.widths.length - 1) * gap;
    assert.ok(extent <= width + 0.001, "row stays inside fractional container width");
    if (rows.length > 1) assert.ok(Math.abs(extent - width) < 0.001, "full rows reach the right edge");
    for (const photoWidth of row.widths) {
      assert.ok(Math.abs(photoWidth / row.height - ratios[count++]) < 0.00001, "no cropping or stretching");
    }
  }
  assert.equal(count, ratios.length);
  return rows;
}

test("mixed landscape, portrait, square and panoramic photos justify at narrow and wide sizes", () => {
  for (const width of [226.666, 285, 600, 1160, 1560]) {
    for (const count of [1, 2, 3, 5, 22, 35, 99, 100]) {
      check(Array.from({ length: count }, (_, i) => [1.5, 2 / 3, 1, 3, 0.5][i % 5]), width, width < 640 ? 6 : 12);
    }
  }
});

test("final portraits share a row without making the last row disproportionately small", () => {
  const ratios = [...Array(33).fill(4 / 3), 1045 / 1565, 854 / 1280];
  for (const width of [226.666, 285, 600, 1160, 1560]) {
    const rows = check(ratios, width, width < 640 ? 6 : 12);
    assert.ok(rows.at(-1)!.widths.length >= 2);
    const heights = rows.map(row => row.height);
    assert.ok(Math.max(...heights) / Math.min(...heights) < 1.8);
  }
});

test("small portfolios remain modest in size and invalid input remains finite", () => {
  assert.equal(justifiedRows([2 / 3], 1160, 12)[0].height, 278.4);
  assert.deepEqual(justifiedRows([], 300, 6), []);
  assert.deepEqual(justifiedRows([1.5], 0, 6), []);
  for (const row of justifiedRows([NaN, 0, -1, Infinity], 300, 6)) {
    assert.ok(row.widths.every(width => width > 0 && Number.isFinite(width)));
  }
});

test("mobile fills one row per photo for every orientation, including page boundaries", () => {
  for (const width of [219.09375, 285, 600]) {
    for (const count of [1, 2, 3, 35, 100]) {
      const ratios = Array.from({ length: count }, (_, i) => [1.5, 2 / 3, 1, 3, 0.5][i % 5]);
      const rows = justifiedRows(ratios, width, 6, true);
      assert.equal(rows.length, count);
      rows.forEach((row, index) => {
        assert.equal(row.start, index);
        assert.equal(row.widths.length, 1);
        assert.ok(Math.abs(row.widths[0] - width) < 0.00001, "each photo fills the entire row");
        assert.ok(Math.abs(row.widths[0] / row.height - ratios[index]) < 0.00001, "no crop or stretch");
      });
    }
  }
});
