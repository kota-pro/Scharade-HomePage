import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'scharade-portfolio-media-'));
Object.assign(process.env,{DATA_DIR:directory,NODE_ENV:'test',MICROCMS_SERVICE_DOMAIN:'fixture',MICROCMS_SERVER_API_KEY:'fixture',SITE_URL:'https://scharade.jp'});
const {writeData}=await import('../src/lib/store.ts');const {createSession}=await import('../src/lib/auth.ts');const {POST}=await import('../src/pages/api/portfolio/update.ts');const {safeMediaUrl}=await import('../src/lib/contentSecurity.ts');
after(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('Portfolio rejects unrenderable media before CMS writes and accepts uploaded URLs',async()=>{
 writeData('users.json',[{id:'media-member',name:'架空会員',email:'media@example.invalid',approved:true,role:'member',portfolioId:'media-member',createdAt:new Date().toISOString(),providers:{credentials:true}}]);
 const session=await createSession('media-member',3600),originalFetch=globalThis.fetch;let writes:Record<string,unknown>[]=[];
 globalThis.fetch=async(_url,options)=>{writes.push(JSON.parse(String(options?.body)));return Response.json({id:'media-member'});};
 const update=(value:unknown)=>POST({request:new Request('https://scharade.jp/api/portfolio/update',{method:'POST',headers:{Cookie:`__Host-session=${session.token}`,'Content-Type':'application/json'},body:JSON.stringify(value)})} as any);
 try{
  for(const url of ['https://user:pass@images.microcms-assets.io/a.jpg','https://images.microcms-assets.io:444/a.jpg','https://microcms-assets.io.evil.invalid/a.jpg','http://images.microcms-assets.io/a.jpg']){
   assert.equal(safeMediaUrl(url),'');assert.equal((await update({iconUrl:url})).status,400);assert.equal((await update({pictures:[url]})).status,400);
  }
  assert.equal(writes.length,0);
  const valid='https://images.microcms-assets.io/assets/fixture/upload.webp?w=1200';assert.ok(safeMediaUrl(valid));assert.equal((await update({iconUrl:valid,pictures:[valid]})).status,200);assert.deepEqual(writes,[{icon:valid,pictures:[valid]}]);
  assert.equal((await update({iconUrl:'',pictures:[]})).status,200);
 }finally{globalThis.fetch=originalFetch;}
});
