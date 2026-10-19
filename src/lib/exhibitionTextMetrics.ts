import fs from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { contentTextIssues, type TextMeasure } from "./exhibitionText.ts";
import type { SubmissionContent } from "./exhibitionTypes.ts";
let fonts: any[] | undefined;
export const measureBoardText:TextMeasure=(text,size,bold=false)=>{
  fonts??=["Regular","Bold"].map(weight=>fontkit.create(fs.readFileSync(path.join(process.cwd(),`public/fonts/zen-old-mincho/ZenOldMincho-${weight}.ttf`))));
  const font=fonts[bold?1:0];
  return font.layout(text).glyphs.reduce((total:number,glyph:any)=>total+glyph.advanceWidth,0)/font.unitsPerEm*size*25.4/72;
};
export function validateBoardText(content:SubmissionContent) { return contentTextIssues(content,measureBoardText); }
