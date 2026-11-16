import { layoutEscape as esc } from "../lib/exhibitionLayoutScene.ts";
import type { LayoutObject } from "../lib/exhibitionLayoutModel.ts";
import type { LayoutPeerState } from "./exhibitionLayoutSync.ts";

/** Ephemeral presence lives outside the saved/exported scene. */
export function createLayoutPeerOverlay() {
  let pointer: {x: number; y: number} | undefined;
  const hidden = new Set<string>();
  function proximity(svg: SVGSVGElement) {
    for (const label of svg.querySelectorAll<SVGGElement>("[data-layout-peer-label]")) {
      const key = label.dataset.layoutPeerLabel!, rect = label.getBoundingClientRect(), margin = hidden.has(key) ? 24 : 14;
      const near = !!pointer && pointer.x >= rect.left-margin && pointer.x <= rect.right+margin && pointer.y >= rect.top-margin && pointer.y <= rect.bottom+margin;
      if (near) hidden.add(key); else hidden.delete(key);
      label.classList.toggle("near-pointer", near);
    }
  }
  function paint(svg: SVGSVGElement, peers: LayoutPeerState["peers"], clientId: string, roomId: string, view: string, objects: LayoutObject[], u: number) {
    let group = svg.querySelector<SVGGElement>("[data-layout-peers]");
    if (!group) { group = document.createElementNS("http://www.w3.org/2000/svg", "g"); group.dataset.layoutPeers = ""; group.setAttribute("pointer-events", "none"); group.setAttribute("aria-hidden", "true"); svg.append(group); }
    const relevant = peers.filter(p => p.clientId !== clientId && p.roomId === roomId && p.view === view), objectMap = new Map(objects.map(o => [o.id, o]));
    const selected = new Set<string>(), occupied: {x:number;y:number;width:number;height:number}[] = [], ranks = new Map<string, number>(), activeLabels = new Set<string>();
    const box = svg.viewBox.baseVal, top = box.y+29*u, left = box.x+51*u, right = box.x+box.width-4*u;
    let content = "";
    for (const p of relevant) {
      const color = /^#[a-f0-9]{6}$/i.test(p.color) ? p.color : "#a4cfc1";
      for (const id of p.selected) {
        const key = `${p.actorId}/${id}`, o = objectMap.get(id);
        if (!o || selected.has(key)) continue;
        selected.add(key); activeLabels.add(key);
        const rank = ranks.get(id) ?? 0; ranks.set(id, rank+1);
        const padding = (3+rank*2)*u, b = o.box;
        content += `<rect data-layout-peer-selection="${esc(id)}" data-layout-peer-actor="${esc(p.actorId)}" x="${b.x-padding}" y="${b.y-padding}" width="${b.width+padding*2}" height="${b.height+padding*2}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
        const name = [...p.name].length > 24 ? [...p.name].slice(0,23).join("")+"…" : p.name;
        const w = Math.min(190, Math.max(58, [...name].reduce((n,c)=>n+(c.charCodeAt(0)>255?11:6.5),0)+16))*u, h = 22*u;
        let x = Math.max(left, Math.min(b.x+b.width+padding-w, right-w)), y = Math.max(top, b.y-padding-5*u-h);
        for (let i=0; i<occupied.length+1; i++) {
          const overlap = occupied.find(r=>x<r.x+r.width+3*u&&x+w>r.x-3*u&&y<r.y+r.height+3*u&&y+h>r.y-3*u);
          if (!overlap) break;
          const above = overlap.y-h-3*u;
          y = above >= top ? above : overlap.y+overlap.height+3*u;
        }
        occupied.push({x,y,width:w,height:h});
        content += `<g data-layout-peer-label="${esc(key)}" class="layout-peer-label${hidden.has(key)?' near-pointer':''}" transform="translate(${x} ${y})"><title>${esc(p.name)}</title><rect width="${w}" height="${h}" rx="${3*u}" fill="${color}"/><text x="${8*u}" y="${15*u}" font-size="${11*u}" fill="#2c3d33">${esc(name)}</text></g>`;
      }
      if (p.x !== undefined && p.y !== undefined) content += `<g data-layout-peer="${esc(p.clientId)}" transform="translate(${p.x} ${p.y})"><path d="M0 0L${10*u} ${17*u}L${12*u} ${11*u}L${18*u} ${9*u}Z" fill="${color}" stroke="white" stroke-width="${u}"/></g>`;
    }
    for (const key of hidden) if (!activeLabels.has(key)) hidden.delete(key);
    group.innerHTML = content; proximity(svg);
  }
  return {
    paint,
    move: (svg: SVGSVGElement, event?: {clientX:number;clientY:number}) => { pointer = event ? {x:event.clientX,y:event.clientY} : undefined; proximity(svg); },
  };
}
