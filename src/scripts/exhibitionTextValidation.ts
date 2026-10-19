import { contentTextIssues, textLimits, type TextMeasure } from "../lib/exhibitionText.ts";
import type { SubmissionContent } from "../lib/exhibitionTypes.ts";
let measure:TextMeasure|undefined, fontPromise:Promise<void>|undefined;
function loadFonts() {
  return fontPromise??=Promise.all([400,700].map(async weight=>{
    const face=new FontFace("Exhibition Zen",`url(/fonts/zen-old-mincho/ZenOldMincho-${weight===700?"Bold":"Regular"}.ttf)`,{weight:String(weight)});
    await face.load(); document.fonts.add(face);
  })).then(()=>{
    const ctx=document.createElement("canvas").getContext("2d")!;ctx.fontKerning="none";
    measure=(text,size,bold=false)=>{ctx.font=`${bold?700:400} ${size}px "Exhibition Zen"`;return ctx.measureText(text).width*25.4/72;};
  });
}
function pathOf(element:HTMLElement) {
  if(element.dataset.common) return element.dataset.common;
  if(element.dataset.boardCommon) return element.dataset.boardCommon;
  const work=element.dataset.workId || element.closest<HTMLElement>("[data-board-work]")?.dataset.boardWork;
  const key=element.dataset.workKey || element.dataset.boardKey;
  return work ? `works.${work}.${element.dataset.workDetail?"details."+element.dataset.workDetail:key}` : "";
}
export function validateTextFields(root:HTMLElement,content:SubmissionContent) {
  root.querySelectorAll("[data-text-warning]").forEach(e=>e.remove());
  root.querySelectorAll("[data-text-counter]").forEach(e=>e.remove());
  const controls=[...root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>("[data-common], [data-work-key], [data-work-detail], [data-board-common], [data-board-key]")];
  controls.forEach(input=>{
    if(input.dataset.textInvalid) {input.removeAttribute("aria-invalid");input.removeAttribute("aria-describedby"); delete input.dataset.textInvalid;}
    const key=input.dataset.common || input.dataset.workKey || input.dataset.boardCommon || input.dataset.boardKey || input.dataset.workDetail;
    const limit=key && (textLimits as Record<string,number>)[key] || (input.dataset.workDetail?textLimits.metadata:0);
    if(limit) {const counter=document.createElement("small");counter.dataset.textCounter="";counter.textContent=`${Array.from(input.value).length} / ${limit}文字（枠の幅でも確認します）`;input.closest("label")?.append(counter);}
  });
  const issues=contentTextIssues(content,measure);
  issues.forEach((issue,i)=>{
    let path=issue.path;
    for(const [key,detail]of [["location","place"],["equipment","camera"],["settings","shutterSpeed"]]) if(path.endsWith("."+key) && !controls.some(e=>pathOf(e)===path)) path=path.slice(0,-key.length)+"details."+detail;
    const input=controls.find(e=>pathOf(e)===path);if(!input)return;
    const warning=document.createElement("small");warning.className="exhibition-text-warning";warning.dataset.textWarning="";warning.id=`text-warning-${i}`;warning.textContent=issue.message;
    input.dataset.textInvalid="true";input.setAttribute("aria-invalid","true");input.setAttribute("aria-describedby",warning.id);input.closest("label")?.append(warning);
  });
  return issues;
}
export async function ensureTextMeasurement() { await loadFonts(); }
export function bindTextValidation(root:HTMLElement,getContent:()=>SubmissionContent) {
  const validate=()=>validateTextFields(root,getContent());let timer:number|undefined;
  root.querySelectorAll<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>("[data-common], [data-work-key], [data-work-detail], [data-board-common], [data-board-key]").forEach(input=>{
    input.addEventListener("input",event=>{if((event as InputEvent).isComposing)return;clearTimeout(timer);timer=window.setTimeout(validate,120);});
    input.addEventListener("compositionend",validate);
  });
  validate(); void loadFonts().then(validate).catch(()=>{ /* Server verification is still mandatory. */ });
}
