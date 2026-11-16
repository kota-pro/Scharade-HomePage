type Options = {
  count: () => number;
  create: (width: number, height: number) => boolean;
  message: (text: string, error?: boolean) => void;
};

/** Creation belongs to the editor, including its empty-room state. */
export function createLayoutRoomCreation(options: Options) {
  const size = { width: "6000", height: "4000" };
  const html = () => `<section class="layout-panel-section layout-room-create"><h4>四角形の展示室を追加</h4><div class="exhibition-grid">${[["width", "横幅 W"], ["height", "縦幅 H"]].map(([key, label]) => `<label>${label}<span class="layout-input-unit"><input data-room-size="${key}" type="number" min="1" max="100000" step=".1" required value="${size[key as keyof typeof size]}"/><span>mm</span></span></label>`).join("")}</div><button type="button" class="layout-panel-primary" data-room-add ${options.count() >= 30 ? "disabled" : ""}>展示室を追加</button><p class="layout-panel-hint">指定した寸法の四角形を作成します。追加後は図面で頂点や壁を編集できます。</p></section>`;
  function bind(panel: HTMLElement) {
    panel.querySelectorAll<HTMLInputElement>("[data-room-size]").forEach(input => input.addEventListener("input", () => { size[input.dataset.roomSize as keyof typeof size] = input.value; }));
    panel.querySelector("[data-room-add]")?.addEventListener("click", () => {
      if (options.count() >= 30) { options.message("展示室は30件までです。", true); return; }
      const controls = [...panel.querySelectorAll<HTMLInputElement>("[data-room-size]")];
      if (controls.some(input => !input.reportValidity())) return;
      for (const input of controls) size[input.dataset.roomSize as keyof typeof size] = input.value;
      const width = Number(size.width), height = Number(size.height);
      if (![width, height].every(n => Number.isFinite(n) && n >= 1 && n <= 100000)) { options.message("横幅・縦幅を1〜100000mmで入力してください。", true); return; }
      if (options.create(width, height)) options.message("展示室を追加しました。");
    });
  }
  return { html, bind, reset:()=>{size.width='';size.height='';} };
}
