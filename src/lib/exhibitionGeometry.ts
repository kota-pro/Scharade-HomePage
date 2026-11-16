import { wallSurface, wallSurfaceContains, wallViewSource, sameWallSurface } from "./exhibitionWallSurfaces.ts";
import type { PhotoLayout, RoomLayout, Work } from "./exhibitionTypes.ts";
import { roomWallLength } from './exhibitionRoomPath.ts';
export type Point = { x: number; y: number };
export const mmToPt = (mm: number) => mm * 72 / 25.4;
export function rotatedCorners(width: number, height: number, rotation: number): Point[] {
  const a = rotation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
}
export function layoutBounds(photos: PhotoLayout[]) {
  if (!photos.length) return { x: 0, y: 0, width: 0, height: 0, orientation: "正方形" };
  const points = photos.flatMap(p => rotatedCorners(p.width, p.height, p.rotation).map(c => ({ x: c.x + p.x, y: c.y + p.y })));
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  const width = Math.max(...points.map(p => p.x)) - x, height = Math.max(...points.map(p => p.y)) - y;
  return { x, y, width, height, orientation: Math.abs(width - height) < .01 ? "正方形" : width > height ? "横" : "縦" };
}
export function layoutDescription(photos: PhotoLayout[]) {
  const b = layoutBounds(photos);
  return `${b.width.toFixed(1)} × ${b.height.toFixed(1)} mm / ${b.orientation} / ${photos.length}枚`;
}
export const wallLength = roomWallLength;
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function validPolygon(vertices: Point[]) {
  if (vertices.length < 3 || vertices.length > 32) return false;
  const area = vertices.reduce((s, a, i) => { const b = vertices[(i + 1) % vertices.length]; return s + a.x * b.y - b.x * a.y; }, 0);
  if (Math.abs(area) < 1) return false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return false;
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      const c = vertices[j], d = vertices[(j + 1) % vertices.length];
      // Reject touching/collinear non-adjacent edges too.
      if (cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0 &&
          Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
          Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))) return false;
    }
  }
  return true;
}
export function polygonsOverlap(a: Point[], b: Point[]) {
  for (const poly of [a, b]) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], nx = -(q.y - p.y), ny = q.x - p.x;
    const aa = a.map(v => v.x * nx + v.y * ny), bb = b.map(v => v.x * nx + v.y * ny);
    if (Math.max(...aa) <= Math.min(...bb) + .01 || Math.max(...bb) <= Math.min(...aa) + .01) return false;
  }
  return true;
}
export function placedPhotos(work: Work, placement: { x: number; bottom: number; rotation: number }, height: number) {
  const b = layoutBounds(work.photos), a = placement.rotation * Math.PI / 180;
  const rotated = work.photos.map(photo => {
    const x = photo.x - b.x, y = photo.y - b.y;
    return { ...photo, x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a), rotation: photo.rotation + placement.rotation };
  });
  const box = layoutBounds(rotated);
  return rotated.map(p => ({ ...p, x: placement.x + p.x - box.x, y: height - placement.bottom - box.height + p.y - box.y }));
}
export function roomProblems(room: RoomLayout, works: Work[]): string[] {
  const problems: string[] = [], seen = new Set<string>();
  const shapes: { name: string; wall: number; polygon: Point[] }[] = [];
  for (const placement of room.placements) {
    const work = works.find(w => w.id === placement.workId);
    if (!work) { problems.push("配置済みの作品が提出から削除されています。"); continue; }
    if (seen.has(work.id)) problems.push(`${work.title} が重複して配置されています。`);
    seen.add(work.id);
    const surface = wallSurface(room,placement.wall);
    if(!surface){problems.push("配置先の壁が見つかりません。");continue;}
    const height=surface.height, source=wallViewSource(room,`wall:${placement.wall}`,placement);
    for (const photo of placedPhotos(work, source, height)) {
      const polygon = rotatedCorners(photo.width, photo.height, photo.rotation).map(c => ({ x: photo.x + c.x, y: photo.y + c.y }));
      if (!wallSurfaceContains(surface,polygon)) problems.push(`${work.title} が壁${placement.wall + 1}からはみ出しています。`);
      shapes.push({ name: work.title, wall: surface.wall, polygon });
    }
  }
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    for (const other of shapes.slice(i + 1)) if (shape.wall === other.wall && polygonsOverlap(shape.polygon, other.polygon)) problems.push(`${shape.name} と ${other.name} が重なっています。`);
    for (const opening of room.openings.filter(o => sameWallSurface(room,`wall:${o.wall}`,`wall:${shape.wall}`)).map(o=>wallViewSource(room,`wall:${o.wall}`,o,["offset"]))) {
      const top = wallSurface(room,opening.wall)!.height - opening.bottom - opening.height;
      const rect = [{ x: opening.offset, y: top }, { x: opening.offset + opening.width, y: top }, { x: opening.offset + opening.width, y: top + opening.height }, { x: opening.offset, y: top + opening.height }];
      if (polygonsOverlap(shape.polygon, rect)) problems.push(`${shape.name} が${opening.kind === "door" ? "扉" : "窓"}と重なっています。`);
    }
  }
  for (const book of room.books) {
    const table = room.tables.find(t => t.id === book.tableId), work = works.find(w => w.id === book.workId && w.kind === "book");
    if (!table || !work) { problems.push("ブックの作品または机が見つかりません。"); continue; }
    const points = rotatedCorners(book.width, book.depth, book.rotation).map(p => ({ x: p.x + book.x, y: p.y + book.y }));
    if (points.some(p => p.x < 0 || p.y < 0 || p.x > table.width || p.y > table.depth)) problems.push(`${work.title} が机からはみ出しています。`);
    for (const other of room.books.filter(b => b !== book && b.tableId === book.tableId)) {
      const q = rotatedCorners(other.width, other.depth, other.rotation).map(p => ({ x: p.x + other.x, y: p.y + other.y }));
      if (polygonsOverlap(points, q)) problems.push(`${work.title} が他のブックと重なっています。`);
    }
  }
  return [...new Set(problems)];
}
