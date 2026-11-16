import {unzipSync,strFromU8} from 'fflate';
import type {APIResponse} from '@playwright/test';
import {expect,type Page} from '@playwright/test';
export async function addShape(page:Page,kind:string,x?:number,y?:number){
 await page.locator('[data-layout-fit]').click();
 const count=await page.locator('[data-layout-kind="annotation"],[data-layout-kind="board"],[data-layout-kind="table"]').count();
 if(kind==='text'){await page.locator('[data-layout-tool="text"]').click();await clickLayout(page,x??1500+count*350,y??1500);await page.locator('[data-layout-text-edit]').fill('文字');await page.locator('[data-text-done]').click();await page.locator('[data-layout-tool="select"]').click();return;}
 await page.locator('[data-layout-tab="properties"]').click();await page.locator('[data-layout-tool="shapes"]').click();await page.locator(`[data-layout-shape="${kind}"]`).click();if(['rect','ellipse'].includes(kind)){await page.locator('[data-layout-shape-size="width"]').fill(kind==='rect'?'1000':'600');await page.locator('[data-layout-shape-size="width"]').press('Tab');await page.locator('[data-layout-shape-size="height"]').fill(kind==='rect'?'600':'400');await page.locator('[data-layout-shape-size="height"]').press('Tab');}const view=await page.locator('[data-layout-view]').inputValue();await clickLayout(page,x??1000+count*1300,y??(view==='floor'&&['door','window'].includes(kind)?0:1000+count*800));await page.locator('[data-layout-tool="select"]').click();await expect(page.locator('[data-layout-inspector]')).not.toContainText('キャンバスの配置する位置をクリック');
}
export async function openPropertySection(page:Page,title:string){
 const section=page.locator('details[data-property-section]').filter({has:page.getByText(title,{exact:true}).and(page.locator('summary'))});
 await expect(section).toHaveCount(1);
 if(!await section.evaluate(el=>(el as HTMLDetailsElement).open))await section.locator('summary').click();
}
export async function clickLayout(page:Page,x:number,y:number){const p=await page.locator('[data-layout-canvas]').evaluate((svg,p)=>{const q=new DOMPoint(p.x,p.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);return{x:q.x,y:q.y};},{x,y});await page.mouse.click(p.x,p.y);}

// Presence/layout repaints may replace an SVG child between locator resolution
// and evaluation. Never click an identity-matrix coordinate from a detached path.
export async function layoutPathPoint(page:Page,selector:string,ratio:number){
 let point:{x:number;y:number}|undefined;
 await expect.poll(async()=>{
  point=await page.locator(selector).evaluate((el,ratio)=>{
   const path=el as SVGPathElement,matrix=path.getScreenCTM();
   if(!path.isConnected||!matrix)return undefined;
   const local=path.getPointAtLength(path.getTotalLength()*ratio),q=new DOMPoint(local.x,local.y).matrixTransform(matrix),rect=document.querySelector('[data-layout-canvas]')!.getBoundingClientRect();
   return q.x>=rect.left&&q.x<=rect.right&&q.y>=rect.top&&q.y<=rect.bottom?{x:q.x,y:q.y}:undefined;
  },ratio).catch(()=>undefined);
  return !!point;
 }).toBe(true);
 return point!;
}

export async function outputSvgText(response:APIResponse){return Object.values(unzipSync(await response.body())).map(bytes=>strFromU8(bytes)).join('\n');}
