import fs from 'node:fs';
import sharp from 'sharp';
import {exhibitionAssetPath} from './exhibitions.ts';
import {withImageSlot,ImageBusyError} from './imageSecurity.ts';
import type {ExhibitionAsset} from './exhibitionTypes.ts';

const cache=new Map<string,Buffer>(),pending=new Map<string,Promise<Buffer>>();
const queue:Array<()=>void>=[];
let active=0,cacheBytes=0;
const MAX_BYTES=32*1024*1024,MAX_ENTRIES=256,MAX_PENDING=128;
const pump=()=>{while(active<2&&queue.length){active++;queue.shift()!();}};

/** Called only after asset authorization. Original files and print previews remain untouched. */
export function exhibitionAssetPreview(asset:Pick<ExhibitionAsset,'id'|'sha256'>):Promise<Buffer> {
  const png=exhibitionAssetPath(asset.id,true),original=exhibitionAssetPath(asset.id);
  const source=fs.existsSync(png)?png:original,key=`${source}:${asset.sha256}`;
  const hit=cache.get(key);
  if(hit){cache.delete(key);cache.set(key,hit);return Promise.resolve(hit);}
  const running=pending.get(key);if(running)return running;
  if(pending.size>=MAX_PENDING)return Promise.reject(new ImageBusyError());
  const work=new Promise<Buffer>((resolve,reject)=>{
    queue.push(()=>{
      void withImageSlot(()=>sharp(source,{limitInputPixels:60_000_000,failOn:'error'}).timeout({seconds:20}).rotate().resize({width:960,height:960,fit:'inside',withoutEnlargement:true}).webp({quality:68,alphaQuality:80,effort:3}).toBuffer())
        .then(resolve,reject).finally(()=>{active--;pump();});
    });pump();
  }).then(bytes=>{
    if(bytes.length<=MAX_BYTES){cache.set(key,bytes);cacheBytes+=bytes.length;while(cacheBytes>MAX_BYTES||cache.size>MAX_ENTRIES){const oldest=cache.keys().next().value;if(oldest===undefined)break;cacheBytes-=cache.get(oldest)!.length;cache.delete(oldest);}}
    return bytes;
  }).finally(()=>pending.delete(key));
  pending.set(key,work);return work;
}
