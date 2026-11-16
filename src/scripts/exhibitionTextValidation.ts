import { contentTextIssues, fitBoardCaption, layoutBoardMetadata, metadataTypography, textLimits } from "../lib/exhibitionText.ts";
import type { SubmissionContent } from "../lib/exhibitionTypes.ts";
import type { TextIssue } from '../lib/exhibitionText.ts';
import { formatExhibitionError } from '../lib/exhibitionErrors.ts';
import { createTextMeasurement } from './exhibitionTextMeasurement.ts';
import { reportSiteError } from './siteErrorReports.ts';
import type { ErrorReport } from '../lib/siteErrorReport.ts';
class FontMeasurementError extends Error {
  constructor(readonly details: Partial<ErrorReport>) { super('Font measurement unavailable'); }
}
const measurement = createTextMeasurement(async () => {
  await Promise.all([400,700].map(async weight => {
    const resource = weight === 700 ? 'font-bold' : 'font-regular';
    let response: Response, bytes: ArrayBuffer;
    try {
      response = await fetch(`/fonts/zen-old-mincho/ZenOldMincho-${weight === 700 ? 'Bold' : 'Regular'}.ttf`, { signal: AbortSignal.timeout(5000), cache: 'force-cache' });
      if (!response.ok) throw new FontMeasurementError({ resource, reason: 'font-http', status: response.status });
      bytes = await response.arrayBuffer();
    } catch (error) {
      if (error instanceof FontMeasurementError) throw error;
      throw new FontMeasurementError({ resource, reason: error instanceof Error && ['TimeoutError','AbortError'].includes(error.name) ? 'font-timeout' : 'font-network' });
    }
    try {
      const face = new FontFace('Exhibition Zen', bytes, { weight: String(weight) });
      await face.load(); document.fonts.add(face);
    } catch { throw new FontMeasurementError({ resource, reason: 'font-decode', status: response.status }); }
  }));
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new FontMeasurementError({ reason: 'canvas-unavailable' });
  ctx.fontKerning = 'none';
  // Measure at the design scale to avoid browser rounding at fractional sizes.
  return (text, size, bold = false) => { ctx.font = `${bold ? 700 : 400} 1000px "Exhibition Zen"`; return ctx.measureText(text).width / 1000 * size * 25.4 / 72; };
}, 5000, error => reportSiteError('EXH-022', { kind: 'font', ...(error instanceof FontMeasurementError ? error.details : { reason: 'measurement-timeout' }) }));
const serverWarnings = new WeakMap<HTMLElement, { fingerprint: string; issues: TextIssue[] }>();
export function setServerTextIssues(root: HTMLElement, content: SubmissionContent, issues: TextIssue[]) {
  serverWarnings.set(root, { fingerprint: JSON.stringify(content), issues });
  validateTextFields(root, content);
}
const metadataResizeRoots=new WeakSet<HTMLElement>();
export function metadataLineHint(workId:string) {
  const id=workId.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  return `<div class="exhibition-metadata-usage"><p data-metadata-lines="${id}" aria-live="polite"></p><small>標準は3項目で合計3行です。空欄の行も使えます。はみ出しても提出でき、運営が配置を調整します。</small></div>`;
}
export function resizeMetadataInputs(root:HTMLElement) {
  root.querySelectorAll<HTMLTextAreaElement>('textarea[data-metadata-input]').forEach(input=>{
    if(!input.getClientRects().length)return;
    input.style.height="auto";
    const border=input.offsetHeight-input.clientHeight;
    input.style.height=`${Math.min(168,Math.max(40,input.scrollHeight+border))}px`;
  });
}
function pathOf(element:HTMLElement) {
  if(element.dataset.common) return element.dataset.common;
  if(element.dataset.boardCommon) return element.dataset.boardCommon;
  const work=element.dataset.workId || element.closest<HTMLElement>("[data-board-work]")?.dataset.boardWork;
  if(element.dataset.titleboardPath)return `works.${work}.titleBoard.${element.dataset.titleboardPath}`;
  const key=element.dataset.workKey || element.dataset.boardKey;
  return work ? `works.${work}.${element.dataset.workDetail?"details."+element.dataset.workDetail:key}` : "";
}
export function validateTextFields(root:HTMLElement,content:SubmissionContent) {
  const measure = measurement.get();
  root.querySelectorAll("[data-text-warning]").forEach(e=>e.remove());
  root.querySelectorAll("[data-text-counter]").forEach(e=>e.remove());
  const controls=[...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>("[data-common], [data-work-key], [data-work-detail], [data-board-common], [data-board-key], [data-titleboard-path]")];
  controls.forEach(input=>{
    if(input.dataset.textInvalid) {input.removeAttribute("aria-invalid");input.removeAttribute("aria-describedby"); delete input.dataset.textInvalid;}
    const key=input.dataset.common || input.dataset.workKey || input.dataset.boardCommon || input.dataset.boardKey || input.dataset.workDetail;
    const limit=input.dataset.titleboardPath?.endsWith(".reading")?40:key && (textLimits as Record<string,number>)[key] || (input.dataset.workDetail?textLimits.metadata:0);
    if(limit) {
      const counter=document.createElement("small");counter.dataset.textCounter="";
      const size=key==="caption" ? measure ? `（${fitBoardCaption(input.value,measure).fontSize}pt）` : measurement.unavailable() ? "（印刷時の文字サイズは提出時に確認します）" : "（文字サイズを計測中）" : "";
      counter.textContent=input.dataset.titleboardPath?.endsWith(".reading")?`${Array.from(input.value).length} / ${limit}文字`:`${Array.from(input.value).length} / ${limit}文字${size}（標準配置の目安）`;
      input.closest("label")?.append(counter);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-metadata-lines]').forEach(counter=>{
    const work=content.works.find(w=>w.id===counter.dataset.metadataLines);if(!work)return;
    const layout=measure?layoutBoardMetadata(work,measure):undefined;
    counter.textContent=layout?`撮影情報：${layout.lineCount} / ${metadataTypography.maxLines}行（8pt）`:measurement.unavailable()?"撮影情報が印刷枠に収まるかは提出時に確認します。":"撮影情報の行数を計測中";
    counter.classList.toggle('exhibition-text-warning',!!layout&&!layout.fits);
  });
  resizeMetadataInputs(root);
  const issues=contentTextIssues(content,measure);
  root.querySelectorAll<HTMLElement>("[data-titleboard-errors]").forEach(box=>{const own=issues.filter(issue=>issue.path.startsWith(`works.${box.dataset.titleboardErrors}.titleBoard.`)&&!controls.some(input=>pathOf(input)===issue.path));box.textContent=own.map(issue=>issue.message).join("\n");box.hidden=!own.length;});
  const server = serverWarnings.get(root);
  if (server?.fingerprint === JSON.stringify(content)) {
    for (const issue of server.issues) if (!issues.some(item => item.path === issue.path && item.message === issue.message)) issues.push(issue);
  } else serverWarnings.delete(root);
  issues.forEach((issue,i)=>{
    let path=issue.path;
    for(const [key,detail]of [["location","place"],["equipment","camera"],["settings","shutterSpeed"]]) if(path.endsWith("."+key) && !controls.some(e=>pathOf(e)===path)) path=path.slice(0,-key.length)+"details."+detail;
    const input=controls.find(e=>pathOf(e)===path);if(!input)return;
    const warning=document.createElement("small");warning.className="exhibition-text-warning";warning.dataset.textWarning="";warning.id=`text-warning-${i}`;warning.textContent=issue.layout ? `${issue.message} このまま提出できます。` : formatExhibitionError(issue.message,'EXH-004');
    input.dataset.textInvalid="true";if(!issue.layout||input.getAttribute("aria-invalid")!=="true")input.setAttribute("aria-invalid",issue.layout?"false":"true");input.setAttribute("aria-describedby",warning.id);input.closest("label")?.append(warning);
  });
  return issues.filter(issue=>!issue.layout);
}
export async function ensureTextMeasurement() { await measurement.load(); }
export function bindTextValidation(root:HTMLElement,getContent:()=>SubmissionContent) {
  const validate=()=>validateTextFields(root,getContent());let timer:number|undefined;
  if(!metadataResizeRoots.has(root)) {
    metadataResizeRoots.add(root);let width=root.clientWidth,frame=0;
    const observer=new ResizeObserver(()=>{
      if(!root.isConnected){observer.disconnect();cancelAnimationFrame(frame);metadataResizeRoots.delete(root);return;}
      if(root.clientWidth!==width){width=root.clientWidth;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(root.isConnected)resizeMetadataInputs(root);});}
    });
    observer.observe(root);
  }
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>("[data-common], [data-work-key], [data-work-detail], [data-board-common], [data-board-key], [data-titleboard-path]").forEach(input=>{
    input.addEventListener("input",event=>{if((event as InputEvent).isComposing)return;clearTimeout(timer);timer=window.setTimeout(validate,120);});
    input.addEventListener("compositionend",validate);
  });
  validate(); void measurement.load().then(validate).catch(validate);
}
