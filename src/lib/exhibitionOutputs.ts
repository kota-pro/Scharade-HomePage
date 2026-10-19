import {zipSync,strToU8} from 'fflate';
import {outlineSvgText} from './exhibitionSvgText.ts';
import { outlinedAnnotationText } from './exhibitionVectorText.ts';
import { roomFloorBounds } from './exhibitionSurface.ts';
import { layoutScene } from "./exhibitionLayoutScene.ts";
import { editorMetadata,objectHidden,layoutObjects,boundsOf } from "./exhibitionLayoutModel.ts";

import { roomSurfaces } from "./exhibitionSurface.ts";
import { wrapLayoutLabel } from "./exhibitionLabels.ts";
import fs from "node:fs";
import path from "node:path";
import { exhibitionQrPng } from "./exhibitionQr.ts";
import { titleOriginMm, boardTextLayout, wrapBoardText } from "./exhibitionText.ts";
import { validateBoardText } from "./exhibitionTextMetrics.ts";
import type { LayoutWork } from "./exhibitionTypes.ts";
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { Resvg } from "@resvg/resvg-js";
import { latestContent, type Exhibition, type ExhibitionStore, type RoomLayout, type Submission, type Work } from "./exhibitionTypes.ts";
import { layoutBounds, layoutDescription, mmToPt, rotatedCorners } from "./exhibitionGeometry.ts";

const fontDirectory = path.join(process.cwd(), "public/fonts/zen-old-mincho");
const regularFont = path.join(fontDirectory, "ZenOldMincho-Regular.ttf");
const boldFont = path.join(fontDirectory, "ZenOldMincho-Bold.ttf");
const A4: [number, number] = [mmToPt(210), mmToPt(297)];
const A4Landscape: [number, number] = [mmToPt(297), mmToPt(210)];
const BOARD_W = mmToPt(105), BOARD_H = mmToPt(74.25);

export type BoardWork = { submission: Submission; work: Work; qrUrl: string };
export type BoardIssue = { workId: string; title: string; message: string };
const html = (value: string) => value.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!);

