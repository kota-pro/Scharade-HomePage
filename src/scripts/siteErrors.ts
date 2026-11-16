import { describeSiteError, formatSiteError, numberedError } from '../lib/siteErrors.ts';
import { reportSiteError, reportDisplayedError, setupErrorReports } from './siteErrorReports.ts';

// Cover server-rendered alerts and inline errors from every feature, including dynamically added dialogs.
const selector = '[role="alert"], [data-error="true"], [data-kind="error"], .error, .api-error, .introduction-error, .submission-drive-error, [data-group-error-list] > li';
export function setupSiteErrors() {
  setupErrorReports();
  const decorate = (element: HTMLElement) => {
    const text = element.textContent?.trim() ?? '';
    if (!text) return;
    const existing = numberedError(text);
    if (existing) { reportDisplayedError(text); return; }
    // Containers delegate to their alert children. Never replace controls, links or list structure.
    if (element.querySelector(selector)) return;
    const detail = describeSiteError(text);
    if (element.querySelector('a, button, input, select, textarea, ul, ol, p, [contenteditable]')) {
      if (element.querySelector(':scope > [data-site-error-number]')) return;
      const fragments = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (fragments.length) {
        fragments[0].textContent = describeSiteError(fragments.map(node => node.textContent).join(' ').trim(), 400, detail.code).message + ' ';
        fragments.slice(1).forEach(node => node.remove());
      }
      const number = document.createElement('span'); number.dataset.siteErrorNumber = ''; number.textContent = `エラー番号：${detail.code}\n`;
      element.prepend(number);
    } else element.textContent = formatSiteError(text);
    element.dataset.siteErrorCode = detail.code;
    reportDisplayedError(formatSiteError(detail.message, detail.code));
  };
  const scan = (element: Element) => {
    if (element.matches(selector)) decorate(element as HTMLElement);
    element.querySelectorAll<HTMLElement>(selector).forEach(decorate);
  };
  scan(document.body);
  const observer = new MutationObserver(records => {
    const changed = new Set<Element>();
    for (const record of records) {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      if (element) changed.add(element.closest(selector) ?? element);
    }
    changed.forEach(scan);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'role', 'data-error', 'data-kind'] });

  // Browser validation bubbles are user-visible errors too. Clear only our added custom message on editing.
  document.addEventListener('invalid', event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return;
    if (!field.validationMessage) return;
    let message = field.validationMessage;
    if (!field.validity.customError) {
      const label = field.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
      label?.querySelectorAll('input, select, textarea, small, [role="alert"]').forEach(node => node.remove());
      const name = field.getAttribute('aria-label') || label?.textContent?.replace(/\s+/g, ' ').trim().slice(0,80) || 'この項目';
      const validity = field.validity;
      if (validity.valueMissing) message = `${name}を${field instanceof HTMLSelectElement || field instanceof HTMLInputElement && ['radio','checkbox'].includes(field.type) ? '選択' : '入力'}してください。`;
      else if (validity.typeMismatch) message = `${name}に正しい${field instanceof HTMLInputElement && field.type === 'email' ? 'メールアドレス' : 'URL'}を入力してください。`;
      else if (field instanceof HTMLInputElement && validity.rangeUnderflow) message = `${name}は${field.min}以上の数値で入力してください。`;
      else if (field instanceof HTMLInputElement && validity.rangeOverflow) message = `${name}は${field.max}以下の数値で入力してください。`;
      else if (validity.badInput) message = `${name}に数値を入力してください。`;
      else if (validity.tooLong && 'maxLength' in field) message = `${name}は${field.maxLength}文字以内で入力してください。`;
      else if (validity.tooShort && 'minLength' in field) message = `${name}は${field.minLength}文字以上で入力してください。`;
      else if (validity.patternMismatch || validity.stepMismatch) message = `${name}を画面に表示された入力方法に合わせて入力してください。`;
    }
    field.setCustomValidity(formatSiteError(message, 'SITE-001'));
    reportSiteError('SITE-001', { kind: 'validation' });
    field.dataset.siteNumberedValidity = 'true';
  }, true);
  for (const name of ['input','change']) document.addEventListener(name, event => {
    const field = event.target;
    if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) && field.dataset.siteNumberedValidity) {
      field.setCustomValidity(''); delete field.dataset.siteNumberedValidity;
    }
  }, true);
}
