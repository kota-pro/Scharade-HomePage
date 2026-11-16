import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'},out='/private/tmp/member-calendar-boards-20261014';
async function login(page:Page,email='member@example.invalid'){expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);}
async function slide(page:Page,direction:'left'|'right'){
 const calendar=page.locator('[data-calendar-swipe]');await calendar.scrollIntoViewIfNeeded();const b=(await calendar.boundingBox())!,y=(Math.max(130,b.y)+Math.min(page.viewportSize()!.height-60,b.y+b.height))/2,from=direction==='left'?.8:.2,to=1-from;
 await page.mouse.move(b.x+b.width*from,y);await page.mouse.down();await page.mouse.move(b.x+b.width*to,y,{steps:8});await page.mouse.up();
}
test('calendar side controls, mouse slides, trackpad and keyboard change one month across years without blocking vertical scroll',async({page},info)=>{
 await login(page);await page.setViewportSize({width:1440,height:1000});await page.goto('/Member?view=calendar&month=2027-12&notices=2');
 const prev=page.getByRole('link',{name:'前月を表示'}),next=page.getByRole('link',{name:'翌月を表示'}),calendar=page.locator('[data-calendar-swipe]');
 await next.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);await next.click();await expect(page).toHaveURL(/month=2028-01/);await expect(page).toHaveURL(/notices=2/);await expect(page.locator('.activity-calendar-month')).toHaveText('2028年1月');await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(before,0);
 await prev.click();await expect(page).toHaveURL(/month=2027-12/);await slide(page,'left');await expect(page).toHaveURL(/month=2028-01/);await slide(page,'right');await expect(page).toHaveURL(/month=2027-12/);
 await calendar.hover();await page.mouse.wheel(0,100);expect(page.url()).toContain('month=2027-12');await page.mouse.wheel(80,0);await expect(page).toHaveURL(/month=2028-01/);
 await calendar.focus();await page.keyboard.press('ArrowLeft');await expect(page).toHaveURL(/month=2027-12/);
 for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await expect(prev).toBeVisible();await expect(next).toBeVisible();const boxes=await page.locator('[data-calendar-previous],[data-calendar-swipe],[data-calendar-next]').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left);expect(boxes[1].right).toBeLessThanOrEqual(boxes[2].left);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);await page.locator('[data-calendar-navigation]').screenshot({path:`${out}/calendar-${info.project.name}-${width}.png`});}
 await slide(page,'left');await expect(page).toHaveURL(/month=2028-01/);
});
test('native phone gestures retain vertical scroll, tap links and swipe between months',async({browser},info)=>{
 test.skip(info.project.name!=='chromium','Native touch injection uses Chromium CDP');
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
 try{await login(page);await page.goto('/Member?view=calendar&month=2027-10');const calendar=page.locator('[data-calendar-swipe]');await calendar.scrollIntoViewIfNeeded();const cdp=await context.newCDPSession(page),b=(await calendar.boundingBox())!,y=(Math.max(100,b.y)+Math.min(780,b.y+b.height))/2;
 const touch=async(type:'touchStart'|'touchMove'|'touchEnd',x:number,y:number)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
 await touch('touchStart',b.x+b.width*.5,y);await touch('touchMove',b.x+b.width*.5,y-80);await touch('touchEnd',0,0);expect(page.url()).toContain('month=2027-10');
 await calendar.scrollIntoViewIfNeeded();const r=(await calendar.boundingBox())!,sy=(Math.max(100,r.y)+Math.min(780,r.y+r.height))/2;await touch('touchStart',r.x+r.width*.8,sy);for(let i=1;i<=8;i++)await touch('touchMove',r.x+r.width*(.8-.6*i/8),sy);await touch('touchEnd',0,0);await expect(page).toHaveURL(/month=2027-11/);
 await page.goto('/Member?view=calendar&month=2027-10');const link=page.locator('.activity-calendar-bar').first(),href=new URL((await link.getAttribute('href'))!,page.url()).href;await link.tap();await expect(page).toHaveURL(href);
 }finally{await context.close();}
});
test('legacy touching boards display once, edit every A/B panel, keep placements and survive reload',async({page},info)=>{
 await login(page,'planner@example.invalid');await page.setViewportSize({width:1440,height:1000});const fixtureId=`f2000000-0000-4000-8000-00000000000${['chromium','firefox','webkit'].indexOf(info.project.name)+1}`,id=crypto.randomUUID();
 const data=await(await page.request.get(`/api/member/exhibitions/${fixtureId}`)).json(),r=structuredClone(data.exhibition.rooms[0]),work=data.submissions[0].content.works[0];
 for(const key of ["placements","openings","tables","books","annotations","titleBoards","dimensions","fixedGaps","labelPositions"])r[key]=[];
 r.boardGroups=[0,1,2].map(i=>({id:crypto.randomUUID(),name:`展示ボード${i+1}`,x:1000+i*900,y:1800,rotation:0,panels:[{id:crypto.randomUUID(),name:`パネル${i+1}`,width:900,height:1800,thickness:30,hingeAngle:0}]}));
 r.boardPlacements=[{workId:work.id,groupId:r.boardGroups[2].id,face:'A',x:100,bottom:800,rotation:0}];r.placements=[];r.editor={order:[],hidden:[],locked:[],groups:[]};
 // Seed a legacy saved room directly in the isolated fixture; the retired bulk-save API must stay disabled.
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));expect(directory.startsWith(path.join(os.tmpdir(),'scharade-browser-'))).toBe(true);
 const file=path.join(directory,'exhibitions.json'),store=JSON.parse(fs.readFileSync(file,'utf8')),saved=structuredClone(store.exhibitions.find((e:any)=>e.id===fixtureId));saved.id=id;saved.rooms=[r];saved.revision=1;store.exhibitions.push(saved);store.submissions.push(...store.submissions.filter((submission:any)=>submission.exhibitionId===fixtureId).map((submission:any)=>({...structuredClone(submission),id:crypto.randomUUID(),exhibitionId:id})));fs.writeFileSync(file,JSON.stringify(store));
 const state=async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition.rooms[0];
 await page.goto(`/Member/manage/exhibitions/${id}/layout`);await expect(page.locator('.room-summary-preview [data-preview-label-id^="board:"]')).toHaveCount(1);for(const face of ['A','B'])await expect(page.locator(`.room-summary-preview [data-preview-board-floor-face="${face}"]`)).toHaveCount(1);expect((await state()).boardGroups).toHaveLength(3);
 await page.locator('[data-open-room-editor="floor"]').click();await expect(page.locator('[data-layout-sync-status]')).toHaveText('保存済み');await page.locator('[data-layout-view]').selectOption(`board:${r.boardGroups[0].id}:A`);await expect.poll(async()=>(await state()).boardGroups.length).toBe(1);await page.locator('[data-layout-view]').selectOption('floor');await expect(page.locator('[data-layout-kind="board"]')).toHaveCount(1);for(const face of ['A','B'])await expect(page.locator(`[data-board-floor-face="${face}"]`)).toHaveCount(1);await page.locator('.room-edit-dialog').screenshot({path:info.outputPath('connected-floor-faces.png')});await expect(page.locator('[data-label-id^="board:"]')).toHaveCount(1);
 const merged=await state();expect(merged.boardGroups[0].panels.map((p:any)=>p.id)).toEqual(r.boardGroups.map((g:any)=>g.panels[0].id));expect(merged.boardPlacements[0].x).toBe(1900);
 for(const face of ['A','B']){await page.locator('[data-layout-view]').selectOption(`board:${merged.boardGroups[0].id}:${face}`);await expect(page.locator(`[data-board-face="${face}"]`)).toHaveCount(3);for(const width of [1440,375]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.locator('[data-board-face]').evaluateAll(es=>{const c=document.querySelector('[data-layout-canvas]')!.getBoundingClientRect();return es.every(e=>{const b=e.getBoundingClientRect();return b.left>=c.left+48&&b.right<=c.right&&b.top>=c.top+24&&b.bottom<=c.bottom;});})).toBe(true);await page.locator('.room-edit-dialog').screenshot({path:`${out}/board-${info.project.name}-${face}-${width}.png`});}}
 // Canonicalization preserves one connected group; undo/redo of user edits is covered in private-mobile.spec.ts.
 await page.setViewportSize({width:1440,height:1000});await page.locator('[data-layout-view]').selectOption('floor');await expect(page.locator('[data-label-id^="board:"]')).toHaveCount(1);for(const face of ['A','B'])await expect(page.locator(`[data-board-floor-face="${face}"]`)).toHaveCount(1);
 await page.locator('[data-room-modal-close]').click();await expect(page.locator('.room-edit-dialog')).not.toBeVisible();await page.reload();await page.locator('[data-open-room-editor="wall"]').click();await page.locator('[data-layout-view]').selectOption(`board:${merged.boardGroups[0].id}:A`);await expect(page.locator('[data-board-face="A"]')).toHaveCount(3);await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(1);
});
