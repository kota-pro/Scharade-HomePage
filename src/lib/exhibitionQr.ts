import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { qrBrand, qrLogoPaths } from "./qrBrand.ts";

export async function exhibitionQrPng(url: string, origin: string, width=720) {
  const qr=await QRCode.toBuffer(url,{width,margin:4,errorCorrectionLevel:"H",color:{dark:"#000000",light:"#ffffff"}});
  const brand=qrBrand(url,origin); if(!brand) return qr;
  const plate=Math.round(width*.18), logoSize=Math.round(plate*.8);
  const logo=new Resvg(fs.readFileSync(path.join(process.cwd(),"public",qrLogoPaths[brand])),{fitTo:{mode:"width",value:logoSize}}).render().asPng();
  const resized=await sharp(logo).resize(logoSize,logoSize,{fit:"inside"}).toBuffer({resolveWithObject:true});
  const overlay=await sharp({create:{width:plate,height:plate,channels:4,background:"#ffffff"}}).composite([{input:resized.data,left:Math.floor((plate-resized.info.width)/2),top:Math.floor((plate-resized.info.height)/2)}]).png().toBuffer();
  return sharp(qr).composite([{input:overlay,left:Math.floor((width-plate)/2),top:Math.floor((width-plate)/2)}]).png().toBuffer();
}
