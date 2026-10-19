import {addShape} from './layout-tools-helper';
import { fixtureLogin } from "./fixture-auth";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
const headers={Origin:"http://127.0.0.1:4329"};
async function login(page:any,email="member@example.invalid") {expect((await fixtureLogin(page.request, "/api/auth/login", {headers,data:{email,password:"fixture-password-123"}})).ok()).toBe(true);}
test("split metadata, file labels, width warnings and popup status survive a saved draft",async({page},info)=>{
  await login(page);const index=["chromium","firefox","webkit"].indexOf(info.project.name)+1,id=`f1000000-0000-4000-8000-00000000000${index}`;
  await page.goto(`/Exhibition/${id}`);await page.locator("[data-begin]").click();
  await page.locator('[data-common="name"]').fill("作者");await page.locator('[data-common="authorName"]').fill("作者");await page.locator('[data-common="grade"]').fill("1年");
  await page.getByLabel("通常展示",{exact:true}).check();await page.getByLabel("単写真枚数").fill("1");await page.getByLabel("単写真枚数").press("Tab");
  await page.locator('[data-work-key="title"]').fill("あ".repeat(11));await expect(page.locator('[data-work-key="title"]')).toHaveAttribute("aria-invalid","true");
  await page.locator('[data-work-key="title"]').fill("春");await page.locator('[data-work-key="caption"]').fill("あ".repeat(101));await expect(page.locator('[data-work-key="caption"]')).toHaveAttribute("aria-invalid","true");
  await page.locator('[data-work-key="caption"]').fill("あ".repeat(100));await expect(page.locator('[data-work-key="caption"]')).not.toHaveAttribute("aria-invalid","true");
  await page.locator('[data-work-detail="place"]').fill("新宿");await page.locator('[data-work-detail="prefecture"]').selectOption("東京都");
  await page.locator('[data-work-detail="camera"]').fill("Z6");await page.locator('[data-work-detail="lens"]').fill("50mm");await page.locator('[data-work-detail="shutterSpeed"]').fill("1/250秒");await page.locator('[data-work-detail="iso"]').fill("400");await page.locator('[data-work-detail="fNumber"]').fill("2.8");
  const image=await sharp({create:{width:30,height:20,channels:3,background:"white"}}).png().toBuffer();
  await page.locator('[data-upload-index="0"]').setInputFiles({name:"作品.png",mimeType:"image/png",buffer:image});await expect(page.locator('[data-file-info]')).toContainText("作品.png");await expect(page.locator('[data-file-info]')).toContainText("KB");
  await page.locator('[data-save]').click();await expect(page.locator('.site-notice')).toContainText("下書きを保存しました");await page.reload();await expect(page.locator('[data-file-info]')).toContainText("作品.png");
  const value=(await(await page.request.get(`/api/exhibitions/${id}`)).json()).submission.draft.works[0];expect(value.location).toBe("新宿 / 東京都");expect(value.equipment).toBe("Z6 / 50mm");expect(value.settings).toBe("1/250秒, ISO400, F2.8");
  await page.locator('[data-work-detail="prefecture"]').selectOption("海外・その他");await expect(page.locator('[data-work-detail="region"]')).toBeVisible();
  for(const width of [1440,1024,375]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);}

});
test("series background and Escape clear selection; zoom and edge snap use the editor viewport",async({page},info)=>{
  await login(page);const index=["chromium","firefox","webkit"].indexOf(info.project.name)+1,id=`f1000000-0000-4000-8000-00000000000${index}`;
  await page.goto(`/Exhibition/${id}`);if(await page.locator('[data-begin]').count())await page.locator('[data-begin]').click();
  if(!await page.locator('[data-count="series"]').count())await page.getByLabel("通常展示",{exact:true}).check();
  await page.getByLabel("組写真作品数").fill("1");await page.getByLabel("組写真作品数").press("Tab");
  const editor=page.locator('[data-series-editor]');await editor.locator('[data-series-select-all]').click();await expect(editor.locator('figure.selected')).toHaveCount(2);await page.keyboard.press("Escape");await expect(editor.locator('figure.selected')).toHaveCount(0);
  await editor.locator('[data-series-select-all]').click();const canvas=editor.locator('[data-series-work]');await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width-5,box.y+box.height-5);await expect(editor.locator('figure.selected')).toHaveCount(0);
  const initial=Number(await canvas.getAttribute("data-scale"));await canvas.dispatchEvent("wheel",{ctrlKey:true,deltaY:-50,clientX:box.x+box.width/2,clientY:box.y+box.height/2});expect(Number(await canvas.getAttribute("data-scale"))).toBeGreaterThan(initial);
  await editor.locator('[data-series-fit]').click();await editor.locator('[data-series-setting="snap"]').uncheck();
  const photos=page.locator('.exhibition-work').last();await photos.locator('[data-photo-index="1"][data-photo-key="y"]').fill("40");await photos.locator('[data-photo-index="1"][data-photo-key="y"]').press("Tab");
  await canvas.scrollIntoViewIfNeeded();
  const scale=Number(await canvas.getAttribute("data-scale")),first=(await editor.locator('[data-series-photo="0"]').boundingBox())!;
  await page.mouse.move(first.x+10,first.y+10);await page.mouse.down();await page.mouse.move(first.x+10+10*scale,first.y+10+39*scale);await expect(editor.locator('[data-series-guides] line')).not.toHaveCount(0);await page.mouse.up();
  await expect(photos.locator('[data-photo-index="0"][data-photo-key="y"]')).toHaveValue("40");
  if(info.project.name==="chromium"){
    await editor.locator('[data-series-fit]').click();await canvas.scrollIntoViewIfNeeded();const r=(await canvas.boundingBox())!,initialScale=Number(await canvas.getAttribute('data-scale')),cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    const points=(distance:number)=>[{id:1,x:r.x+r.width/2-distance,y:r.y+180},{id:2,x:r.x+r.width/2+distance,y:r.y+180}];
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(35)});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(80)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await expect.poll(async()=>Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(initialScale*1.5);await cdp.detach();
  }

});

