import type {Opening} from '../lib/exhibitionTypes.ts';
const svg=(body:string)=>`<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
function doorIcon(right:boolean,outward:boolean){const x=right?24:8,closed=right?8:24,y=outward?5:27;return svg(`<path d="M3 16h5m16 0h5" stroke-width="3"/><path d="M${x} 16V${y}M${closed} 16A16 11 0 0 ${(outward!==right)?0:1} ${x} ${y}"/><circle cx="${x}" cy="16" r="1"/>`);}
export function doorOpeningControls(o:Opening) {
  return `<div class="layout-door-openings" role="group" aria-label="ドアの開き方">${([['start','inward','左吊元・内開き'],['end','inward','右吊元・内開き'],['start','outward','左吊元・外開き'],['end','outward','右吊元・外開き']] as const).map(([hinge,side,label])=>`<button type="button" class="secondary" data-layout-door-opening="${hinge}-${side}" aria-pressed="${!o.visualPath&&(o.hingeSide??'start')===hinge&&(o.swingSide??'inward')===side}">${doorIcon(hinge==='end',side==='outward')}<span>${label}</span></button>`).join('')}</div><p class="layout-panel-hint">左右は壁面図で見た吊元の位置です。${o.visualPath?'選ぶと頂点で編集した扉を標準形状に戻します。':''}</p>`;
}
export function reflectionControls() {
  const icon=svg('<path d="M16 4v24" stroke-dasharray="2 3"/><path d="m5 23 7-14v14zm22 0-7-14v14z"/>');
  return `<div class="layout-reflection-controls"><button type="button" class="secondary" data-layout-reflect="x">${icon}<span>左右反転</span></button><button type="button" class="secondary" data-layout-reflect="y">${icon.replace('<path d="M16', '<g transform="rotate(90 16 16)"><path d="M16').replace('</svg>','</g></svg>')}<span>上下反転</span></button></div>`;
}
