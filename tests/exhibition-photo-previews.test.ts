import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import sharp from 'sharp';
import {writeData} from '../src/lib/store.ts';
import {exhibitionAction,readExhibitions,updateExhibitionStore,exhibitionAssetPath} from '../src/lib/exhibitions.ts';
import {GET} from '../src/pages/api/exhibitions/[id]/assets/[assetId].ts';
const sha=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(run:(f:any)=>Promise<void>){
 const old=process.env.DATA_DIR,dir=fs.mkdtempSync(path.join(os.tmpdir(),'exhibition-photo-preview-'));process.env.DATA_DIR=dir;
 try{
  const users=['staff','member','other'].map(id=>({id,name:id,email:`${id}@example.invalid`,approved:true,role:id==='staff'?'staff':'member',createdAt:'2026-01-01',providers:{}}));writeData('users.json',users);
  const e=(await exhibitionAction('staff',{action:'create',title:'画像の軽量表示'})).exhibition,foreign=(await exhibitionAction('staff',{action:'create',title:'別の写真展'})).exhibition;
  const submissionId=crypto.randomUUID(),now=new Date().toISOString();await updateExhibitionStore(data=>{data.exhibitions[0].participation={state:'published',opensAt:'2020-01-01',closesAt:'2030-01-01',recipientIds:['member','other'],votes:{member:{value:'attending',at:now,actorId:'member'},other:{value:'attending',at:now,actorId:'other'}}};data.submissions.push({id:submissionId,exhibitionId:e.id,userId:'member',draft:{},versions:[]} as any);});
  const add=async(bytes:Buffer,name:string,preview=true)=>{const id=crypto.randomUUID(),meta=await sharp(bytes).metadata();fs.mkdirSync(path.dirname(exhibitionAssetPath(id)),{recursive:true});fs.writeFileSync(exhibitionAssetPath(id),bytes);if(preview)fs.writeFileSync(exhibitionAssetPath(id,true),await sharp(bytes).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).png().toBuffer());const asset={id,submissionId,exhibitionId:e.id,name,mimeType:meta.format==='jpeg'?'image/jpeg':'image/png',bytes:bytes.length,sha256:sha(bytes),width:meta.width,height:meta.height};await updateExhibitionStore(data=>data.assets.push(asset as any));return asset;};
  const request=async(asset:any,preview=true,user='staff',exhibitionId=e.id,legacy=false)=>GET({params:{id:exhibitionId,assetId:asset.id},locals:{user:users.find(u=>u.id===user)},url:new URL(`https://example.invalid/api/exhibitions/${exhibitionId}/assets/${asset.id}${preview?(legacy?'?preview=1':'?preview=1&thumbnail=1'):''}`)} as any);
  await run({e,foreign,add,request,dir});
 }finally{if(old===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=old;fs.rmSync(dir,{recursive:true,force:true});}
}
test('display previews are smaller WebP images while PNG/JPEG downloads and stored print previews remain byte-identical',()=>fixture(async({add,request,dir})=>{
 const raw=Buffer.alloc(2400*1600*3);let seed=123;for(let i=0;i<raw.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;raw[i]=seed>>>24;}
 for(const format of ['png','jpeg'] as const){const bytes=await sharp(raw,{raw:{width:2400,height:1600,channels:3}}).toFormat(format,{quality:98}).toBuffer(),asset=await add(bytes,`元画像.${format==='jpeg'?'jpg':'png'}`),print=fs.readFileSync(exhibitionAssetPath(asset.id,true)),files=fs.readdirSync(dir).sort(),before=JSON.stringify(readExhibitions());
  const response=await request(asset),thumb=Buffer.from(await response.arrayBuffer()),meta=await sharp(thumb).metadata();assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(meta.width,960);assert.equal(meta.height,640);assert.ok(thumb.length<bytes.length/2);assert.equal(Number(response.headers.get('content-length')),thumb.length);
  const original=await request(asset,false);assert.equal(original.headers.get('content-type'),asset.mimeType);assert.equal(sha(Buffer.from(await original.arrayBuffer())),sha(bytes));assert.match(original.headers.get('content-disposition')!,new RegExp(encodeURIComponent(asset.name)));
  const legacy=await request(asset,true,'staff',undefined,true);assert.equal(legacy.headers.get('content-type'),'image/png');assert.equal(sha(Buffer.from(await legacy.arrayBuffer())),sha(print));assert.equal(sha(fs.readFileSync(exhibitionAssetPath(asset.id))),sha(bytes));assert.equal(sha(fs.readFileSync(exhibitionAssetPath(asset.id,true))),sha(print));assert.equal(JSON.stringify(readExhibitions()),before);assert.deepEqual(fs.readdirSync(dir).sort(),files);
 }
}));
test('legacy originals without a PNG preview rotate correctly and small photos are never enlarged',()=>fixture(async({add,request})=>{
 const bytes=await sharp({create:{width:2400,height:1600,channels:3,background:'#66aabb'}}).jpeg().withMetadata({orientation:6}).toBuffer(),asset=await add(bytes,'回転.jpg',false),response=await request(asset),meta=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(meta.width,640);assert.equal(meta.height,960);assert.equal(meta.orientation,undefined);assert.equal(sha(Buffer.from(await(await request(asset,false)).arrayBuffer())),sha(bytes));
 const tiny=await add(await sharp({create:{width:30,height:20,channels:3,background:'#123456'}}).png().toBuffer(),'小さい写真.png');const small=await sharp(Buffer.from(await(await request(tiny)).arrayBuffer())).metadata();assert.equal(small.width,30);assert.equal(small.height,20);
}));
test('multiple previews queue without dropping images and warm cache never bypasses asset authorization',()=>fixture(async({add,request,foreign})=>{
 const bytes=await sharp({create:{width:500,height:300,channels:3,background:'#334455'}}).png().toBuffer(),assets:any[]=[];for(let i=0;i<12;i++)assets.push(await add(bytes,`写真${i}.png`));
 const responses=await Promise.all(assets.map(asset=>request(asset)));for(const response of responses){assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/webp');}
 const repeated=await Promise.all(Array.from({length:12},()=>request(assets[0])));assert.ok(repeated.every(r=>r.status===200));assert.equal((await request(assets[0],true,'other')).status,403);assert.equal((await request(assets[0],true,'anonymous')).status,401);assert.equal((await request(assets[0],true,'staff',foreign.id)).status,404);assert.equal((await request(assets[0],false,'other')).status,403);
}));
