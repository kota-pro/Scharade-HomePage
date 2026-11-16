import { wallSurface, wallSurfaceAt, storeWallViewAnnotation, wallViewSource } from "../lib/exhibitionWallSurfaces.ts";
import { paperSizes } from "../lib/exhibitionEditing.ts";
import {
  roomWalls,
  roomWallOffset,
  roomWallPoint,
} from "../lib/exhibitionRoomPath.ts";
import { attachEquipment } from "../lib/exhibitionWallEquipment.ts";
import { openingFloorSvg } from "../lib/exhibitionRoomSymbols.ts";
import type { RoomLayout, LayoutImageAsset, Opening } from "../lib/exhibitionTypes.ts";
type Image = Pick<
  LayoutImageAsset,
  "id" | "name" | "width" | "height" | "bytes"
>;
type Bridge = {
  room: () => RoomLayout;
  view: () => string;
  tool: () => string;
  host: () => HTMLElement;
  unit: () => number;
  point: (e: { clientX: number; clientY: number }) => { x: number; y: number };
  snap: (p: { x: number; y: number }, alt: boolean) => { x: number; y: number };
  mutate: (action: () => void) => boolean;
  select: (ids: string[]) => void;
  refresh: () => void;
  paint: () => void;
  message: (text: string, error?: boolean) => void;
  images: () => Image[];
  upload: (file: File, id: string) => Promise<Image>;
  imageUrl: (id: string) => string;
  gesture?: (cancel: (() => void) | undefined) => void;
  idle?: () => void;
};
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const icon = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${body}</svg>`;
const choices = [
  ["rect", "四角形", icon('<rect x="4" y="5" width="16" height="14"/>')],
  ["ellipse", "楕円", icon('<ellipse cx="12" cy="12" rx="9" ry="6"/>')],
  [
    "power",
    "電源",
    icon(
      '<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 7v5m6-5v5m-3 4v1"/>',
    ),
  ],
  [
    "door",
    "ドア",
    icon(
      '<path d="M4 21V3h16v18M7 20V5l10 2v13Z"/><circle cx="14" cy="14" r=".8"/>',
    ),
  ],
  [
    "window",
    "窓",
    icon(
      '<rect x="3" y="4" width="18" height="16"/><path d="M12 4v16M3 12h18"/>',
    ),
  ],
  ["table", "展示台", icon('<path d="M2 8h20v4H2Zm3 4v9m14-9v9"/>')],
  [
    "board",
    "展示ボード",
    icon('<path d="M3 3h8v17H3Zm8 0 10 2v17l-10-2m-4 0v3m10-2v3"/>'),
  ],
] as const;
const defaults: Record<
  string,
  { width: number; height: number; depth: number }
> = {
  rect: { width: 0, height: 0, depth: 0 },
  ellipse: { width: 0, height: 0, depth: 0 },
  power: { width: 240, height: 240, depth: 0 },
  door: { width: 900, height: 2100, depth: 0 },
  window: { width: 900, height: 1200, depth: 0 },
  table: { width: 1200, height: 700, depth: 600 },
  board: { width: 900, height: 1800, depth: 30 },
};
export function createLayoutAddTools(b: Bridge) {
  let shape = "rect",
    values = { ...defaults.rect },
    image: Image | undefined,
    file: File | undefined,
    uploadId = "",
    uploading = false,
    uploadError = false,
    paper = "A4",
    orientation = "portrait",
    width = 210,
    height = 297,
    hover: { x: number; y: number } | undefined;
  let shapeDrag:
    | {
        kind: "rect" | "ellipse";
        start: { x: number; y: number };
        end: { x: number; y: number };
        moved: boolean;
      }
    | undefined;
  const dragBox = () => {
    const d = shapeDrag!;
    return {
      x: Math.min(d.start.x, d.end.x),
      y: Math.min(d.start.y, d.end.y),
      width: Math.abs(d.end.x - d.start.x),
      height: Math.abs(d.end.y - d.start.y),
    };
  };
  const sizes = () => {
    const size = paperSizes.find((p) => p.id === paper);
    if (size) {
      width = orientation === "portrait" ? size.width : size.height;
      height = orientation === "portrait" ? size.height : size.width;
    }
  };
  const fileSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  function openingAt(p: { x: number; y: number }): Opening {
    const room = b.room(), view = b.view();
    const run=wallSurface(room,view),part=wallSurfaceAt(room,view,p.x);
    let wall = part?.wall, offset = p.x-(part?.left??0);
    if (view === "floor") {
      const nearest = roomWalls(room).map(w => {
        const offset = roomWallOffset(room, w.index, p), point = roomWallPoint(room, w.index, offset);
        return { wall: w, offset, distance: Math.hypot(point.x - p.x, point.y - p.y) };
      }).sort((a, z) => a.distance - z.distance)[0];
      if (!nearest || nearest.distance > 20 * b.unit()) throw new Error("ドア・窓は壁をクリックして配置してください。");
      wall = nearest.wall; offset = nearest.offset;
    }
    if (!wall) throw new Error("壁を選択してください。");
    if (values.width > (run?.width??wall.length) || values.height > (run?.height??wall.height)) throw new Error("ドア・窓の寸法を壁の内側に設定してください。");
    return {
      id: "preview", kind: shape as "door" | "window", wall: wall.index, wallId: wall.id,
      offset: run?Math.max(0,Math.min(p.x,run.width-values.width))-(part?.left??0):Math.max(0, Math.min(offset, wall.length - values.width)),
      width: values.width, height: values.height,
      bottom: shape === "door" ? 0 : view === "floor" ? Math.min(1000, wall.height - values.height) : Math.max(0, (run?.height??wall.height) - p.y - values.height),
      color: "#0db49b",
    };
  }
  function inspector() {
    if (b.tool() === "shapes")
      return `<section class="layout-add-tool"><h4>図形・設備を追加</h4><div class="layout-shape-palette">${choices.map(([key, label, svg]) => `<button type="button" data-layout-shape="${key}" aria-label="${label}を追加" title="${label}" aria-pressed="${shape === key}" ${b.view().startsWith("board:") && ["table", "board"].includes(key) ? "disabled" : ""}>${svg}<span class="visually-hidden">${label}</span></button>`).join("")}</div><p>${esc(choices.find((c) => c[0] === shape)?.[1])}：${["rect", "ellipse"].includes(shape) ? "ドラッグして大きさを決めます。幅・高さの両方を入力した場合は、クリックでも配置できます。" : "キャンバスの配置する位置をクリックしてください。"}</p><div class="exhibition-grid">${[["width", "幅 mm"], ["height", ["door", "window"].includes(shape) ? "実際の高さ mm" : "高さ mm"], ...(["table", "board"].includes(shape) ? [["depth", shape === "table" ? "奥行 mm" : "厚み mm"]] : [])].map(([key, label]) => `<label>${label}<input type="number" data-layout-shape-size="${key}" min="1" max="100000" step=".1" placeholder="未指定" value="${values[key as keyof typeof values] || ""}"/></label>`).join("")}</div><p class="exhibition-muted">ドア・窓は壁に配置します。壁面の展示台・ボードは平面図にも連動します。</p></section>`;
    if (b.tool() !== "image") return "";
    return `<section class="layout-add-tool"><h4>レイアウト用画像を追加</h4><label>画像を選択<input type="file" data-layout-image-file accept=".jpg,.jpeg,.png,image/jpeg,image/png" ${uploading ? "disabled" : ""}/></label><p data-layout-image-selection>${file ? `${esc(file.name)} · ${fileSize(file.size)}` : image ? `${esc(image.name)} · ${fileSize(image.bytes)}` : "画像は未選択です。"}</p>${uploading ? "<p>画像を保存しています…</p>" : ""}${uploadError ? '<button type="button" data-layout-image-retry>同じ画像の保存を再試行</button>' : ""}<label>保存済み画像<select data-layout-image-existing><option value="">画像を選択</option>${b
      .images()
      .map(
        (a) =>
          `<option value="${a.id}" ${image?.id === a.id ? "selected" : ""}>${esc(a.name)}</option>`,
      )
      .join(
        "",
      )}</select></label>${image ? `<img class="layout-image-preview" src="${esc(b.imageUrl(image.id))}" alt="配置する画像のプレビュー"/>` : ""}<div class="exhibition-grid"><label>サイズ<select data-layout-image-paper><option value="custom" ${paper === "custom" ? "selected" : ""}>自由入力</option>${paperSizes.map((p) => `<option value="${p.id}" ${paper === p.id ? "selected" : ""}>${esc("label" in p ? p.label : p.id)} (${p.width}×${p.height}mm)</option>`).join("")}</select></label><label>向き<select data-layout-image-orientation><option value="portrait" ${orientation === "portrait" ? "selected" : ""}>縦</option><option value="landscape" ${orientation === "landscape" ? "selected" : ""}>横</option></select></label><label>幅 mm<input type="number" min="1" max="100000" step=".1" data-layout-image-width value="${width}"/></label><label>高さ mm<input type="number" min="1" max="100000" step=".1" data-layout-image-height value="${height}"/></label></div><p>画像の縦横比を保って枠内に表示します。画像を選んだ後、キャンバスをクリックして配置してください。</p><p class="exhibition-muted">作品数・タイトルボード生成・保存済み展示室には含めません。</p></section>`;
  }
  async function upload() {
    if (!file || uploading) return;
    uploading = true;
    uploadError = false;
    b.refresh();
    try {
      image = await b.upload(file, uploadId);
      b.message(
        "レイアウト用画像を保存しました。配置する場所をクリックしてください。",
      );
    } catch (error) {
      uploadError = true;
      b.message(
        error instanceof Error
          ? error.message
          : "画像を保存できません。同じ画像を再試行してください。",
        true,
      );
    } finally {
      uploading = false;
      b.refresh();
      b.idle?.();
    }
  }
  function bind(panel: HTMLElement) {
    panel
      .querySelectorAll<HTMLButtonElement>("[data-layout-shape]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          shape = button.dataset.layoutShape!;
          values = { ...defaults[shape] };
          b.refresh();
        }),
      );
    panel
      .querySelectorAll<HTMLInputElement>("[data-layout-shape-size]")
      .forEach((input) =>
        input.addEventListener("change", () => {
          const n = input.value === "" && ["rect", "ellipse"].includes(shape) ? 0 : Number(input.value);
          if (n === 0 && ["rect", "ellipse"].includes(shape)) {
            values[input.dataset.layoutShapeSize as keyof typeof values] = 0;
            b.paint();
            return;
          }
          if (!Number.isFinite(n) || n < 1 || n > 100000) {
            b.message("寸法は1〜100000mmで入力してください。", true);
            return;
          }
          values[input.dataset.layoutShapeSize as keyof typeof values] = n;
          b.paint();
        }),
      );
    const fileInput = panel.querySelector<HTMLInputElement>(
      "[data-layout-image-file]",
    );
    if (file && fileInput && typeof DataTransfer === "function") {
      try {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        fileInput.files = transfer.files;
      } catch {}
    }
    panel
      .querySelector<HTMLInputElement>("[data-layout-image-file]")
      ?.addEventListener("change", (event) => {
        const selected = (event.target as HTMLInputElement).files?.[0];
        if (!selected) return;
        if (selected.size > 20 * 1024 * 1024 || !selected.size) {
          b.message("空でない20MB以下のJPEG・PNGを選んでください。", true);
          return;
        }
        file = selected;
        uploadId = crypto.randomUUID();
        image = undefined;
        void upload();
      });
    panel
      .querySelector("[data-layout-image-retry]")
      ?.addEventListener("click", () => void upload());
    panel
      .querySelector<HTMLSelectElement>("[data-layout-image-existing]")
      ?.addEventListener("change", (event) => {
        image = b
          .images()
          .find((a) => a.id === (event.target as HTMLSelectElement).value);
        file = undefined;
        uploadError = false;
        b.refresh();
      });
    panel
      .querySelector<HTMLSelectElement>("[data-layout-image-paper]")
      ?.addEventListener("change", (event) => {
        paper = (event.target as HTMLSelectElement).value;
        sizes();
        b.refresh();
      });
    panel
      .querySelector<HTMLSelectElement>("[data-layout-image-orientation]")
      ?.addEventListener("change", (event) => {
        const next = (event.target as HTMLSelectElement).value;
        if (paper === "custom" && next !== orientation)
          [width, height] = [height, width];
        orientation = next;
        sizes();
        b.refresh();
      });
    panel
      .querySelectorAll<HTMLInputElement>(
        "[data-layout-image-width],[data-layout-image-height]",
      )
      .forEach((input) =>
        input.addEventListener("change", () => {
          const n = Number(input.value);
          if (!Number.isFinite(n) || n < 1 || n > 100000) {
            b.message("寸法は1〜100000mmで入力してください。", true);
            return;
          }
          paper = "custom";
          if (input.hasAttribute("data-layout-image-width")) width = n;
          else height = n;
          b.paint();
        }),
      );
  }
  function startShapeDrag(event: PointerEvent) {
    const canvas = b
        .host()
        .querySelector<SVGSVGElement>("[data-layout-canvas]")!,
      matrix = canvas.getScreenCTM()!.inverse(),
      roomId = b.room().id,
      view = b.view(),
      kind = shape as "rect" | "ellipse";
    const start = b.snap(b.point(event), event.altKey),
      startScreen = { x: event.clientX, y: event.clientY };
    shapeDrag = { kind, start, end: start, moved: false };
    let ended = false;
    const update = (e: PointerEvent) => {
      const d = shapeDrag;
      if (!d) return;
      const q = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
      d.end = b.snap({ x: q.x, y: q.y }, e.altKey);
      if (Math.hypot(e.clientX - startScreen.x, e.clientY - startScreen.y) >= 3)
        d.moved = true;
    };
    const block = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      e.preventDefault();
      update(e);
      b.paint();
    };
    const finish = (cancelled: boolean) => {
      if (ended) return;
      ended = true;
      const d = shapeDrag,
        box = d?.moved
          ? dragBox()
          : {
              x: start.x,
              y: start.y,
              width: values.width,
              height: values.height,
            };
      shapeDrag = undefined;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelPointer, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("pagehide", cancel);
      window.removeEventListener("wheel", block, true);
      canvas.removeEventListener("lostpointercapture", cancelPointer);
      delete canvas.dataset.dragging;
      delete canvas.dataset.dragMode;
      delete canvas.dataset.pointerId;
      b.gesture?.(undefined);
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
      if (
        cancelled ||
        !d ||
        b.room().id !== roomId ||
        b.view() !== view ||
        b.tool() !== "shapes" ||
        shape !== kind
      ) {
        b.paint();
        return;
      }
      if (!d.moved && (!box.width || !box.height)) {
        b.paint();
        return;
      }
      if (
        !Object.values(box).every(Number.isFinite) ||
        Math.abs(box.x) > 100000 ||
        Math.abs(box.y) > 100000 ||
        box.width < 1 ||
        box.height < 1 ||
        box.width > 100000 ||
        box.height > 100000
      ) {
        b.message(
          "幅・高さは1〜100000mm、配置座標は±100000mm以内にしてください。",
          true,
        );
        b.paint();
        return;
      }
      const previous = { ...values };
      // A drag does not turn the last size into an implicit next-placement size.
      if (d.moved) values = { ...values, width: 0, height: 0 };
      if (
        !b.mutate(() => {
          const id = crypto.randomUUID();
          (b.room().annotations ??= []).push(storeWallViewAnnotation(b.room(),{
            id,
            kind,
            surface: view,
            ...(view.startsWith("wall:")
              ? {
                  surfaceWallId: roomWalls(b.room())[Number(view.slice(5))]?.id,
                }
              : {}),
            ...box,
            rotation: 0,
            text: "",
            fontSize: 32,
            color: "#343434",
          }));
          b.select([`annotation:${id}`]);
        })
      ) {
        values = previous;
        b.refresh();
      }
    };
    const up = (e: PointerEvent) => {
        if (e.pointerId === event.pointerId) {
          update(e);
          finish(false);
        }
      },
      cancelPointer = (e: PointerEvent) => {
        if (e.pointerId === event.pointerId) finish(true);
      },
      cancel = () => finish(true);
    canvas.setPointerCapture(event.pointerId);
    canvas.dataset.dragging = "true";
    canvas.dataset.dragMode = "shape";
    canvas.dataset.pointerId = String(event.pointerId);
    b.gesture?.(cancel);
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelPointer, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("pagehide", cancel);
    window.addEventListener("wheel", block, { capture: true, passive: false });
    canvas.addEventListener("lostpointercapture", cancelPointer);
    b.paint();
  }
  function pointerDown(event: PointerEvent) {
    const tool = b.tool();
    if (!["shapes", "image"].includes(tool) || event.button !== 0) return false;
    if (tool === "shapes" && ["rect", "ellipse"].includes(shape)) {
      startShapeDrag(event);
      return true;
    }
    if (tool === "image" && (!image || uploading)) {
      b.message("画像を選択し、保存が完了してから配置してください。", true);
      return true;
    }
    const p = b.snap(b.point(event), event.altKey);
    if (
      Math.abs(p.x) > 100000 ||
      Math.abs(p.y) > 100000 ||
      (b.tool() === "shapes" && shape === "board" && values.depth > 1000)
    ) {
      b.message(
        "配置座標は±100000mm、ボードの厚みは1000mm以内に設定してください。",
        true,
      );
      return true;
    }
    b.mutate(() => {
      const room = b.room(),
        view = b.view(),
        id = crypto.randomUUID();
      if (tool === "image") {
        (room.annotations ??= []).push(storeWallViewAnnotation(room,{
          id,
          kind: "image",
          assetId: image!.id,
          surface: view,
          x: p.x,
          y: p.y,
          width,
          height,
          rotation: 0,
          text: "",
          fontSize: 16,
        }));
        b.select([`annotation:${id}`]);
        return;
      }
      if (["door", "window"].includes(shape) && !view.startsWith("board:")) {
        room.openings.push({ ...openingAt(p), id, color: "#777777" });
        b.select([`opening:${id}`]);
        return;
      }
      if (shape === "table" || shape === "board") {
        if (view.startsWith("board:"))
          throw new Error(
            "展示台・ボードは平面図または壁面で追加してください。",
          );
        const table =
            shape === "table"
              ? {
                  id,
                  name: "展示台",
                  x: p.x,
                  y: p.y,
                  width: values.width,
                  depth: values.depth,
                  height: values.height,
                  rotation: 0,
                }
              : undefined,
          group =
            shape === "board"
              ? {
                  id,
                  name: "展示ボード",
                  x: p.x,
                  y: p.y,
                  rotation: 0,
                  panels: [
                    {
                      id: crypto.randomUUID(),
                      name: "ボード1",
                      width: values.width,
                      height: values.height,
                      thickness: values.depth,
                      hingeAngle: 0,
                      color: "#e6ded0",
                    },
                  ],
                }
              : undefined;
        if (table) room.tables.push(table);
        else (room.boardGroups ??= []).push(group!);
        if (view !== "floor") {
          const part = wallSurfaceAt(room,view,p.x);
          if (!part) throw new Error("壁面を選択してください。");
          attachEquipment(room, table ?? group!, part.wall.id, p.x-part.left, 0);
        }
        b.select([`${table ? "table" : "board"}:${id}`]);
        return;
      }
      (room.annotations ??= []).push(storeWallViewAnnotation(room,{
        id,
        kind: shape as "rect" | "ellipse" | "power" | "door" | "window",
        surface: view,
        x: p.x,
        y: p.y,
        width: values.width,
        height: values.height,
        rotation: 0,
        text: "",
        fontSize: 32,
        color: "#343434",
      }));
      b.select([`annotation:${id}`]);
    });
    return true;
  }
  function overlay() {
    const u = b.unit();
    if (shapeDrag) {
      const d = shapeDrag;
      if (!d.moved && (!values.width || !values.height)) return "";
      const box = d.moved ? dragBox() : { ...d.start, width: values.width, height: values.height };
      return shapePreview(box, d.kind, u);
    }
    if (!hover || !["shapes", "image"].includes(b.tool())) return "";
    if (b.tool() === "shapes" && ["rect", "ellipse"].includes(shape) && (!values.width || !values.height)) return "";
    if (b.tool() === "shapes" && ["door", "window"].includes(shape) && !b.view().startsWith("board:")) {
      try {
        const o = openingAt(hover), wall = roomWalls(b.room())[o.wall];
        return `<g data-layout-opening-preview pointer-events="none" opacity=".8">${b.view() === "floor" ? openingFloorSvg(b.room(), o) : `<rect x="${wallViewSource(b.room(),`wall:${o.wall}`,o,['offset']).offset}" y="${(wallSurface(b.room(),o.wall)?.height??wall.height)-o.bottom-o.height}" width="${o.width}" height="${o.height}" fill="#0db49b" fill-opacity=".06" stroke="#0db49b" vector-effect="non-scaling-stroke"/>`}</g>`;
      } catch { return ""; }
    }
    const w = b.tool() === "image" ? width : values.width,
      h = b.tool() === "image" ? height : b.view() === "floor" && ["board", "table"].includes(shape) ? values.depth : values.height;
    const box = { ...hover, width: w, height: h };
    return `<g pointer-events="none">${shapePreview(box, shape === "ellipse" ? "ellipse" : "rect", u, b.tool() === "shapes")}${b.tool() === "image" && image ? `<image x="${hover.x}" y="${hover.y}" width="${w}" height="${h}" href="${esc(b.imageUrl(image.id))}" opacity=".5" preserveAspectRatio="xMidYMid meet"/>` : ""}</g>`;
  }
  function shapePreview(box: {x:number;y:number;width:number;height:number}, kind:string, u:number, dimensions=true) {
    return `<g data-layout-shape-preview pointer-events="none" fill="#0db49b" fill-opacity=".06" stroke="#0db49b" stroke-dasharray="${5*u} ${3*u}" vector-effect="non-scaling-stroke">${kind === "ellipse" ? `<ellipse cx="${box.x+box.width/2}" cy="${box.y+box.height/2}" rx="${box.width/2}" ry="${box.height/2}"/>` : `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/>`}${dimensions ? `<text x="${box.x}" y="${box.y-12*u}" font-size="${12*u}" fill="#28776b" fill-opacity="1" stroke="none">${box.width.toFixed(1)} × ${box.height.toFixed(1)} mm</text>` : ""}</g>`;
  }
  return {
    inspector,
    bind,
    pointerDown,
    overlay,
    pointerMove: (event: PointerEvent) => {
      if (shapeDrag) return;
      hover = b.snap(b.point(event), event.altKey);
      if (["shapes", "image"].includes(b.tool())) b.paint();
    },
    isBusy: () => uploading,
  };
}