export function qrFor(submission: Submission, origin: string) {
  const content = latestContent(submission)!;
  if (submission.portfolioId) return `${origin.replace(/\/$/, "")}/Portfolio/${encodeURIComponent(submission.portfolioId)}`;
  return content.portfolioUrl;
}
export function titleBoardWorks(data: ExhibitionStore, exhibition: Exhibition, origin: string): BoardWork[] {
  return data.submissions
    .filter(s => s.exhibitionId === exhibition.id && !s.inactive && latestContent(s))
    .flatMap(submission => latestContent(submission)!.works.map(work => ({ submission, work, qrUrl: qrFor(submission, origin) })))
    .sort((a, b) => {
      const ac = latestContent(a.submission)!, bc = latestContent(b.submission)!;
      return ac.authorName.localeCompare(bc.authorName, "ja") || a.work.title.localeCompare(b.work.title, "ja");
    });
}
function wrap(font: PDFFont, value: string, size: number, width: number) {
  return wrapBoardText(value,size,width, (text,fontSize)=>font.widthOfTextAtSize(text,fontSize));
}
function boardIssue(_regular: PDFFont, _bold: PDFFont, board: BoardWork): BoardIssue[] {
  const content=latestContent(board.submission)!;
  const issues=validateBoardText({...content,works:[board.work]}).map(i=>({workId:board.work.id,title:board.work.title,message:i.message}));
  if(!board.submission.qrConfirmed || !board.qrUrl) issues.push({workId:board.work.id,title:board.work.title,message:"QRコードの宛先を運営が確定してください。"});
  return issues;
}
async function openBoardFonts(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  // pdf-lib/fontkit's CJK subsetting can omit glyphs after a space in some viewers.
  // Embed the licensed family in full so every Japanese title remains printable.
  return Promise.all([doc.embedFont(fs.readFileSync(regularFont)), doc.embedFont(fs.readFileSync(boldFont))]);
}
export async function titleBoardPreflight(data: ExhibitionStore, exhibition: Exhibition, origin: string) {
  const doc = await PDFDocument.create(), [regular, bold] = await openBoardFonts(doc);
  const works = titleBoardWorks(data, exhibition, origin);
  return { works, issues: works.length ? works.flatMap(work => boardIssue(regular, bold, work)) : [{ workId: "", title: exhibition.title, message: "提出済みの作品がありません。" }] };
}
function boardTextTop(page: PDFPage, text: string, x: number, top: number, size: number, font: PDFFont, boardBottom: number) {
  page.drawText(text, { x, y: boardBottom + BOARD_H - top - size, size, font, color: rgb(.13, .11, .1) });
}
async function drawBoard(doc: PDFDocument, page: PDFPage, offsetX: number, offsetY: number, item: BoardWork, regular: PDFFont, bold: PDFFont, origin: string) {
  const content = latestContent(item.submission)!;
  const x = (mm: number) => offsetX + mmToPt(mm);
  const max = mmToPt(89);
  const titleLines = wrap(bold, `「${item.work.title}」`, 21, mmToPt(boardTextLayout.titleWidth));
  titleLines.forEach((line, i) => boardTextTop(page, line, x(titleOriginMm), mmToPt(8.5 + i * 8.2), 21, bold, offsetY));
  const authorTop = 23;
  boardTextTop(page, content.authorName, x(8), mmToPt(authorTop), 14, regular, offsetY);
  const gradeX = x(8) + regular.widthOfTextAtSize(content.authorName, 14) + mmToPt(6.5);
  boardTextTop(page, content.grade, gradeX, mmToPt(authorTop + 1.1), 10, regular, offsetY);
  const captions = wrap(regular, item.work.caption, 10, max);
  captions.forEach((line, i) => boardTextTop(page, line, x(8), mmToPt(32.3 + i * 4.23), 10, regular, offsetY));
  const metas = [["撮影場所", item.work.location], ["使用機材", item.work.equipment], ["撮影設定", item.work.settings]].filter(([, value]) => value) as [string, string][];
  metas.forEach(([label, value], i) => {
    const row = 50 + i * 6.17;
    boardTextTop(page, label, x(8), mmToPt(row), 8, bold, offsetY);
    boardTextTop(page, value, x(25.4), mmToPt(row), 8, regular, offsetY);
  });
  const qr = await exhibitionQrPng(item.qrUrl, origin);
  const image = await doc.embedPng(qr), box = image.scale(mmToPt(18) / image.width);
  page.drawImage(image, { x: offsetX + BOARD_W - mmToPt(8) - box.width, y: offsetY + mmToPt(7), width: box.width, height: box.height });
}
export async function generateTitleBoards(data: ExhibitionStore, exhibition: Exhibition, origin: string) {
  const preflight = await titleBoardPreflight(data, exhibition, origin);
  if (preflight.issues.length) return { ...preflight, pdf: null as Uint8Array | null };
  const doc = await PDFDocument.create(), [regular, bold] = await openBoardFonts(doc);
  for (let start = 0; start < preflight.works.length; start += 8) {
    const page = doc.addPage(A4);
    for (let index = 0; index < 8; index++) {
      const column = index % 2, row = Math.floor(index / 2);
      page.drawRectangle({ x: column * BOARD_W, y: page.getHeight() - (row + 1) * BOARD_H, width: BOARD_W, height: BOARD_H, borderColor: rgb(.35, .32, .29), borderWidth: .35 });
    }
    for (const [index, board] of preflight.works.slice(start, start + 8).entries()) {
      const column = index % 2, row = Math.floor(index / 2);
      await drawBoard(doc, page, column * BOARD_W, page.getHeight() - (row + 1) * BOARD_H, board, regular, bold, origin);
    }
  }
  return { ...preflight, pdf: await doc.save() };
}


