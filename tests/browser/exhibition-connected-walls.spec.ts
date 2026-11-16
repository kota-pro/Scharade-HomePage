import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
import {clickLayout} from './layout-tools-helper';
import {roomProblems} from '../../src/lib/exhibitionGeometry.ts';
import {titleBoardPlacementProblems} from '../../src/lib/exhibitionLayoutModel.ts';
import {roomFromPenPath,roomWalls} from '../../src/lib/exhibitionRoomPath';
const headers={Origin:'http://127.0.0.1:4329'};
async function save(page:Page){await page.locator('[data-layout-save]').click();await expect(page.locator('[data-layout-save]')).toBeEnabled();await expect(page.locator('[data-layout-sync-status]')).toHaveText('保存済み');}
async function setup(page:Page,engine:string){
 await page.setViewportSize({width:1440,height:1000});expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
 const seed=`f2000000-0000-4000-8000-00000000000${['chromium','firefox','webkit'].indexOf(engine)+1}`,id=crypto.randomUUID();
 const data=await(await page.request.get(`/api/member/exhibitions/${seed}`)).json(),works=data.submissions[0].content.works,r=roomFromPenPath([{x:0,y:0},{x:2000,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}]);
 r.wallHeights[1]=3500;r.wallNames={[roomWalls(r)[0].id]:'北壁・左',[roomWalls(r)[1].id]:'北壁・右'};
 r.placements=works.slice(0,2).map((w:any,i:number)=>({workId:w.id,wall:i,wallId:roomWalls(r)[i].id,x:i?800:400,bottom:1000,rotation:0}));
 r.titleBoards=works.slice(0,2).map((w:any,i:number)=>({id:crypto.randomUUID(),workId:w.id,surface:`wall:${i}`,wallId:roomWalls(r)[i].id,x:i?1300:900,bottom:1100,rotation:0}));
 const shape=crypto.randomUUID(),text=crypto.randomUUID();r.annotations=[{id:shape,kind:'rect',name:'受付',text:'案内',surface:'wall:1',surfaceWallId:roomWalls(r)[1].id,x:1800,y:1400,width:400,height:300,rotation:0,fontSize:50},{id:text,kind:'text',surface:'wall:1',surfaceWallId:roomWalls(r)[1].id,x:2000,y:500,width:600,height:100,rotation:0,fontSize:100,text:'入口'}];
 r.openings=[{id:crypto.randomUUID(),wall:1,wallId:roomWalls(r)[1].id,kind:'window',offset:3300,width:600,bottom:400,height:800}];
 r.editor={order:[],hidden:[],locked:[],groups:r.titleBoards!.map((c,i)=>({id:crypto.randomUUID(),name:'作品とボード',objectIds:[`work:${works[i].id}`,`titleboard:${c.id}`]}))};
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));expect(directory.startsWith(path.join(os.tmpdir(),'scharade-browser-'))).toBe(true);
 const file=path.join(directory,'exhibitions.json'),store=JSON.parse(fs.readFileSync(file,'utf8')),exhibition=structuredClone(store.exhibitions.find((e:any)=>e.id===seed));exhibition.id=id;exhibition.rooms=[r];exhibition.revision=1;store.exhibitions.push(exhibition);store.submissions.push(...store.submissions.filter((s:any)=>s.exhibitionId===seed).map((s:any)=>({...structuredClone(s),id:crypto.randomUUID(),exhibitionId:id})));fs.writeFileSync(file,JSON.stringify(store));
 const get=async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
 await page.goto(`/Member/manage/exhibitions/${id}/layout`);await page.locator('[data-open-room-editor="wall"]').click();await page.locator('[data-layout-snap]').uncheck();await page.locator('[data-layout-smart]').uncheck();
 return{id,r,works,shape,text,get};
}
test('continuous wall subdivisions edit together, preserve all physical walls and survive save, undo and reload',async({page},info)=>{
 test.setTimeout(150000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const f=await setup(page,info.project.name),choice=page.locator('[data-layout-view]');
 await expect(choice.locator('option')).toHaveCount(5);await expect(choice.locator('option[value="wall:0"]')).toHaveText('北壁・左・北壁・右');await expect(page.locator('[data-layout-wall-part]')).toHaveCount(2);await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(2);await expect(page.locator('[data-layout-kind="titleboard"]')).toHaveCount(2);await expect(page.locator('[data-layout-kind="opening"]')).toHaveCount(1);await expect(page.locator('[data-layout-summary]')).toContainText('2作品');
 const initial=await f.get();expect(initial.rooms[0].vertices).toEqual(f.r.vertices);expect(initial.rooms[0].wallIds).toEqual(f.r.wallIds);
 // A paired work/card on the second segment can be moved through the first segment's canvas.
 await clickLayout(page,2900,2200);await page.locator('[data-layout-tab="properties"]').click();await page.locator('[data-property-section="位置・向き"] > summary').click();const left=page.locator('[data-layout-property="left"]');await expect(left).toHaveValue('2800');await left.fill('2500');await left.press('Tab');await save(page);
 let stored=(await f.get()).rooms[0];expect(stored.placements[1].x).toBeCloseTo(500,2);expect(stored.titleBoards[1].x).toBeCloseTo(1000,2);expect(stored.placements[1].wall).toBe(1);expect(stored.titleBoards[1].surface).toBe('wall:1');
 await page.locator('[data-layout-canvas]').focus();await page.keyboard.press('Meta+z');await expect.poll(async()=>(await f.get()).rooms[0].placements[1].x).toBeCloseTo(800,2);await page.keyboard.press('Shift+Meta+z');await expect.poll(async()=>(await f.get()).rooms[0].placements[1].x).toBeCloseTo(500,2);
 // Drag the selected pair across the original seam, then undo just that gesture.
 const points=await page.locator('[data-layout-canvas]').evaluate(svg=>{const m=(svg as SVGSVGElement).getScreenCTM()!;return [{x:2675,y:2250},{x:1675,y:2250}].map(p=>{const q=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:q.x,y:q.y};});});await page.mouse.move(points[0].x,points[0].y);await page.mouse.down();await page.mouse.move(points[1].x,points[1].y,{steps:8});await page.mouse.up();await save(page);expect(Math.abs((await f.get()).rooms[0].placements[1].x+500)).toBeLessThan(15);await page.locator('[data-layout-canvas]').focus();await page.keyboard.press('Meta+z');await expect.poll(async()=>(await f.get()).rooms[0].placements[1].x).toBeCloseTo(500,2);
 // Existing text on the second part is edited in-place, with its original local position.
 await page.locator('[data-layout-tool="text"]').click();await page.locator(`[data-layout-object="annotation:${f.text}"] [data-layout-hit]`).click();await page.locator('[data-layout-text-edit]').fill('受付はこちら');await page.locator('[data-text-done]').click();await save(page);stored=(await f.get()).rooms[0];expect(stored.annotations.find((a:any)=>a.id===f.text)).toMatchObject({surface:'wall:1',x:2000,y:500,text:'受付はこちら'});
 await page.locator('[data-layout-tool="select"]').click();await page.locator('[data-layout-tab="works"]').click();await page.locator(`[data-layout-work-add="${f.works[2].id}"]`).click();await clickLayout(page,400,800);await clickLayout(page,900,800);await save(page);await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(3);await expect(page.locator('[data-layout-summary]')).toContainText('3作品');
 await page.locator('[data-layout-tab="align"]').click();await page.locator('[data-layout-equalize-surface]').click();await save(page);stored=(await f.get()).rooms[0];expect(stored.placements).toHaveLength(3);expect(roomProblems(stored,f.works)).toEqual([]);expect(titleBoardPlacementProblems(stored,f.works)).toEqual([]);const shape=stored.annotations.find((a:any)=>a.id===f.shape);expect(shape).toMatchObject({surface:'wall:1',x:1800,y:1400,width:400,height:300});
 // The fit operation includes both wall subdivisions on desktop and on a narrow screen.
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator('[data-layout-fit]').click();await expect.poll(()=>page.locator('[data-layout-wall-part]').evaluateAll(es=>{const c=document.querySelector('[data-layout-canvas]')!.getBoundingClientRect();return es.every(e=>{const b=e.getBoundingClientRect();return b.left>=c.left+40&&b.right<=c.right+1&&b.top>=c.top+20&&b.bottom<=c.bottom+1;});})).toBe(true);await page.locator('.room-edit-dialog').screenshot({path:info.outputPath(`connected-walls-${width}.png`)});}
 await page.locator('[data-room-modal-close]').click();await page.reload();await page.locator('[data-open-room-editor="wall"]').click();await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(3);await expect(page.locator('[data-layout-wall-part]')).toHaveCount(2);stored=(await f.get()).rooms[0];expect(stored.vertices).toEqual(f.r.vertices);expect(stored.wallIds).toEqual(f.r.wallIds);expect(stored.wallNames).toEqual(f.r.wallNames);expect(stored.wallHeights).toEqual(f.r.wallHeights);expect(errors).toEqual([]);
});
