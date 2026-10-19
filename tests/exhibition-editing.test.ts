import test from "node:test";
import assert from "node:assert/strict";
import { arrangePhotos, photoGaps, setPhotoGap, paperSizes, paperSizeId, snapMm, insertRoomVertex, removeRoomVertex, setRoomWall, wallLength } from "../src/lib/exhibitionEditing.ts";
import { layoutBounds } from "../src/lib/exhibitionGeometry.ts";
import type { PhotoLayout, RoomLayout } from "../src/lib/exhibitionTypes.ts";
const photo = (x: number, y = 0, rotation = 0): PhotoLayout => ({ assetId: "", x, y, width: 210, height: 297, rotation });
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < .11, `${a} should equal ${b}`);
test("paper presets and grid snapping retain mm dimensions and orientation", () => {
  assert.equal(paperSizeId(photo(0)), "A4");
  assert.equal(paperSizeId({ ...photo(0), width: 297, height: 210 }), "A4");
  assert.ok(paperSizes.some(p => p.id === "B4" && p.width === 257 && p.height === 364));
  assert.equal(snapMm(12.7, 5), 15); assert.equal(snapMm(-12.7, 5), -15);
});
test("rotated pair gaps and horizontal/vertical arrangements use the same bounding edges", () => {
  const a = photo(-150, -60, 37), b = photo(600, 200, -18);
  const moved = setPhotoGap(a, b, "x", 12.5);
  close(photoGaps(a, moved).x, 12.5); assert.equal(moved.y, b.y);
  const above = setPhotoGap(a, photo(-150, -600, 90), "y", 6.5);
  close(photoGaps(a, above).y, 6.5);
  for (const mode of ["horizontal", "vertical"] as const) {
    const arranged = arrangePhotos([a, b, photo(900, 900, 90)], [2, 0, 1], mode, 2, 15, 22);
    for (let i = 1; i < arranged.length; i++) close(photoGaps(arranged[i - 1], arranged[i])[mode === "horizontal" ? "x" : "y"], mode === "horizontal" ? 15 : 22);
  }
  const grid = arrangePhotos([a, b, photo(900,900,90)], [0,1,2], "grid", 2, 10, 20);
  const ga = layoutBounds([grid[0]]), gb = layoutBounds([grid[1]]), gc = layoutBounds([grid[2]]);
  assert.ok(gb.x >= ga.x + ga.width + 9.9); close(gc.y - ga.y - Math.max(ga.height, gb.height), 20);
  assert.throws(() => arrangePhotos([a], [0], "grid", NaN, 10, 10), /列数/);
});
test("anchor insertion/deletion remaps unaffected walls and refuses to orphan placed items", () => {
  const room: RoomLayout = { id: crypto.randomUUID(), name: "室", vertices: [{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}], wallHeights: [3000,3100,3200,3300], openings: [{id:crypto.randomUUID(), wall:2,kind:"door",offset:100,width:900,bottom:0,height:2100}], placements: [], tables: [], books: [] };
  const inserted = insertRoomVertex(room, 0);
  assert.equal(inserted.vertices.length, 5); assert.equal(inserted.openings[0].wall, 3);
  assert.deepEqual(inserted.wallHeights, [3000,3000,3100,3200,3300]);
  const removed = removeRoomVertex(inserted, 1);
  assert.deepEqual(removed.vertices.map(({x,y})=>({x,y})), room.vertices); assert.equal(removed.openings[0].wall, 2);
  assert.throws(() => insertRoomVertex(room, 2), /配置|開口/);
  assert.throws(() => removeRoomVertex(room, 2), /配置|開口/);
  const edited = setRoomWall(room, 0, 5000, 0);
  assert.equal(edited.vertices[1].x, 5000); close(wallLength(edited, 0), 5000);
  assert.deepEqual(edited.openings.map(({wallId,...o})=>o), room.openings);
});
