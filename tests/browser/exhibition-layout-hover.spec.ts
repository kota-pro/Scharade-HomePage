import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {fixtureLogin} from './fixture-auth';
import {withStoreLock,readData,writeData} from '../../src/lib/store.ts';
import {parseRooms} from '../../src/lib/exhibitionValidation.ts';
import {ensureRoomPath} from '../../src/lib/exhibitionRoomPath.ts';
import {outputSvgText} from './layout-tools-helper';
const headers={Origin:'http://127.0.0.1:4329'};
async function move(page:Page,x:number,y:number){const p=await page.locator('[data-layout-canvas]').evaluate((el,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform((el as SVGSVGElement).getScreenCTM()!);return{x:q.x,y:q.y};},{x,y});await page.mouse.move(p.x,p.y);return p;}

test('connected board height steps and read-only hover dimensions/whole-object frames work without scrolling or changing data',async({page},info)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1440,height:1000});
 expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email:'planner@example.invalid',password:'fixture-password-123'}})).ok()).toBe(true);
 const e=(await(await page.request.post('/api/member/exhibitions',{headers,data:{action:'create',title:`寸法表示 ${info.project.name}`}})).json()).exhibition,sectionId=e.schemas[0].sections[0].id,groupId=crypto.randomUUID(),workId=crypto.randomUUID();
 const room=parseRooms([{id:crypto.randomUUID(),name:'寸法確認室',vertices:[{x:0,y:0},{x:6000,y:0},{x:6000,y:4000},{x:0,y:4000}],wallHeights:[3000,3000,3000,3000],openings:[],placements:[{workId,wall:0,x:500,bottom:1000,rotation:0}],tables:[],books:[],annotations:[{id:crypto.randomUUID(),kind:'rect',x:1000,y:2500,width:1000,height:600,rotation:0,name:'寸法確認図形',text:'',fontSize:100}],boardGroups:[{id:groupId,name:'連結ボード',x:1000,y:1000,rotation:0,panels:[2000,2000,2400,2100].map((height,i)=>({id:crypto.randomUUID(),name:`パネル${i+1}`,width:900,height,thickness:30,hingeAngle:0}))}]}])[0];
 ensureRoomPath(room);
 const work={id:workId,sectionId,kind:'series',title:'寸法確認組写真',caption:'',location:'',equipment:'',settings:'',fields:{},photos:[0,350].map(x=>({assetId:'',x,y:0,width:300,height:400,rotation:0}))},content={name:'寸法確認会員',authorName:'作者',grade:'2年',portfolioUrl:'',fields:{},sections:[{sectionId,singles:0,series:1,books:0,seriesPhotoCounts:[2],fields:{}}],works:[work]};
 const {directory}=JSON.parse(fs.readFileSync('.data/browser-fixture-path.json','utf8'));if(!directory.startsWith(path.join(os.tmpdir(),'scharade-browser-')))throw new Error('Synthetic fixture required');const previous=process.env.DATA_DIR;process.env.DATA_DIR=directory;
 try{await withStoreLock('exhibitions',()=>{const data=readData<any>('exhibitions.json',{});data.exhibitions.find((x:any)=>x.id===e.id).rooms=[room];data.submissions.push({id:crypto.randomUUID(),exhibitionId:e.id,userId:'member',revision:1,schemaVersion:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),draft:content,versions:[{version:1,schemaVersion:1,at:new Date().toISOString(),content,delivery:'delivered'}]});writeData('exhibitions.json',data);});}finally{if(previous===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=previous;}
 const state=async()=>(await(await page.request.get(`/api/member/exhibitions/${e.id}`)).json()).exhibition;
 const before=(await state()).rooms;await page.goto(`/Member/manage/exhibitions/${e.id}/layout`);await page.locator('[data-open-room-editor="floor"]').click();const tip=page.locator('[data-layout-dimension-tooltip]'),frame=page.locator('[data-layout-hover-frame]');
 const scroll=await page.evaluate(()=>scrollY);await move(page,5000,3000);await expect(tip).toHaveText('寸法確認室\n縦 4000 × 横 6000 mm');await expect(frame).toBeVisible();
 await move(page,6000,2000);await expect(tip).toContainText('長さ 4000 mm / 高さ 3000 mm');
 await move(page,500,0);await expect(tip).toHaveText('寸法確認組写真\n作者：作者\n提出者：寸法確認会員\n縦 400 × 横 650 mm');expect(Number(await frame.getAttribute('width'))).toBeGreaterThan(80);
 await move(page,1400,2800);await expect(tip).toHaveText('寸法確認図形\n縦 600 × 横 1000 mm');await page.mouse.down();await expect(tip).toBeHidden();await expect(frame).toBeHidden();await page.mouse.up();
 await page.locator('[data-layout-view]').selectOption(`board:${groupId}:A`);
 await expect(page.locator('[data-layout-measurement="size:surface:y"]')).toContainText('2000.0 mm');await expect(page.locator('[data-layout-measurement$="height-difference"]')).toHaveCount(2);
 await expect(page.locator('[data-layout-measurement$="height-difference"]').nth(0)).toContainText('高さ差 400.0 mm');await expect(page.locator('[data-layout-measurement$="height-difference"]').nth(1)).toContainText('高さ差 300.0 mm');
 await move(page,300,1500);await expect(tip).toHaveText('パネル1\n縦 2000 × 横 900 mm');await page.screenshot({path:info.outputPath('board-height-hover.png')});
 await page.locator('[data-layout-view]').selectOption(`board:${groupId}:B`);await expect(tip).toBeHidden();await expect(frame).toBeHidden();await expect(page.locator('[data-layout-measurement="size:surface:y"]')).toContainText('2100.0 mm');
 await page.locator('[data-layout-view]').selectOption('wall:0');await move(page,800,1800);await expect(tip).toHaveText('寸法確認組写真\n作者：作者\n提出者：寸法確認会員\n縦 400 × 横 650 mm');expect(Number(await frame.getAttribute('width'))).toBeGreaterThan(650);expect(Number(await frame.getAttribute('width'))).toBeLessThan(800);
 await page.screenshot({path:info.outputPath('series-whole-frame.png')});await page.locator('[data-layout-tab="align"]').click();await page.locator('[data-layout-guide="sizes"]').uncheck();await expect(page.locator('[data-layout-measurement^="size:"]')).toHaveCount(0);await move(page,800,1800);await expect(tip).toBeVisible();
 await page.mouse.wheel(0,30);await expect(tip).toBeHidden();await expect(frame).toBeHidden();await page.locator('[data-layout-fit]').click();await page.setViewportSize({width:390,height:1000});await page.locator('[data-layout-fit]').click();await move(page,800,1800);await expect(tip).toBeVisible();const tipBox=(await tip.boundingBox())!,canvasBox=(await page.locator('[data-layout-canvas]').boundingBox())!;expect(tipBox.x).toBeGreaterThanOrEqual(canvasBox.x);expect(tipBox.x+tipBox.width).toBeLessThanOrEqual(canvasBox.x+canvasBox.width+1);await page.screenshot({path:info.outputPath('hover-mobile.png')});
 await page.mouse.move(0,0);await expect(tip).toBeHidden();expect(await page.evaluate(()=>scrollY)).toBe(scroll);expect((await state()).rooms).toEqual(before);
 const output=await page.request.get(`/api/member/exhibitions/${e.id}/output?kind=layout-svg&room=${room.id}`);expect(output.ok()).toBe(true);expect(await outputSvgText(output)).not.toMatch(/data-layout-size-label|data-layout-size-box|data-layout-hover-frame|layout-dimension-tooltip/);expect(errors).toEqual([]);
});
