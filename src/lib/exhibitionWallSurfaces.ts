import { roomWalls, type RoomWall } from './exhibitionRoomPath.ts';
import type { RoomLayout, VectorPoint } from './exhibitionTypes.ts';

export type WallSurfacePart = { wall: RoomWall; left: number; right: number; top: number };
export type WallSurface = { key: string; label: string; wall: number; width: number; height: number; walls: WallSurfacePart[] };
const tolerance = .01;
// Match the direction field's 0.1-degree precision, with a canonical periodic
// value so -180 and 180 (and -0 and 0) represent the same displayed direction.
function direction(w: RoomWall) {
  const s = w.segment, ticks = Math.round((Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180 / Math.PI) * 10);
  return ((ticks % 3600) + 3600) % 3600;
}
const cache = new WeakMap<RoomLayout, { walls: RoomWall[]; surfaces: WallSurface[] }>();

function straight(w: RoomWall) {
  const s = w.segment, dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, length = Math.hypot(dx, dy);
  if (s.arc || length < 1 || Math.abs(length - w.length) > tolerance) return false;
  return [s.c1, s.c2].filter(Boolean).every(p => {
    const x = p!.x - s.a.x, y = p!.y - s.a.y, along = (x * dx + y * dy) / length;
    return Math.abs(x * dy - y * dx) / length <= tolerance && along >= 0 && along <= length;
  });
}
function consecutive(a: RoomWall, b: RoomWall) {
  if (!straight(a) || !straight(b) || Math.hypot(a.segment.b.x - b.segment.a.x, a.segment.b.y - b.segment.a.y) > tolerance) return false;
  return direction(a) === direction(b);
}
function connectRuns(a: RoomWall[], b: RoomWall[]) {
  if (!consecutive(a.at(-1)!, b[0])) return false;
  // Compare the whole run to one direction; pairwise tolerances must not chain
  // together progressively different directions into a larger bend.
  return [...a, ...b].every(w => direction(w) === direction(a[0]));
}

/** Read-only elevation groups. Physical vertices, IDs, names and heights remain separate. */
export function wallSurfaces(room: RoomLayout): WallSurface[] {
  const walls = roomWalls(room), previous = cache.get(room), runs: RoomWall[][] = [];
  if (previous?.walls === walls) return previous.surfaces;
  for (const wall of walls) {
    if (runs.length && connectRuns(runs.at(-1)!, [wall])) runs.at(-1)!.push(wall);
    else runs.push([wall]);
  }
  // The outline's first vertex can itself be a subdivision on a straight wall.
  if (runs.length > 1 && connectRuns(runs.at(-1)!, runs[0])) runs[0] = [...runs.pop()!, ...runs[0]];
  const surfaces = runs.map(run => {
    const height = Math.max(...run.map(w => w.height)); let x = 0;
    const parts = run.map(wall => { const left = x; x += wall.length; return { wall, left, right: x, top: height - wall.height }; });
    return { key: `wall:${run[0].index}`, wall: run[0].index, label: run.map(w => w.label).join('・'), width: x, height, walls: parts };
  });
  cache.set(room, { walls, surfaces });
  return surfaces;
}
export function wallSurface(room: RoomLayout, key: string | number) {
  const index = typeof key === 'number' ? key : /^wall:\d+$/.test(key) ? Number(key.slice(5)) : -1;
  return wallSurfaces(room).find(s => s.walls.some(p => p.wall.index === index));
}
export const wallSurfaceKey = (room: RoomLayout, key: string) => wallSurface(room, key)?.key ?? key;
export const sameWallSurface = (room: RoomLayout, a: string, b: string) => wallSurfaceKey(room, a) === wallSurfaceKey(room, b);
export function wallSurfacePart(room: RoomLayout, key: string | number) {
  const index = typeof key === 'number' ? key : Number(key.slice(5));
  return wallSurface(room, key)?.walls.find(p => p.wall.index === index);
}

/** Transient editor/render lens: writes go to the original wall-local record. Never persist this proxy. */
export function wallViewSource<T extends object>(room: RoomLayout, key: string, source: T, fields: ('x' | 'y' | 'offset')[] = ['x']): T {
  const part = wallSurfacePart(room, key);
  if (!part || !part.left && (!fields.includes('y') || !part.top)) return source;
  return new Proxy(source, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return fields.includes(property as any) && typeof value === 'number' ? value + (property === 'y' ? part.top : part.left) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, fields.includes(property as any) && typeof value === 'number' ? value - (property === 'y' ? part.top : part.left) : value);
    },
  });
}
export function storeWallViewAnnotation<T extends { surface?: string; x: number; y: number }>(room: RoomLayout, value: T): T {
  const part = wallSurfacePart(room, value.surface ?? 'floor');
  return part ? { ...value, x: value.x - part.left, y: value.y - part.top } : value;
}

/** All of a polygon must fit below each wall's own top, including at an internal seam. */
export function wallSurfaceContains(surface: WallSurface, polygon: VectorPoint[]) {
  if (!polygon.length || polygon.some(p => p.x < -tolerance || p.x > surface.width + tolerance || p.y > surface.height + tolerance)) return false;
  const min = Math.min(...polygon.map(p => p.x)), max = Math.max(...polygon.map(p => p.x));
  return surface.walls.filter(p => p.right > min + tolerance && p.left < max - tolerance).every(part => {
    const points = polygon.filter(p => p.x >= part.left - tolerance && p.x <= part.right + tolerance);
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      for (const x of [part.left, part.right]) if (Math.abs(a.x - b.x) > 1e-9) {
        const t = (x - a.x) / (b.x - a.x);
        if (t >= 0 && t <= 1) points.push({ x, y: a.y + t * (b.y - a.y) });
      }
    });
    return points.every(p => p.y >= part.top - tolerance);
  });
}
export function wallSurfaceAt(room: RoomLayout, key: string, x: number) {
  const surface = wallSurface(room, key);
  return surface?.walls.find(p => x < p.right - tolerance) ?? surface?.walls.at(-1);
}

/** Openings/equipment require nonnegative local offsets; rebase them when dragged across a seam. */
export function rebaseWallAttachments(room: RoomLayout) {
  for (const item of room.openings) {
    const key = `wall:${item.wall}`, part = wallSurfacePart(room, key);
    if (!part) continue;
    const x = part.left + item.offset, next = wallSurfaceAt(room, key, x)!;
    if (x >= 0 && next.wall.index !== item.wall) {
      item.wall = next.wall.index; item.wallId = next.wall.id; item.offset = x - next.left;
    }
  }
  for (const item of [...room.tables, ...room.boardGroups ?? []]) {
    const a = item.attachment, wall = a && roomWalls(room).find(w => w.id === a.wallId);
    if (!a || !wall) continue;
    const part = wallSurfacePart(room, wall.index)!, x = part.left + a.offset, next = wallSurfaceAt(room, `wall:${wall.index}`, x)!;
    if (x >= 0 && next.wall.id !== a.wallId) { a.wallId = next.wall.id; a.offset = x - next.left; }
  }
}