test("integrated canvas stays fixed across tabs and connected boards preserve both faces and seam validation",async({page},info)=>{
 const index=["chromium","firefox","webkit"].indexOf(info.project.name)+1,id=`f2000000-0000-4000-8000-00000000000${index}`;await login(page,"planner@example.invalid");await page.setViewportSize({width:1440,height:1000});let data=await(await page.request.get(`/api/member/exhibitions/${id}`)).json();const r=data.exhibition.rooms[0];r.placements=[];r.boardPlacements=[];r.titleBoards=[];r.editor=undefined;expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'rooms',exhibitionId:id,revision:data.exhibition.revision,rooms:[r]}})).ok()).toBe(true);
 await page.goto(`/Member/manage/exhibitions/${id}/layout`);await page.locator('[data-open-room-editor="floor"]').click();const canvas=page.locator('[data-layout-canvas]'),initial=(await canvas.boundingBox())!;for(const tab of ['align','layers','works','properties']){await page.locator(`[data-layout-tab="${tab}"]`).click();expect(await canvas.boundingBox()).toEqual(initial);}
 const add=async()=>{await addShape(page,'board');};await add();await page.locator('[data-layout-panel-add]').click();await page.locator('[data-layout-panel="1"][data-layout-panel-key="hingeAngle"]').fill('90');await page.locator('[data-layout-panel="1"][data-layout-panel-key="hingeAngle"]').press('Tab');await add();await page.locator('[data-layout-join]').click();await expect(page.locator('[data-layout-kind="board"] polygon')).toHaveCount(3);
 const choice=page.locator('[data-layout-view]'),faces=await choice.locator('option').evaluateAll(es=>(es as HTMLOptionElement[]).filter(e=>e.value.startsWith('board:')).map(e=>e.value));expect(faces).toHaveLength(2);await choice.selectOption(faces[0]);await page.locator('[data-layout-snap]').uncheck();await page.locator('[data-layout-smart]').uncheck();
 const click=async(x:number,y:number)=>{const p=await canvas.evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform((el as SVGSVGElement).getScreenCTM()!);return{x:q.x,y:q.y};},{x,y});await page.mouse.click(p.x,p.y);};
 const put=async(workId:string,x:number)=>{await page.locator('[data-layout-tab="works"]').click();await page.locator(`[data-layout-work-add="${workId}"]`).click();await click(x,500);await click(x+400,1100);};const ws=data.submissions[0].content.works;await put(ws[0].id,100);await put(ws[1].id,1100);await page.locator('[data-layout-tab="properties"]').click();const previousLeft=await page.locator('[data-layout-property="left"]').inputValue();await page.locator('[data-layout-property="left"]').fill('800');await page.locator('[data-layout-property="left"]').press('Tab');await expect(page.locator('.site-notice').last()).toContainText('継ぎ目');await expect(page.locator('[data-layout-property="left"]')).toHaveValue(previousLeft);await page.locator('[data-layout-property="left"]').fill('1100');await page.locator('[data-layout-property="left"]').press('Tab');await choice.selectOption(faces[1]);await put(ws[2].id,100);await page.locator('[data-layout-save]').click();await expect(page.locator('.site-notice').last()).toContainText('展示室レイアウトを保存');await page.reload();await page.locator('[data-open-room-editor="wall"]').click();await page.locator('[data-layout-view]').selectOption(faces[0]);await expect(page.locator('[data-layout-kind="work"]')).toHaveCount(2);await expect(page.locator('[data-layout-kind="titleboard"]')).toHaveCount(2);
 const final=await(await page.request.get(`/api/member/exhibitions/${id}`)).json();expect(final.exhibition.rooms[0].boardPlacements).toHaveLength(3);expect(final.exhibition.rooms[0].titleBoards).toHaveLength(3);
});

