import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
import {roomFromPenPath,roomWalls} from '../../src/lib/exhibitionRoomPath';
const headers={Origin:'http://127.0.0.1:4329'};
async function save(page:Page){await page.locator('[data-layout-save]').click();await expect(page.locator('[data-layout-save]')).toBeEnabled();await expect(page.locator('[data-layout-sync-status]')).toHaveText('保存済み');}
test('180/-180 walls join before edits and direction input removes residual tilt without losing placements',async({page},info)=>{
 test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});
 expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
 const seed=`f2000000-0000-4000-8000-00000000000${['chromium','firefox','webkit'].indexOf(info.project.name)+1}`,id=crypto.randomUUID(),data=await(await page.request.get(`/api/member/exhibitions/${seed}`)).json();
 const r=roomFromPenPath([{x:6000,y:0},{x:4000,y:.5},{x:0,y:0},{x:0,y:4000},{x:6000,y:4000}]),works=data.submissions[0].content.works;
 r.placements=works.slice(0,2).map((w:any,i:number)=>({workId:w.id,wall:i,wallId:roomWalls(r)[i].id,x:400,bottom:1000,rotation:0}));
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));expect(directory.startsWith(path.join(os.tmpdir(),'scharade-browser-'))).toBe(true);
 const file=path.join(directory,'exhibitions.json'),store=JSON.parse(fs.readFileSync(file,'utf8')),e=structuredClone(store.exhibitions.find((e:any)=>e.id===seed));e.id=id;e.rooms=[r];e.revision=1;store.exhibitions.push(e);store.submissions.push(...store.submissions.filter((s:any)=>s.exhibitionId===seed).map((s:any)=>({...structuredClone(s),id:crypto.randomUUID(),exhibitionId:id})));fs.writeFileSync(file,JSON.stringify(store));
 const get=async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition.rooms[0];
 await page.goto(`/Member/manage/exhibitions/${id}/layout`);await page.locator('[data-open-room-editor="wall"]').click();
 await expect(page.locator('[data-layout-view] option')).toHaveCount(5);await expect(page.locator('[data-layout-wall-part]')).toHaveCount(2);await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(2);expect((await get()).vertices).toEqual(r.vertices);
 await page.locator('[data-layout-view]').selectOption('floor');await page.locator('.layout-room-info > summary').click();await page.locator('.layout-room-info details > summary').click();
 await page.locator('[data-layout-wall-choice]').selectOption('0');const angle=page.locator('[data-layout-property="wall-angle"]');await expect(angle).toHaveValue('180');await angle.fill('-180');await angle.press('Tab');await save(page);
 let current=await get();expect(Math.abs(current.vertices[1].y-current.vertices[0].y)).toBeLessThan(1e-8);expect(current.vertices[1].x).toBeLessThan(current.vertices[0].x);expect(current.placements).toEqual(r.placements);expect(current.wallIds).toEqual(r.wallIds);
 await page.locator('[data-layout-canvas]').focus();await page.keyboard.press('Meta+z');await expect.poll(async()=>(await get()).vertices[1].y).toBeCloseTo(.5,5);await page.keyboard.press('Shift+Meta+z');await expect.poll(async()=>Math.abs((await get()).vertices[1].y)).toBeLessThan(1e-8);
 await page.locator('[data-layout-view]').selectOption('wall:0');await expect(page.locator('[data-layout-wall-part]')).toHaveCount(2);await page.locator('.room-edit-dialog').screenshot({path:info.outputPath('wall-angle-wrap.png')});await page.locator('[data-room-modal-close]').click();await page.reload();await page.locator('[data-open-room-editor="wall"]').click();await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(2);await expect(page.locator('[data-layout-wall-part]')).toHaveCount(2);current=await get();expect(current.vertices).toHaveLength(5);expect(current.wallIds).toEqual(r.wallIds);expect(current.placements).toEqual(r.placements);expect(errors).toEqual([]);
});