export function roomBounds(room:RoomLayout,works:LayoutWork[]=[]){const b=roomFloorBounds(room),dimensions=layoutObjects(room,works,'floor'),box=boundsOf([{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height},...dimensions.flatMap(o=>[{x:o.box.x,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y+o.box.height}])]);return{x:box.x-300,y:box.y-300,x2:box.x+box.width+300,y2:box.y+box.height+300};}

function svgLines(text:string,x:number,y:number,size:number,width:number) {
  return `<text x="${x}" y="${y}" style="font-size:${size}px">${wrapLayoutLabel(text,size,width).map((line,i)=>`<tspan x="${x}" dy="${i?size*1.35:0}">${html(line)}</tspan>`).join("")}</text>`;
}
/** Keep editing strokes legible in print renderers that scale SVG vector-effect strokes. */
export function printLayoutStrokes(svg:string,scale:number){return svg.replace(/<(?:path|rect|polygon|ellipse|circle)\b[^>]*vector-effect="non-scaling-stroke"[^>]*>/g,tag=>{const match=tag.match(/stroke-width="([\d.]+)"/),width=Number(match?.[1]??1)/scale;const scaled=match?tag.replace(match[0],`stroke-width="${width}"`):tag.replace(/\/>$/,` stroke-width="${width}"/>`);return scaled.replace(/\s*vector-effect="non-scaling-stroke"/g,'');});}
export type LayoutOutputOptions={view?:string;page?:number;imageUrl?:(id:string)=>string;};
export function layoutOutputViews(room:RoomLayout){return[{key:'floor',label:'平面図'},...roomSurfaces(room).filter(s=>!s.groupId||!objectHidden(room,`board:${s.groupId}`)).map(s=>({key:s.key,label:s.label}))];}
function roomNumbers(room:RoomLayout,works:LayoutWork[]){const placed=new Set([...room.placements,...room.boardPlacements??[],...room.books].map(p=>p.workId));return new Map(works.filter(w=>placed.has(w.id)).map((w,i)=>[w.id,i+1]));}
/** A fixed A4 landscape sheet, one diagram plus its corresponding work list. */
export function layoutOutputPages(room:RoomLayout,works:LayoutWork[],view='floor',options:LayoutOutputOptions={}){
 const surface=roomSurfaces(room).find(s=>s.key===view);if(view!=='floor'&&!surface)throw new Error('出力する図面が見つかりません。');
 const W=1122,H=794,numbers=roomNumbers(room,works),objects=layoutObjects(room,works,view).filter(o=>!objectHidden(room,o.id)),entries=view==='floor'?[]:objects.filter(o=>o.kind==='work').sort((a,b)=>a.box.x-b.box.x||a.box.y-b.box.y).map(o=>{const w=works.find(w=>w.id===o.source.workId)!;return{number:numbers.get(w.id)!,text:`${w.title}${room.showExhibitorNames!==false&&w.exhibitorName?' ／ '+w.exhibitorName:''}`,width:o.box.width};});
 const titleBase=room.name+' — '+(surface?.label??'平面図'),headerTop=95+(wrapLayoutLabel(titleBase+'（一覧の続き）',23,1050).length-1)*23*1.35,listHeight=718-headerTop-30;let listPages:{number:number;text:string;width:number;lines:string[]}[][]=[[]];let used=0;
 for(const e of entries){const lines=wrapLayoutLabel(`[${e.number}] ${e.text}`,14,290),height=lines.length*19+29;if(used+height>listHeight&&listPages.at(-1)!.length){listPages.push([]);used=0;}listPages.at(-1)!.push({...e,lines});used+=height;}
 const frame={x:35,y:headerTop,width:view==='floor'?1052:700,height:695-headerTop},b=view==='floor'?roomFloorBounds(room):{x:0,y:0,width:surface!.width,height:surface!.height};
 const extent=boundsOf([{x:b.x,y:b.y},{x:b.x+b.width,y:b.y+b.height},...objects.flatMap(o=>[{x:o.box.x,y:o.box.y},{x:o.box.x+o.box.width,y:o.box.y+o.box.height}])]);
 // Reserve fixed screen space around the diagram for wall names and horizontal dimensions.
 let scale=Math.min((frame.width-90)/Math.max(1,extent.width),(frame.height-160)/Math.max(1,extent.height));
 let scene=layoutScene(room,works,view,{unit:1/scale,outlineText:outlinedAnnotationText,sizes:true,panelEdges:false,panelSizes:false,horizontalOnly:true,workNumbers:view==='floor'?undefined:numbers,imageUrl:options.imageUrl});
 for(let pass=0;pass<10;pass++){const next=Math.min((frame.width-20)/Math.max(1,scene.bounds.width),(frame.height-20)/Math.max(1,scene.bounds.height));if(next>=scale*.999)break;scale=next;scene=layoutScene(room,works,view,{unit:1/scale,outlineText:outlinedAnnotationText,sizes:true,panelEdges:false,panelSizes:false,horizontalOnly:true,workNumbers:view==='floor'?undefined:numbers,imageUrl:options.imageUrl});}
 const tx=frame.x+(frame.width-scene.bounds.width*scale)/2-scene.bounds.x*scale,ty=frame.y+(frame.height-scene.bounds.height*scale)/2-scene.bounds.y*scale;
 const graphics=`<g data-output-diagram="${html(view)}" transform="translate(${tx} ${ty}) scale(${scale})">${printLayoutStrokes(scene.svg,scale)}</g>`;
 const hidden=editorMetadata(room).hidden.length,footer=hidden?`非表示の項目 ${hidden}件は出力に含みません。`:'実寸：mm';
 const legendText=view==='floor'?scene.legend.map(e=>`[${e.number}] ${e.text}`).join(' ／ '):'',legendLines=wrapLayoutLabel(legendText,10,1050),legendPages=Array.from({length:Math.ceil(legendLines.length/3)},(_,i)=>legendLines.slice(i*3,i*3+3).join(''));if(view==='floor'&&legendPages.length>1)listPages=legendPages.map(()=>[]);
 return listPages.map((list,index)=>{let y=headerTop+30;const rows=list.map(e=>{const row=`<g data-output-work="${e.number}">${svgLines(`[${e.number}] ${e.text}`,780,y,14,290)}${svgLines(`横幅 ${e.width.toFixed(1)} mm`,780,y+e.lines.length*19+4,11,290)}</g>`;y+=e.lines.length*19+29;return row;}).join('');
 const legend=view==='floor'&&scene.legend.length?svgLines(legendPages[index]??'',35,714,10,1050):'';
 return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 ${W} ${H}"><style>text{font-family:'Zen Old Mincho',serif;fill:#251f1c}</style><rect width="100%" height="100%" fill="white"/>${svgLines(titleBase+(index?'（一覧の続き）':''),35,43,23,1050)}${svgLines(view==='floor'?'展示室の平面図':surface!.label,35,headerTop-21,13,700)}${graphics}${view==='floor'?'':`<path d="M757 ${headerTop-3}V718" stroke="#ddd"/>${svgLines('展示作品',780,headerTop-3,17,290)}${rows||svgLines('配置されている作品はありません。',780,headerTop+30,13,290)}`}${legend}${svgLines(footer,35,765,11,1050)}${svgLines(`${index+1} / ${listPages.length}`,1000,765,11,80)}</svg>`;
 });
}
function pngFromSvg(svg:string){return new Resvg(svg,{font:{fontFiles:[regularFont,boldFont],loadSystemFonts:false},fitTo:{mode:'width',value:2244}}).render().asPng();}
export function exhibitionLayoutSvg(room:RoomLayout,works:LayoutWork[],options:LayoutOutputOptions={}){const pages=layoutOutputPages(room,works,options.view??'floor',options);if(options.page!==undefined&&(!Number.isInteger(options.page)||options.page<0||options.page>=pages.length))throw new Error('出力ページを確認してください。');return pages[options.page??0];}
export function exhibitionLayoutPng(room:RoomLayout,works:LayoutWork[],options:LayoutOutputOptions={}){return pngFromSvg(exhibitionLayoutSvg(room,works,options));}
export function exhibitionLayoutSvgFiles(room:RoomLayout,works:LayoutWork[],options:LayoutOutputOptions={}){
 const files:{name:string;bytes:Uint8Array}[]=[];let n=0;for(const view of layoutOutputViews(room))for(const [page,svg]of layoutOutputPages(room,works,view.key,options).entries()){const name=view.label.replace(/[\x00-\x1f\x7f/\\:]/g,'_').slice(0,100);files.push({name:`${String(++n).padStart(3,'0')}-${name}${page?`-一覧${page+1}`:''}.svg`,bytes:strToU8(outlineSvgText(svg))});}return files;
}
export function layoutSvgFilesZip(files:ReturnType<typeof exhibitionLayoutSvgFiles>){return zipSync(Object.fromEntries(files.map(f=>[f.name,[f.bytes,{mtime:new Date(1980,0,1),level:6}]])));}
export function exhibitionLayoutSvgZip(room:RoomLayout,works:LayoutWork[],options:LayoutOutputOptions={}){return layoutSvgFilesZip(exhibitionLayoutSvgFiles(room,works,options));}
export async function exhibitionLayoutPdf(rooms:RoomLayout[],works:LayoutWork[],options:LayoutOutputOptions={}){
 const doc=await PDFDocument.create();for(const room of rooms)for(const view of layoutOutputViews(room))for(const svg of layoutOutputPages(room,works,view.key,options)){const page=doc.addPage(A4Landscape),image=await doc.embedPng(pngFromSvg(svg));page.drawImage(image,{x:0,y:0,width:page.getWidth(),height:page.getHeight()});}return doc.save();
}
export function allWorks(data: ExhibitionStore, exhibitionId: string) {
  return data.submissions.filter(s => s.exhibitionId === exhibitionId && !s.inactive).flatMap(s => (latestContent(s)?.works ?? []).map(w => ({ ...w, exhibitorName: latestContent(s)?.authorName || latestContent(s)?.name || "" })));
}
export function titleBoardLayoutSummary(work: Work) { return work.kind === "series" ? layoutDescription(work.photos) : work.photos.length ? `${work.photos[0].width.toFixed(1)} × ${work.photos[0].height.toFixed(1)} mm` : work.kind === "book" ? "ブック（作品画像は任意）" : "作品データなし"; }
export function workLayoutPng(work: Work) {
  const bounds = layoutBounds(work.photos);
  const width = Math.max(80, bounds.width), height = Math.max(80, bounds.height), pad = 12;
  const rectangles = work.photos.map((photo, index) => `<g transform="translate(${pad + photo.x - bounds.x} ${pad + photo.y - bounds.y}) rotate(${photo.rotation})"><rect x="0" y="0" width="${photo.width}" height="${photo.height}" fill="${index % 2 ? "#d7d2c9" : "#bdb7ad"}" stroke="#2a2420" stroke-width="0.8"/><text x="${photo.width / 2}" y="${photo.height / 2}" text-anchor="middle" dominant-baseline="middle" font-size="7" fill="#2a2420">${index + 1}</text></g>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width + pad * 2}" height="${height + pad * 2}" viewBox="0 0 ${width + pad * 2} ${height + pad * 2}"><rect width="100%" height="100%" fill="white"/><rect x="${pad}" y="${pad}" width="${width}" height="${height}" fill="none" stroke="#716b63" stroke-width=".5"/>${rectangles}</svg>`;
  return new Resvg(svg, { fitTo: { mode: width > height ? "width" : "height", value: 800 } }).render().asPng();
}
