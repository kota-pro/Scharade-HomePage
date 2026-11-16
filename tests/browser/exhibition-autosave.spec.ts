import {test,expect,type Page} from '@playwright/test';
import {fixtureLogin} from './fixture-auth';
const headers={Origin:'http://127.0.0.1:4329'};
async function login(page:Page,email='member@example.invalid'){expect((await fixtureLogin(page.request,'/api/auth/login',{headers,data:{email,password:'fixture-password-123'}})).ok()).toBe(true);}
async function prepare(page:Page,title:string){
 await login(page,'planner@example.invalid');
 const command=async(data:Record<string,unknown>)=>{const r=await page.request.post('/api/member/exhibitions',{headers,data});expect(r.status(),await r.text()).toBe(200);return(await r.json()).exhibition;};
 let e=await command({action:'create',title});const id=e.id,iso=(d:number)=>new Date(Date.now()+d).toISOString();
 const field=crypto.randomUUID();e=await command({action:'schema',exhibitionId:id,revision:e.revision,schema:{...e.schemas[0],fields:[{id:field,type:'paragraph',label:'追加の説明',scope:'common',required:false,options:[]}]}});
 e=await command({action:'settings',exhibitionId:id,revision:e.revision,title,status:'open',gallery:'staff',voteOpensAt:iso(-60000),voteClosesAt:iso(3600000),opensAt:iso(-60000),closesAt:iso(3600000),recipientIds:['member','other']});
 await command({action:'participation.publish',exhibitionId:id,revision:e.revision});
 const current=async()=>(await(await page.request.get(`/api/member/exhibitions/${id}`)).json()).exhibition;
 await expect.poll(async()=>(await current()).participation.state).toBe('published');
 for(const userId of ['member','other']){e=await current();await command({action:'participation.attendance.set',exhibitionId:id,revision:e.revision,userId,vote:'attending'});}
 await login(page);await page.goto(`/Exhibition/${id}`);await page.locator('[data-begin]').click();await expect(page.locator('[data-common="name"]')).toBeVisible();return{id,field,endpoint:`/api/exhibitions/${id}`};
}
const settled=async(page:Page)=>expect(page.locator('[data-draft-sync-status]')).toHaveText('自動保存済み');
test('wide form, caption readability and serialized autosave preserve typing and recover after logout',async({page},info)=>{
 test.setTimeout(90000);const{id,field,endpoint}=await prepare(page,`自動保存 ${info.project.name}`);
 await page.locator('[data-common="name"]').fill('作者');await page.locator('[data-common="authorName"]').fill('作者');await page.locator('[data-common="grade"]').selectOption('2年');
 await page.getByLabel('通常展示',{exact:true}).check();await page.locator('[data-count="books"]').fill('1');await page.locator('[data-count="books"]').press('Tab');
 await page.locator('[data-work-key="title"]').fill('春');const caption=page.locator('[data-work-key="caption"]');await caption.fill('入力の説明');await page.locator(`[data-field-id="${field}"]`).fill('フォーカスを外さなくても保存');
 await settled(page);let saved=await(await page.request.get(endpoint)).json();expect(saved.submission.versions).toHaveLength(0);expect(saved.submission.draft.fields[field]).toBe('フォーカスを外さなくても保存');
 const filename=`form-${info.project.name}`;
 for(const width of [1440,1024,375]){await page.setViewportSize({width,height:950});await page.evaluate(()=>scrollTo({top:0,behavior:"instant"}));await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);expect(await page.evaluate(()=>[...document.querySelectorAll('main *')].map(el=>({tag:el.tagName,cls:String(el.className),right:el.getBoundingClientRect().right})).filter(x=>x.right>innerWidth+2).slice(0,5))).toEqual([]);const form=(await page.locator('#exhibition-submission').boundingBox())!;if(width>=1024){expect(form.x).toBeCloseTo(120,0);expect(form.width).toBeCloseTo(width-240,0);}else{expect(form.width).toBeGreaterThan(width-100);expect(form.x).toBeLessThan(50);}expect(await caption.evaluate(el=>getComputedStyle(el).fontSize)).toBe('16px');await page.screenshot({path:info.outputPath(`${filename}-${width}.png`)});await caption.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`${filename}-caption-${width}.png`)});}
 await page.setViewportSize({width:1440,height:950});
 const heading=page.locator('.exhibition-section-title h1'),line=page.locator('.exhibition-title-line');expect((await heading.boundingBox())!.x).toBeLessThan(2);expect((await line.boundingBox())!.x).toBeGreaterThan((await heading.boundingBox())!.width);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let intercepted=false;
 await page.route(`**${endpoint}`,async route=>{if(route.request().method()==='POST'&&route.request().postDataJSON().action==='save'&&route.request().postDataJSON().content.works[0]?.caption==='送信中'){intercepted=true;await gate;}await route.continue();});
 await caption.fill('送信中');await expect.poll(()=>intercepted).toBe(true);await caption.fill('通信中にさらに入力');await caption.press('End');release();await settled(page);await expect(caption).toBeFocused();await expect(caption).toHaveValue('通信中にさらに入力');expect((await(await page.request.get(endpoint)).json()).submission.draft.works[0].caption).toBe('通信中にさらに入力');await page.unroute(`**${endpoint}`);
 // Simulate a connection loss, then restore connectivity without reloading the editor.
 await page.route(`**${endpoint}`,route=>route.request().method()==='POST'?route.abort('failed'):route.continue());await caption.fill('接続が切れても残す');await expect(page.locator('[data-draft-sync-status]')).toContainText('接続後に再送');await page.unroute(`**${endpoint}`);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await settled(page);
 await page.request.post('/api/auth/logout',{headers});await caption.fill('ログインが切れた後の入力');await expect(page.locator('[data-draft-sync-status]')).toContainText('再ログイン');await expect(page.locator('[data-draft-login]')).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('scharade:exhibition-draft:')).length)).toBeGreaterThan(0);
 await login(page);await page.reload();await expect(caption).toHaveValue('ログインが切れた後の入力');await settled(page);saved=await(await page.request.get(endpoint)).json();expect(saved.submission.draft.works[0].caption).toBe('ログインが切れた後の入力');expect(saved.submission.versions).toHaveLength(0);
 await page.locator('[data-submit]').click();await expect(page.locator('.exhibition-status')).toContainText('提出しました');expect((await(await page.request.get(endpoint)).json()).submission.versions).toHaveLength(1);
 await page.reload();await settled(page);expect((await(await page.request.get(`/api/exhibitions/${id}`)).json()).submission.versions).toHaveLength(1);
});
test('parallel editors retain both drafts, and an old page cannot save into a different account',async({page,context},info)=>{
 test.setTimeout(90000);const{endpoint}=await prepare(page,`下書きの保護 ${info.project.name}`);await settled(page);
 const second=await context.newPage();await second.goto(page.url());await expect(second.locator('[data-common="name"]')).toBeVisible();
 await second.locator('[data-common="name"]').fill('別画面の編集');await settled(second);
 await page.locator('[data-common="name"]').fill('元の画面の編集');await expect(page.locator('[data-draft-sync-status]')).toContainText('別の画面');expect((await(await page.request.get(endpoint)).json()).submission.draft.name).toBe('別画面の編集');
 await page.locator('[data-draft-resolve="local"]').click();await settled(page);expect((await(await page.request.get(endpoint)).json()).submission.draft.name).toBe('元の画面の編集');await second.close();
 await login(page,'other@example.invalid');const begin=await page.request.post(endpoint,{headers,data:{action:'begin'}});expect(begin.status()).toBe(200);const other=await(await page.request.get(endpoint)).json();
 await page.locator('[data-common="name"]').fill('別のアカウントに混ぜない');await expect(page.locator('[data-draft-sync-status]')).toContainText('アカウントが変更');expect((await(await page.request.get(endpoint)).json()).submission).toEqual(other.submission);
 await page.reload();await expect(page.locator('[data-common="name"]')).toHaveValue('別の会員');await settled(page);
 await login(page);await page.reload();await expect(page.locator('[data-common="name"]')).toHaveValue('別のアカウントに混ぜない');await settled(page);
});
