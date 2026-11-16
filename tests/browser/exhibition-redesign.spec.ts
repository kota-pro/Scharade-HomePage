import {addShape} from './layout-tools-helper';
import { fixtureLogin } from "./fixture-auth";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
const headers={Origin:"http://127.0.0.1:4329"};
async function login(page:any,email="member@example.invalid") {expect((await fixtureLogin(page.request, "/api/auth/login", {headers,data:{email,password:"fixture-password-123"}})).ok()).toBe(true);}
test("split metadata, file labels, width warnings and popup status survive a saved draft",async({page},info)=>{
  await login(page);const index=["chromium","firefox","webkit"].indexOf(info.project.name)+1,id=`f1000000-0000-4000-8000-00000000000${index}`;
  await page.goto(`/Exhibition/${id}`);await page.locator("[data-begin]").click();
  await page.locator('[data-common="name"]').fill("作者");await page.locator('[data-common="authorName"]').fill("作者");await page.locator('[data-common="grade"]').selectOption("1年");
  await page.getByLabel("通常展示",{exact:true}).check();await page.getByLabel("単写真枚数").fill("1");await page.getByLabel("単写真枚数").press("Tab");
  await page.locator('[data-work-key="title"]').fill("あ".repeat(14));await expect(page.locator('[data-work-key="title"]')).toHaveAttribute("aria-invalid","false");
  await page.locator('[data-work-key="title"]').fill("春");
  const caption=page.locator('[data-work-key="caption"]'),counter=caption.locator('..').locator('[data-text-counter]');
  await caption.fill("あ".repeat(100));await expect(counter).toContainText('100 / 400文字（10pt）');
  await caption.fill("あ".repeat(101));await expect(counter).toContainText('101 / 400文字（9.7pt）');await expect(caption).not.toHaveAttribute("aria-invalid","true");
  await caption.fill("あ".repeat(155)+'i');await expect(counter).toContainText('156 / 400文字（8pt）');await expect(caption).not.toHaveAttribute("aria-invalid","true");
  await caption.fill("あ".repeat(156));await expect(caption).toHaveAttribute("aria-invalid","false");await expect(caption.locator('..').locator('[data-text-warning]')).toContainText('枠');
  await caption.fill("あ\n".repeat(5));await expect(caption).toHaveAttribute("aria-invalid","false");
  await caption.fill("あ".repeat(100));await expect(counter).toContainText('（10pt）');await expect(caption).not.toHaveAttribute("aria-invalid","true");
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
  if(await page.locator('[data-upload-work]').count()<2)await page.locator('[data-add-series-photo]').click();
  const photos=page.locator('.exhibition-work').last();await photos.locator('[data-photo-index="1"][data-photo-key="y"]').fill('40');await photos.locator('[data-photo-index="1"][data-photo-key="y"]').press('Tab');await page.locator('[data-series-open]').click();
  const editor=page.locator('[data-series-editor]');await editor.locator('[data-series-select-all]').click();await expect(editor.locator('figure.selected')).toHaveCount(2);await page.keyboard.press("Escape");await expect(editor.locator('figure.selected')).toHaveCount(0);
  await editor.locator('[data-series-select-all]').click();const canvas=editor.locator('[data-series-work]');await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!;await page.mouse.click(box.x+box.width-5,box.y+box.height-5);await expect(editor.locator('figure.selected')).toHaveCount(0);
  const initial=Number(await canvas.getAttribute("data-scale"));await canvas.dispatchEvent("wheel",{ctrlKey:true,deltaY:-50,clientX:box.x+box.width/2,clientY:box.y+box.height/2});expect(Number(await canvas.getAttribute("data-scale"))).toBeGreaterThan(initial);
  await editor.locator('[data-series-fit]').click();await editor.locator('[data-series-setting="snap"]').uncheck();
  await canvas.scrollIntoViewIfNeeded();
  const scale=Number(await canvas.getAttribute("data-scale")),first=(await editor.locator('[data-series-photo="0"]').boundingBox())!;
  await page.mouse.move(first.x+10,first.y+10);await page.mouse.down();await page.mouse.move(first.x+10+10*scale,first.y+10+39*scale);await expect(editor.locator('[data-series-guides] line')).not.toHaveCount(0);await page.mouse.up();
  await page.locator('[data-series-dialog-close]').first().click();await expect(photos.locator('[data-photo-index="0"][data-photo-key="y"]')).toHaveValue("40");await page.locator('[data-series-open]').click();
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

test('staff caption counters use the same fitted size and retain a long caption after saving',async({page},info)=>{
  await login(page,'planner@example.invalid');
  const command=async(data:Record<string,unknown>)=>{const r=await page.request.post('/api/member/exhibitions',{headers,data});expect(r.status(),await r.text()).toBe(200);return(await r.json()).exhibition;};
  let e=await command({action:'create',title:`キャプションの編集 ${info.project.name}`});
  const iso=(delta:number)=>new Date(Date.now()+delta).toISOString(),id=e.id;
  e=await command({action:'settings',exhibitionId:id,revision:e.revision,title:e.title,status:'open',gallery:'staff',voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['member']});
  await command({action:'participation.publish',exhibitionId:id,revision:e.revision});
  const current=async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
  await expect.poll(async()=>(await current()).participation.state).toBe('published');
  e=await current();await command({action:'participation.attendance.set',exhibitionId:id,revision:e.revision,userId:'member',vote:'attending'});
  await login(page);
  const begin=await page.request.post(`/api/exhibitions/${id}`,{headers,data:{action:'begin'}});expect(begin.status()).toBe(200);
  const begun=await begin.json(),sectionId=e.schemas[0].sections[0].id;
  const content={...begun.submission.draft,name:'作者',authorName:'作者',grade:'1年',sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[{id:crypto.randomUUID(),sectionId,kind:'book',title:'文字サイズ',caption:'あ'.repeat(101),location:'',equipment:'',settings:'',photos:[],fields:{}}]};
  const submitted=await page.request.post(`/api/exhibitions/${id}`,{headers,data:{action:'submit',revision:begun.submission.revision,content}});expect(submitted.status(),await submitted.text()).toBe(200);
  await login(page,'planner@example.invalid');
  await page.goto(`/Member/manage/exhibitions/${id}/submissions`);
  await page.getByRole("tab",{name:"提出状況",exact:true}).click();await page.locator("[data-submission-row] [data-submission-detail]").first().click();
  const editor=page.locator('[data-staff-editor]').first(),caption=editor.locator('[data-work-key="caption"]').first(),counter=caption.locator('..').locator('[data-text-counter]');
  await editor.getByRole('button',{name:'キャプションを修正',exact:true}).click();
  await caption.fill('あ'.repeat(101));await expect(counter).toContainText('（9.7pt）');
  await caption.fill('あ'.repeat(155)+'i');await expect(counter).toContainText('（8pt）');await expect(caption).not.toHaveAttribute('aria-invalid','true');
  await editor.locator('[data-se-next]').click();await editor.locator('[data-se-save]').click();await editor.getByRole('button',{name:'キャプションを修正',exact:true}).click();await expect(page.locator('.exhibition-status')).toContainText('提出内容の修正を保存しました');
  await expect(caption).toHaveValue('あ'.repeat(155)+'i');await expect(counter).toContainText('（8pt）');
  await page.reload();await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-submission-row] [data-submission-detail]').first().click();await editor.getByRole('button',{name:'キャプションを修正',exact:true}).click();await expect(counter).toContainText('（8pt）');
});

test('owners preview unsaved cards from each exhibition section, return to editing, retry and preview after the deadline',async({page,browser},info)=>{
  test.setTimeout(90000);
  await login(page,'planner@example.invalid');
  const index=['chromium','firefox','webkit'].indexOf(info.project.name)+1,id=`f3000000-0000-4000-8000-00000000000${index}`,endpoint=`/api/exhibitions/${id}`;
  const initial=(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition,schema=initial.schemas.at(-1),specialId=crypto.randomUUID(),normalId=schema.sections[0].id;
  const changed=await page.request.post('/api/member/exhibitions',{headers,data:{action:'schema',exhibitionId:id,revision:initial.revision,schema:{...schema,sections:[...schema.sections,{id:specialId,title:'企画展示・街の光',description:''}]}}});expect(changed.status(),await changed.text()).toBe(200);
  await login(page);await page.goto(`/Exhibition/${id}`);await page.locator('[data-begin]').click();
  await expect(page.locator('[data-preview-boards]')).toBeDisabled();
  await page.locator('[data-common="name"]').fill('作者');await page.locator('[data-common="authorName"]').fill('作者');await page.locator('[data-common="grade"]').selectOption('2年');
  await page.locator(`[data-section-toggle="${normalId}"]`).check();
  await page.locator(`[data-section="${normalId}"] [data-count="singles"]`).fill('1');await page.locator(`[data-section="${normalId}"] [data-count="singles"]`).press('Tab');
  await page.locator(`[data-section-toggle="${specialId}"]`).check();
  await page.locator(`[data-section="${specialId}"] [data-count="books"]`).fill('1');await page.locator(`[data-section="${specialId}"] [data-count="books"]`).press('Tab');
  const normal=page.locator(`[data-section="${normalId}"]`),special=page.locator(`[data-section="${specialId}"]`);
  await normal.locator('[data-work-key="title"]').fill('通常の作品');await normal.locator('[data-work-key="caption"]').fill('あ'.repeat(155)+'i');
  await normal.locator('[data-work-detail="place"]').fill('新宿');await normal.locator('[data-work-detail="prefecture"]').selectOption('東京都');
  await special.locator('[data-work-key="title"]').fill('企画の作品');await special.locator('[data-work-key="caption"]').fill('企画展示の説明です。');
  await expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');const before=await(await page.request.get(endpoint)).json();expect(before.submission.draft.works).toHaveLength(2);
  const button=page.getByRole('button',{name:'タイトルボードをプレビュー',exact:true});await button.click();
  const modal=page.getByRole('dialog',{name:'自分のタイトルボードのプレビュー'}),image=modal.locator('[data-board-preview-image]');
  await expect(modal).toBeVisible();await expect(image).toBeVisible();await expect(image).toHaveJSProperty('naturalWidth',840);
  await expect(modal.locator('[data-board-preview-caption]')).toContainText('通常展示 ／ 通常の作品 ／ キャプション 8pt');
  await expect(modal.locator('[data-board-preview-issues]')).toBeHidden();await expect(modal.locator('[data-board-preview-qr]')).toHaveAttribute('href',/\/Portfolio\/member$/);
  const first=await image.getAttribute('src');await modal.getByRole('button',{name:'次の作品',exact:true}).click();
  await expect(modal.locator('[data-board-preview-caption]')).toContainText('企画展示・街の光 ／ 企画の作品 ／ キャプション 10pt');await expect(image).toBeVisible();expect(await image.getAttribute('src')).not.toBe(first);
  await expect(modal.locator('[data-board-preview-work] optgroup')).toHaveCount(2);
  for(const width of [1440,375]){await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);expect((await modal.boundingBox())!.width).toBeLessThan(width);}
  await modal.evaluate(e=>e.scrollTop=0);await page.screenshot({path:info.outputPath('own-title-board-preview-mobile.png')});
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(button).toBeFocused();await expect(normal.locator('[data-work-key="caption"]')).toHaveValue('あ'.repeat(155)+'i');
  expect((await(await page.request.get(endpoint)).json()).submission).toEqual(before.submission);
  await normal.locator('[data-work-key="caption"]').fill('あ'.repeat(156));await button.click();await expect(image).toBeVisible();await expect(modal.locator('[data-board-preview-issues]')).toContainText('枠');await modal.getByRole('button',{name:'プレビューを閉じる',exact:true}).click();
  await normal.locator('[data-work-key="caption"]').fill('更新後の短い説明');
  await page.route(`**${endpoint}`,async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='boards.preview')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,message:'プレビューを再試行してください'})});return route.continue();});
  await expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');const updated=await(await page.request.get(endpoint)).json();
  await button.click();await expect(modal.locator('[data-board-preview-status]')).toContainText('EXH-016');await expect(modal.getByRole('button',{name:'プレビューを更新',exact:true})).toBeEnabled();
  await page.unroute(`**${endpoint}`);await modal.getByRole('button',{name:'プレビューを更新',exact:true}).click();await expect(image).toBeVisible();await expect(modal.locator('[data-board-preview-caption]')).toContainText('10pt');expect(await image.getAttribute('src')).not.toBe(first);
  await modal.getByRole('button',{name:'フォームに戻る',exact:true}).click();expect((await(await page.request.get(endpoint)).json()).submission).toEqual(updated.submission);
  await page.locator('[data-save]').click();await expect(page.locator('.exhibition-status')).toContainText('下書きを保存しました');
  const saved=await(await page.request.get(endpoint)).json(),staff=await browser.newContext();
  try {
    await fixtureLogin(staff.request,'http://127.0.0.1:4329/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}});
    const e=(await(await staff.request.get(`http://127.0.0.1:4329/api/member/exhibitions/${id}`)).json()).exhibition;
    const closed=await staff.request.post('http://127.0.0.1:4329/api/member/exhibitions',{headers,data:{action:'settings',exhibitionId:id,revision:e.revision,title:e.title,status:'open',gallery:e.gallery,opensAt:e.opensAt,closesAt:new Date(Date.now()-1000).toISOString(),voteOpensAt:e.participation.opensAt,voteClosesAt:e.participation.closesAt}});expect(closed.status(),await closed.text()).toBe(200);
  }finally{await staff.close();}
  await page.reload();await expect(page.locator('[data-common="name"]')).toBeDisabled();await expect(button).toBeEnabled();await button.click();await expect(image).toBeVisible();await page.keyboard.press('Escape');
  expect((await(await page.request.get(endpoint)).json()).submission).toEqual(saved.submission);
});
