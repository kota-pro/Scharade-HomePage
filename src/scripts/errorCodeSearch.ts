const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim();
const compactCode = (value: string) => value.replace(/[-_‐‑–—−]/g, '');

export function setupErrorCodeSearch() {
  const root = document.querySelector<HTMLElement>('[data-error-code-guide]');
  if (!root) return;
  const input = root.querySelector<HTMLInputElement>('[data-error-code-search]')!;
  const clear = root.querySelector<HTMLButtonElement>('[data-error-search-clear]')!;
  const count = root.querySelector<HTMLElement>('[data-error-search-count]')!;
  const empty = root.querySelector<HTMLElement>('[data-error-search-empty]')!;
  const entries = [...root.querySelectorAll<HTMLElement>('[data-error-code-entry]')].map(element => ({
    element,
    text: normalize(element.dataset.errorSearchText ?? ''),
    code: compactCode(normalize(element.dataset.errorCode ?? '')),
  }));
  const groups = [...root.querySelectorAll<HTMLElement>('[data-error-code-group]')];
  const update = () => {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const entry of entries) {
      const visible = terms.every(term => entry.text.includes(term) || Boolean(compactCode(term)) && entry.code.includes(compactCode(term)));
      entry.element.hidden = !visible;
      if (visible) matches++;
    }
    for (const group of groups) group.hidden = !group.querySelector('[data-error-code-entry]:not([hidden])');
    empty.hidden = matches !== 0;
    clear.disabled = input.value.length === 0;
    count.textContent = terms.length ? `検索結果：${matches}件 / 全${entries.length}件` : `全${entries.length}件`;
  };
  input.addEventListener('input', update);
  clear.addEventListener('click', () => { input.value = ''; update(); input.focus(); });
  root.querySelector<HTMLElement>('[data-error-search-controls]')!.hidden = false;
  update();
}
