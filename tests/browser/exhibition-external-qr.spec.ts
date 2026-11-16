import {test,expect,type Page} from '@playwright/test';
import sharp from 'sharp';
import jsQR from 'jsqr';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'};
const url='https://www.instagram.com/example_photo/?igsh=abc';
async function login(page:Page,email='member@example.invalid') {
  expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);
}
async function decode(image:string,card=false) {
  let input=sharp(Buffer.from(image.split(',')[1],'base64'));
  if(card)input=input.extract({left:632,top:394,width:144,height:144});
  const {data,info}=await input.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return jsQR(new Uint8ClampedArray(data),info.width,info.height)?.data;
}
test('entering an external SNS URL updates autosave, the real QR preview, submitted review and deliberate staff target choices',async({page},info)=>{
  test.setTimeout(90000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const owner=`photo-owner-${info.project.name}`;await login(page,`${owner}@example.invalid`);
  const id=`f3000000-0000-4000-8000-00000000000${['chromium','firefox','webkit'].indexOf(info.project.name)+1}`,endpoint=`/api/exhibitions/${id}`;
  const started=await page.request.post(endpoint,{headers,data:{action:'begin'}});expect(started.ok(),await started.text()).toBe(true);const initial=await started.json();
  const sectionId=initial.schema.sections[0].id,workId=crypto.randomUUID(),content={...initial.submission.draft,name:`写真確認 owner ${info.project.name}`,grade:'2年',sections:[{sectionId,singles:0,series:0,books:1,seriesPhotoCounts:[],fields:{}}],works:[{id:workId,sectionId,kind:'book',title:'光',caption:'',location:'',equipment:'',settings:'',photos:[],fields:{}}]};
  const saved=await page.request.post(endpoint,{headers,data:{action:'save',revision:initial.submission.revision,content}});expect(saved.ok(),await saved.text()).toBe(true);
  await page.goto(`/Exhibition/${id}`);const external=page.locator('[data-common="portfolioUrl"]');await external.fill(url);
  await expect.poll(async()=>(await(await page.request.get(endpoint)).json()).submission.draft.portfolioUrl).toBe(url);
  await page.locator('[data-preview-boards]').click();const card=page.locator('.board-preview-dialog img').first();await expect(card).toBeVisible();
  expect(await decode((await card.getAttribute('src'))!,true)).toBe(url);await page.keyboard.press('Escape');
  await page.locator('[data-submit]').click();await expect.poll(async()=>(await(await page.request.get(endpoint)).json()).submission.versions.length).toBe(1);
  await login(page,'planner@example.invalid');const admin=`/api/member/exhibitions/${id}`;
  const current=async()=>(await(await page.request.get(admin)).json()).submissions[0];
  expect((await current()).qrUrl).toBe(url);expect((await current()).qrConfirmed).toBe(true);expect(await decode((await current()).qrImage)).toBe(url);
  const open=async()=>{await page.goto(`/Member/manage/exhibitions/${id}/submissions`);await page.locator('[data-submission-tab="works"]').click();await page.locator('.submission-work-card [data-submission-detail]').first().click();const modal=page.locator('.submission-detail-dialog');await modal.locator('[data-se-tab="qr"]').click();return modal;};
  let modal=await open();await expect(modal.locator('.exhibition-qr a')).toHaveAttribute('href',url);await modal.locator(`[data-qr-portfolio="${owner}"]`).click();
  const internal=`http://127.0.0.1:4329/Portfolio/${owner}`;await expect.poll(async()=>(await current()).qrUrl).toBe(internal);
  modal=await open();await expect(modal.locator('.exhibition-qr a')).toHaveAttribute('href',internal);await modal.locator('[data-qr-submission]:not([data-qr-portfolio])').click();await expect.poll(async()=>(await current()).qrUrl).toBe(url);
  expect(errors).toEqual([]);
});