test("participant list covers all notified members and overview has no form preview",async({page},info)=>{
  await login(page,"planner@example.invalid");const index=["chromium","firefox","webkit"].indexOf(info.project.name)+1,id=`f2000000-0000-4000-8000-00000000000${index}`;
  await page.goto(`/Member/manage/exhibitions/${id}`);await expect(page.locator('.exhibition-save-preview')).toHaveCount(0);await page.locator('.exhibition-admin-nav').getByRole('link',{name:'参加者一覧',exact:true}).click();await expect(page.locator('[data-participant-row]')).toHaveCount(2);await expect(page.locator('[data-participant-count]')).toHaveText('2 / 2人を表示');
  await page.locator('[data-participant-filter="vote"]').selectOption('absent');await expect(page.locator('[data-participant-row]:visible')).toHaveCount(1);await page.locator('[data-participant-filter="query"]').fill('存在しない名前');await expect(page.locator('[data-participant-row]:visible')).toHaveCount(0);await page.locator('[data-participant-filter="query"]').fill('別の会員');await expect(page.locator('[data-participant-row]:visible')).toHaveCount(1);
  await page.locator('[data-attendance-user="other"]').selectOption('attending');await page.locator('[data-save-attendance="other"]').click();await expect(page.locator('.site-notice').last()).toContainText('参加状況を保存');await page.locator('[data-participant-filter="query"]').fill('');await page.locator('[data-participant-filter="vote"]').selectOption('attending');await expect(page.locator('[data-participant-row]:visible')).toHaveCount(2);
  await page.locator('[data-participant-filter="submission"]').selectOption('submitted');await expect(page.locator('[data-participant-row]:visible')).toHaveCount(1);await login(page);expect((await page.request.get(`/Member/manage/exhibitions/${id}/participants`,{maxRedirects:0})).status()).toBe(403);
});
