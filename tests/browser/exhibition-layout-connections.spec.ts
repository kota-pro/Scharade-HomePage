import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
import {addShape,clickLayout,openPropertySection} from './layout-tools-helper';
const headers={Origin:'http://127.0.0.1:4329'};
async function open(page:Page,title:string){
  page.setDefaultTimeout(10000);
  expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
  const response=await page.request.post('/api/member/exhibitions',{headers,data:{action:'create',title}});expect(response.ok()).toBe(true);const id=(await response.json()).exhibition.id;
  await page.setViewportSize({width:1440,height:1000});await page.goto(`/Member/manage/exhibitions/${id}/layout`);await page.locator('[data-open-room-editor="floor"]').click();await page.locator('[data-room-add]').click();await page.locator('[data-layout-snap]').uncheck();
  return{id,get:async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition.rooms,save:async()=>{await page.locator('[data-layout-save]').click();await expect(page.locator('.site-notice').last()).toContainText('保存しました');}};
}
const anchor=(page:Page,index:number)=>page.locator(`[data-vector-node="${index}"][data-vector-target="room"],[data-vector-room-connect="${index}"]`).first();
async function shortcut(page:Page,key:string){await page.locator('[data-layout-canvas]').focus();await page.keyboard.press(`ControlOrMeta+${key}`);}
test('walls and figures can be renamed; venue figures copy on floor and walls with independent IDs and survive reload',async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const f=await open(page,`名称・複製 ${info.project.name}`);
  await openPropertySection(page,'壁の名前');await page.locator('[data-layout-wall-name]').fill('入口 <東>');await page.locator('[data-layout-wall-name]').press('Tab');await expect(page.locator('[data-layout-view] option[value="wall:0"]')).toHaveText('入口 <東>');
  await addShape(page,'rect',1500,1200);await openPropertySection(page,'名前');await page.locator('[data-layout-string="name"]').fill('受付の枠');await page.locator('[data-layout-string="name"]').press('Tab');await shortcut(page,'c');await shortcut(page,'v');await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(2);
  await addShape(page,'board',3200,2200);await shortcut(page,'d');await expect(page.locator('[data-layout-kind="board"]')).toHaveCount(2);
  await page.locator('[data-layout-view]').selectOption('wall:0');await addShape(page,'ellipse',1400,800);await shortcut(page,'c');await shortcut(page,'v');await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(2);
  await f.save();const rooms=await f.get(),r=rooms[0];expect(Object.values(r.wallNames)).toContain('入口 <東>');expect(r.annotations.filter((a:any)=>a.name==='受付の枠')).toHaveLength(2);expect(r.annotations.filter((a:any)=>a.surface==='wall:0')).toHaveLength(2);expect(new Set(r.annotations.map((a:any)=>a.id)).size).toBe(4);expect(r.boardGroups).toHaveLength(2);expect(r.placements).toHaveLength(0);
  await page.keyboard.press('Escape');await page.reload();await page.locator('[data-open-room-editor="floor"]').click();await expect(page.locator('[data-layout-view] option[value="wall:0"]')).toHaveText('入口 <東>');
  await page.locator('[data-layout-fit]').click();await clickLayout(page,3000,0);await shortcut(page,'d');await f.save();const cloned=await f.get();expect(cloned).toHaveLength(2);expect(cloned[1].id).not.toBe(cloned[0].id);expect(cloned[1].placements).toHaveLength(0);expect(cloned[1].annotations).toHaveLength(4);expect(errors).toEqual([]);
});
test('pen connects wall vertices and drawn paths into one exterior; incomplete or intersecting paths cannot replace it',async({page},info)=>{
  test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const f=await open(page,`壁の接続 ${info.project.name}`);await f.save();const before=(await f.get())[0];
  await page.locator('[data-layout-tool="draw"]').click();await anchor(page,0).click();await clickLayout(page,1000,700);await page.keyboard.press('Enter');await expect(page.locator('.site-notice').last()).toContainText('別の壁の頂点');expect((await f.get())[0].vertices).toEqual(before.vertices);await page.keyboard.press('Escape');
  await anchor(page,0).click();await clickLayout(page,4000,3000);await clickLayout(page,1000,3000);await clickLayout(page,4000,1000);await anchor(page,1).click();await expect(page.locator('.site-notice').last()).toContainText('外周');await page.keyboard.press('Escape');
  await clickLayout(page,1000,600);await clickLayout(page,5000,600);await page.keyboard.press('Enter');await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(1);const path=await page.locator('[data-layout-kind="annotation"]').getAttribute('data-layout-object');await f.save();const drawn=(await f.get())[0].annotations[0],drawnPoint={x:drawn.x+drawn.path.nodes[0].x,y:drawn.y+drawn.path.nodes[0].y};
  await page.locator(`[data-vector-node="0"][data-vector-target="${path}"]`).click();await anchor(page,0).click();await anchor(page,1).click();await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(0);await expect(page.locator('[data-vector-node][data-vector-target="room"]')).toHaveCount(6);
  await f.save();const connected=(await f.get())[0];expect(connected.vertices).toHaveLength(6);expect(connected.vertices.some((p:any)=>Math.abs(p.x-drawnPoint.x)<.01&&Math.abs(p.y-drawnPoint.y)<.01)).toBe(true);await page.locator('[data-layout-undo]').click();await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(1);await page.locator('[data-layout-redo]').click();await expect(page.locator('[data-layout-kind="annotation"]')).toHaveCount(0);await f.save();
  await anchor(page,0).click();await clickLayout(page,3000,2000);await anchor(page,4).click();await expect(page.locator('[data-wall-connection-choice]')).toBeVisible();await page.locator('[data-wall-connection-choice]').selectOption('0');await page.locator('[data-wall-connection-apply]').click();await expect(page.locator('[data-wall-connection-choice]')).toHaveCount(0);await f.save();expect((await f.get())[0].vertices).toHaveLength(4);expect(errors).toEqual([]);
});
