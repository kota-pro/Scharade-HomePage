import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {fixtureLogin} from './fixture-auth';
import {withStoreLock,readData,writeData} from '../../src/lib/store.ts';
import {parseRooms} from '../../src/lib/exhibitionValidation.ts';
import {ensureRoomPath} from '../../src/lib/exhibitionRoomPath.ts';
import {addWorkTitleBoardPair,titleBoardPlacementProblems} from '../../src/lib/exhibitionLayoutModel.ts';
import {roomProblems} from '../../src/lib/exhibitionGeometry.ts';
const headers={Origin:'http://127.0.0.1:4329'};
async function fixture(page:Page,title:string){
 expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
 const e=(await(await page.request.post('/api/member/exhibitions',{headers,data:{action:'create',title}})).json()).exhibition,sectionId=e.schemas[0].sections[0].id;
 const works=['前兆','風の通り道','別室に配置した作品','未配置の作品'].map(title=>({id:crypto.randomUUID(),sectionId,kind:'single' as const,title,caption:'',location:'',equipment:'',settings:'',fields:{},photos:[{assetId:'',x:0,y:0,width:700,height:300,rotation:0}]}));
 const first=parseRooms([{id:crypto.randomUUID(),name:'第一展示室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[{id:crypto.randomUUID(),wall:0,kind:'door',offset:1600,width:1000,height:2100,bottom:0}],placements:[],tables:[],books:[]}])[0];ensureRoomPath(first);
 works.slice(0,2).forEach((w,i)=>addWorkTitleBoardPair(first,w,'wall:0',{x:200+i*3500,y:1500},{x:600+i*3500,y:2000}));
 const second=structuredClone(first);second.id=crypto.randomUUID();second.name='第二展示室';second.openings=[];second.placements=[{workId:works[2].id,wall:2,x:1000,bottom:1200,rotation:0}];second.titleBoards=[];delete second.editor;
 const content={name:'配置確認会員',authorName:'配置確認作者',grade:'2年',portfolioUrl:'',fields:{},sections:[{sectionId,singles:4,series:0,books:0,fields:{}}],works};
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));if(!directory.startsWith(path.join(os.tmpdir(),'scharade-browser-')))throw new Error('Synthetic fixture required');
 const previous=process.env.DATA_DIR;process.env.DATA_DIR=directory;
 try{await withStoreLock('exhibitions',()=>{const data=readData<any>('exhibitions.json',{});data.exhibitions.find((v:any)=>v.id===e.id).rooms=[first,second];data.submissions.push({id:crypto.randomUUID(),exhibitionId:e.id,userId:'member',revision:1,schemaVersion:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),draft:content,versions:[{version:1,schemaVersion:1,at:new Date().toISOString(),content,delivery:'delivered'}]});writeData('exhibitions.json',data);});}finally{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;}
 await page.route(/\/output\?kind=board-preview/,route=>route.fulfill(route.request().url().includes('status=1')?{json:{issues:[]}}:{contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKioAAAAASUVORK5CYII=','base64')}));
 const get=async()=>(await(await page.request.get(`/api/member/exhibitions/${e.id}/layout`)).json());
 return {id:e.id,works,first,second,get};
}

test('equalize avoids the door with linked cards; wall ends, owners and cross-room placement search remain available',async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width:1440,height:1000});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await fixture(page,`扉を避ける配置 ${info.project.name}`);await page.goto(`/Member/manage/exhibitions/${f.id}/layout`);await page.locator('[data-open-room-editor="wall"]').click();
 await page.locator('[data-layout-tab="align"]').click();await page.locator('[data-layout-equalize-surface]').click();
 await expect.poll(async()=>(await f.get()).rooms[0].placements[0].x).toBe(450);
 const saved=(await f.get()).rooms[0];expect(saved.placements[1].x).toBe(3950);expect(roomProblems(saved,f.works)).toEqual([]);expect(titleBoardPlacementProblems(saved,f.works)).toEqual([]);
 saved.titleBoards.forEach((c:any,i:number)=>expect(c.x-saved.placements[i].x).toBe(f.first.titleBoards![i].x-f.first.placements[i].x));
 await expect(page.locator('[data-layout-measurement^="edge:surface:left:"]')).toHaveCount(1);await expect(page.locator('[data-layout-measurement^="edge:surface:right:"]')).toHaveCount(1);
 await expect(page.locator('[data-layout-measurement^="edge:surface:left:"]')).toContainText('左端まで 450.0 mm');await expect(page.locator('[data-layout-measurement^="edge:surface:right:"]')).toContainText('右端まで 1350.0 mm');
 const point=await page.locator('[data-layout-canvas]').evaluate(el=>{const p=new DOMPoint(800,1600).matrixTransform((el as SVGSVGElement).getScreenCTM()!);return{x:p.x,y:p.y};});await page.mouse.move(point.x,point.y);await expect(page.locator('[data-layout-dimension-tooltip]')).toContainText('作者：配置確認作者');await expect(page.locator('[data-layout-dimension-tooltip]')).toContainText('提出者：配置確認会員');
 await page.locator('[data-layout-tab="works"]').click();await page.locator('[data-layout-work-search]').fill('別室に配置');
 const located=page.locator(`[data-layout-work-locate="${f.works[2].id}"]`);await expect(located).toContainText('第二展示室 / 壁3');const before=(await f.get()).rooms;
 await located.click();await expect(page.locator('[data-layout-view]')).toHaveValue('wall:2');await expect(page.locator(`[data-layout-object="work:${f.works[2].id}"]`)).toBeVisible();await expect(located).toHaveAttribute('aria-pressed','true');
 await page.screenshot({path:info.outputPath('placed-work-location.png')});
 expect((await f.get()).rooms).toEqual(before);
 await page.locator('[data-layout-work-search]').fill('');await page.locator('[data-layout-work-filter]').selectOption('unplaced');await expect(page.locator('[data-layout-work-add]')).toHaveCount(1);await expect(page.locator('[data-layout-work-locate]')).toHaveCount(0);
 await page.locator('[data-layout-work-filter]').selectOption('placed');await expect(page.locator('[data-layout-work-locate]')).toHaveCount(3);expect(errors).toEqual([]);
});

test('submission status searches work titles together with submission-stage filters on desktop and mobile',async({page},info)=>{
 const f=await fixture(page,`提出の作品名検索 ${info.project.name}`);
 await page.goto(`/Member/manage/exhibitions/${f.id}/submissions`);await page.locator('[data-submission-tab="status"]').click();
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.locator('[data-submission-search]').fill('風の通り道');await expect(page.locator('[data-submission-row]:visible')).toHaveCount(1);
  await page.locator('[data-submission-stage]').selectOption('draft');await expect(page.locator('[data-submission-row]:visible')).toHaveCount(0);await page.locator('[data-submission-stage]').selectOption('submitted');await expect(page.locator('[data-submission-row]:visible')).toHaveCount(1);
  await page.locator('[data-submission-search]').fill('配置確認作者');await expect(page.locator('[data-submission-row]:visible')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
});
