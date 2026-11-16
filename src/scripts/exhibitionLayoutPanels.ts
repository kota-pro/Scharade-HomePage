import { layoutEscape as esc } from "../lib/exhibitionLayoutScene.ts";

export const panelSection = (title: string, body: string) =>
  `<section class="layout-panel-section"><h4>${esc(title)}</h4>${body}</section>`;
export const panelContext = (title: string, detail: string, icon: string, tag = "") =>
  `<div class="layout-panel-context"><span class="layout-panel-symbol">${icon}</span><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>${tag ? `<span class="layout-panel-tag">${esc(tag)}</span>` : ""}</div>`;

export function alignmentPanel(options: {
  reference: string; key: string; gap: number; floor: boolean;
  objects: {id: string; label: string}[]; sizes: boolean; eye: boolean;
  icon: (key: string) => string;
}) {
  const o = options;
  const buttons = (entries: string[][], attribute: string) => entries.map(([key, label]) => `<button type="button" class="secondary" ${attribute}="${key}" aria-label="${label}" title="${label}">${o.icon(key)}</button>`).join("");
  return panelSection("整列の基準", `<div class="layout-align-reference" role="group" aria-label="整列の基準">${[["selection", "選択範囲"], ["surface", o.floor ? "この展示室" : "この壁面"], ["key", "キー項目"]].map(([key, label]) => `<button type="button" data-layout-align-reference="${key}" aria-pressed="${o.reference === key}">${label}</button>`).join("")}</div>${o.reference === "key" ? `<label>キーオブジェクト<select data-layout-key>${o.objects.map(obj => `<option value="${obj.id}" ${obj.id === o.key ? "selected" : ""}>${esc(obj.label)}</option>`).join("")}</select></label>` : ""}`)
    + panelSection("整列", `<div class="layout-align-row"><span>横方向</span><div>${buttons([["left", "左揃え"], ["centerX", "横中央"], ["right", "右揃え"]], "data-layout-align")}</div></div><div class="layout-align-row"><span>縦方向</span><div>${buttons([["top", "上揃え"], ["centerY", "縦中央"], ["bottom", "下揃え"]], "data-layout-align")}</div></div>`)
    + panelSection("分布・間隔", `<div class="layout-gap-controls"><label>指定する間隔<span class="layout-input-unit"><input data-layout-gap type="number" step=".1" value="${o.gap}"/><span>mm</span></span></label>${buttons([["x", "横・指定間隔"], ["y", "縦・指定間隔"]], "data-layout-distribute")}</div><div class="layout-align-row"><span>等間隔</span><div>${buttons([["equal-x", "横・等間隔"], ["equal-y", "縦・等間隔"]], "data-layout-distribute")}</div><p class="layout-panel-hint">直接選択で、作品とタイトルボードの間隔も調整できます。</p>`)
    + (o.floor ? "" : panelSection("壁面全体への配置", `<button type="button" class="layout-panel-wide" data-layout-equalize-surface aria-label="両端を含めて作品を均等配置" title="両端を含めて作品を均等配置">${o.icon("equal-x")}<span>両端の余白も含めて均等配置</span></button><p class="layout-panel-hint">壁の端と作品の間、作品同士の間隔を揃えます。展示ボードは各パネル内で配置します。</p>`))
    + panelSection("表示・配置補助", `<label class="exhibition-check"><input type="checkbox" data-layout-guide="sizes" ${o.sizes ? "checked" : ""}/>寸法を表示</label><label class="exhibition-check"><input type="checkbox" data-layout-guide="eye" ${o.eye ? "checked" : ""}/>目線の高さ 1450 mm を表示</label>${o.floor ? "" : '<button type="button" class="secondary layout-panel-wide" data-layout-eye-align>作品の中心を目線に揃える</button>'}`);
}

/** Editing groups start closed; native details retains keyboard and touch access. */
export function organizePropertySections(panel:HTMLElement){
  const order=['名前','図形の寸法','塗りつぶし','輪郭線','反転','位置・向き','外観・注記','作者名・タイトルの表示','壁の名前'];
  const sections=[...panel.querySelectorAll<HTMLElement>(':scope > .layout-panel-section')].map((section,index)=>{
    const heading=section.querySelector(':scope > h4'),title=heading?.textContent??'';if(!heading)return{section,title,index};
    heading.remove();const details=document.createElement('details');details.className=section.className+' layout-property-section';details.dataset.propertySection=title;const summary=document.createElement('summary');summary.textContent=title;const body=document.createElement('div');body.className='layout-property-body';while(section.firstChild)body.append(section.firstChild);details.append(summary,body);section.replaceWith(details);return{section:details,title,index};
  });
  const rank=(title:string)=>{const i=order.indexOf(title);return i<0?order.length:i;};sections.sort((a,b)=>rank(a.title)-rank(b.title)||a.index-b.index);
  const context=panel.querySelector(':scope > .layout-panel-context');let anchor:Element|null=context;for(const {section}of sections){if(anchor)anchor.after(section);else panel.prepend(section);anchor=section;}
}
