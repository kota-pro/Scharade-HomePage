import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fixtureLogin } from "./fixture-auth";
const headers={Origin:"http://127.0.0.1:4329"};
const gear=["ニコンフルサイズミラーレス一眼カメラ","標準ズームレンズ二十四から七十ミリ用","コダックポートラ四百カラーネガを使用"];
const login=async(page:Page,email="planner@example.invalid")=>expect((await fixtureLogin(page.request,"/api/auth/login",{headers,data:{email,password:"fixture-password-123"}})).ok()).toBe(true);
async function storedSubmission(id:string) {
  const {directory}=JSON.parse(await fs.readFile('.data/browser-fixture-path.json','utf8'));
  expect(directory.startsWith(path.join(os.tmpdir(),'scharade-browser-'))).toBe(true);
  return JSON.parse(await fs.readFile(path.join(directory,'exhibitions.json'),'utf8')).submissions.find((s:any)=>s.id===id);
}
async function fixture(page:Page,title:string) {
  await login(page);
  const command=async(data:Record<string,unknown>)=>{const r=await page.request.post('/api/member/exhibitions',{headers,data});expect(r.status(),await r.text()).toBe(200);return(await r.json()).exhibition;};
  let e=await command({action:'create',title}),iso=(n:number)=>new Date(Date.now()+n).toISOString();
  e=await command({action:'settings',exhibitionId:e.id,revision:e.revision,title,status:'open',gallery:'staff',opensAt:iso(-60000),closesAt:iso(3600000),voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),recipientIds:['member']});
  await command({action:'participation.publish',exhibitionId:e.id,revision:e.revision});
  const current=async()=>(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;
  await expect.poll(async()=>(await current()).participation.state).toBe('published');e=await current();
  await command({action:'participation.attendance.set',exhibitionId:e.id,revision:e.revision,userId:'member',vote:'attending'});
  await login(page,'member@example.invalid');
  const endpoint=`/api/exhibitions/${e.id}`,r=await page.request.post(endpoint,{headers,data:{action:'begin'}});expect(r.status()).toBe(200);
  const s=(await r.json()).submission,sectionId=e.schemas[0].sections[0].id;
  const content={...s.draft,name:'作者',authorName:'作者',grade:'2年',sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[{id:crypto.randomUUID(),sectionId,kind:'book',title:'光',caption:'',location:'',equipment:'',settings:'',details:{place:'',prefecture:'',region:'',camera:'',lens:'',film:'',shutterSpeed:'',iso:'',fNumber:''},fields:{},photos:[]}]};
  return{e,endpoint,s,content};
}
test('metadata form shares empty rows, warns without losing drafts, and previews the 54-character limit on desktop and mobile',async({page},info)=>{
  test.setTimeout(90000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const {e,endpoint,s,content}=await fixture(page,`撮影情報の改行 ${info.project.name}`);
  expect((await page.request.post(endpoint,{headers,data:{action:'save',revision:s.revision,content}})).status()).toBe(200);
  await page.goto(`/Exhibition/${e.id}`);
  const camera=page.locator('textarea[data-work-detail="camera"]'),lens=page.locator('[data-work-detail="lens"]'),place=page.locator('[data-work-detail="place"]'),iso=page.locator('[data-work-detail="iso"]'),counter=page.locator('[data-metadata-lines]');
  await expect(camera).toBeVisible();await expect(counter).toContainText('0 / 3行（8pt）');
  // An Enter by itself at a component boundary must be considered dirty and saved.
  await camera.fill('Camera');await expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');
  await camera.press('End');await camera.press('Enter');
  await expect.poll(async()=>(await(await page.request.get(endpoint)).json()).submission.draft.works[0].details.camera).toBe('Camera\n');
  await page.reload();await expect(camera).toHaveValue('Camera\n');
  await lens.fill('Lens');await expect(counter).toContainText('2 / 3行（8pt）');
  await expect.poll(async()=>(await(await page.request.get(endpoint)).json()).submission.draft.works[0].equipment).toBe('Camera /\nLens');
  await lens.fill('');await camera.fill(gear.slice(0,2).join('\n'));await iso.fill('400');await expect(counter).toContainText('3 / 3行（8pt）');
  await place.fill('新宿');await expect(counter).toContainText('4 / 3行（8pt）');await expect(camera).toHaveAttribute('aria-invalid','false');
  await expect(camera.locator('..').locator('[data-text-warning]')).toContainText('合計3行');
  await expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');
  const overflow=(await(await page.request.get(endpoint)).json()).submission;
  expect((await page.request.post(endpoint,{headers,data:{action:'submit',revision:overflow.revision,content:overflow.draft}})).status()).toBe(200);
  await page.reload();await expect(camera).toHaveValue(gear.slice(0,2).join('\n'));await expect(counter).toContainText('4 / 3行');
  await place.fill('');await iso.fill('');await camera.fill(gear.join(''));await expect(counter).toContainText('3 / 3行（8pt）');await expect(camera).not.toHaveAttribute('aria-invalid','true');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:900});await camera.focus();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await expect.poll(()=>camera.evaluate(el=>el.scrollHeight<=el.clientHeight+2)).toBe(true);
    await page.screenshot({path:info.outputPath(`metadata-form-${width}.png`)});
    await page.locator('[data-preview-boards]').click();
    const modal=page.getByRole('dialog',{name:'自分のタイトルボードのプレビュー'}),image=modal.locator('[data-board-preview-image]');
    await expect(image).toBeVisible();await expect(image).toHaveJSProperty('naturalWidth',840);await expect(modal.locator('[data-board-preview-issues]')).toBeHidden();
    const src=await image.getAttribute('src');expect(src).toMatch(/^data:image\/png;base64,/);await fs.writeFile(info.outputPath('metadata-titleboard.png'),Buffer.from(src!.split(',')[1],'base64'));
    await page.screenshot({path:info.outputPath(`metadata-preview-${width}.png`)});
    await modal.getByRole('button',{name:'フォームに戻る',exact:true}).click();
  }
  await page.locator('[data-submit]').click();await expect(page.locator('.exhibition-status')).toContainText('提出しました');
  const submitted=await storedSubmission(s.id);expect(submitted.versions.at(-1).content.works[0].equipment).toBe(gear.join(''));expect(errors).toEqual([]);
});
test('staff metadata editing supports split and legacy multiline fields, uses the shared row counter, and preserves old versions',async({page},info)=>{
  test.setTimeout(90000);
  const {e,endpoint,s,content}=await fixture(page,`運営の撮影情報 ${info.project.name}`);
  content.works[0].details.camera='Camera';
  expect((await page.request.post(endpoint,{headers,data:{action:'submit',revision:s.revision,content}})).status()).toBe(200);
  const initial=(await storedSubmission(s.id)).versions[0].content;
  await login(page);await page.goto(`/Member/manage/exhibitions/${e.id}/submissions`);await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-submission-row] [data-submission-detail]').first().click();
  const editor=page.locator('[data-staff-editor]').first(),counter=editor.locator('[data-metadata-lines]');
  await editor.getByRole('button',{name:'使用機材を修正',exact:true}).click();const camera=editor.locator('textarea[data-work-detail="camera"]');await expect(camera).toBeVisible();
  // A boundary-only change has no rendered text difference until a lens is added.
  await camera.fill('Camera\n');await expect(editor.locator('[data-se-next]')).toBeEnabled();
  await editor.locator('[data-work-detail="lens"]').fill('Lens');await expect(counter).toContainText('2 / 3行（8pt）');
  await editor.locator('[data-se-next]').click();await expect(editor.locator('[data-se-save]')).toBeVisible();await expect(editor).toContainText('Camera /\nLens');await editor.locator('[data-se-save]').click();
  await expect(page.locator('.exhibition-status')).toContainText('提出内容の修正を保存しました');
  await editor.getByRole('button',{name:'使用機材を修正',exact:true}).click();await expect(camera).toHaveValue('Camera\n');await expect(counter).toContainText('2 / 3行');
  const data=(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()),submission=data.submissions[0];expect((await storedSubmission(s.id)).versions[0].content).toEqual(initial);expect(submission.content.works[0].equipment).toBe('Camera /\nLens');
  // Convert the fixture to an older unsplit answer through the real staff API.
  const legacy=structuredClone(submission.content);delete legacy.works[0].details;legacy.works[0].equipment=gear.slice(0,2).join('\n');
  expect((await page.request.post('/api/member/exhibitions',{headers,data:{action:'submission.edit',exhibitionId:e.id,revision:data.exhibition.revision,submissionId:submission.id,submissionRevision:submission.revision,content:legacy}})).status()).toBe(200);
  await page.reload();await page.getByRole('tab',{name:'提出状況',exact:true}).click();await page.locator('[data-submission-row] [data-submission-detail]').first().click();await editor.getByRole('button',{name:'使用機材を修正',exact:true}).click();
  await expect(editor.locator('textarea[data-work-key="equipment"]')).toHaveValue(gear.slice(0,2).join('\n'));await expect(counter).toContainText('2 / 3行');
  await page.setViewportSize({width:390,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('metadata-staff-mobile.png')});
});
