import { fixtureLogin } from "./fixture-auth";
import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const origin='http://127.0.0.1:4329';
async function login(page:Page){expect((await fixtureLogin(page.request, '/api/auth/login', {headers:{Origin:origin},data:{email:'member@example.invalid',password:'fixture-password-123'}})).status()).toBe(200);}
const input=()=>({idempotencyKey:randomUUID(),expenseDate:'2026-04-10',item:'撮影会の備品代',amount:1250,rosterName:'申請テスト',university:'大学',lineName:'LINE',notes:'',receiptUrl:'',refundMethod:'cash'});
async function fillRequired(page:Page, item='撮影会の備品代') {
  await page.getByLabel('立替日（必須）').fill('2026-04-10');
  await page.getByLabel('金額・円（必須）').fill('1250');
  await page.getByLabel('項目名・用途（必須）').fill(item);
  await page.getByLabel('名簿上の氏名（必須）').fill('申請テスト');
  await page.getByLabel('希望の返金方法（必須）').selectOption('cash');
}
const confirm=(page:Page)=>page.getByRole('button',{name:'Confirm 入力内容を確認する'}).click();
const send=(page:Page)=>page.getByRole('button',{name:'Submit この内容で申請する'}).click();
test('portal and advance endpoint require approval and enforce identity and origin',async({page,request})=>{
  expect((await request.get('/Member/advance',{maxRedirects:0})).status()).toBe(302);
  expect((await request.post('/api/member/advances',{headers:{Origin:origin},data:input()})).status()).toBe(401);
  expect((await request.post('/api/member/receipts/upload',{headers:{Origin:origin},multipart:{uploadKey:randomUUID()}})).status()).toBe(401);
  await login(page);
  expect((await page.request.post('/api/member/receipts/upload',{headers:{Origin:'https://wrong.invalid'},multipart:{uploadKey:randomUUID()}})).status()).toBe(403);
  expect((await page.request.post('/api/member/receipts/upload',{headers:{Origin:origin},multipart:{uploadKey:randomUUID(),ownerId:'admin'}})).status()).toBe(400);
  expect((await page.request.post('/api/member/advances',{headers:{Origin:'https://wrong.invalid'},data:input()})).status()).toBe(403);
  expect((await page.request.post('/api/member/advances',{headers:{Origin:origin},data:{...input(),websiteUserId:'admin',status:'承認済み'}})).status()).toBe(400);
  const body=input();const first=await page.request.post('/api/member/advances',{headers:{Origin:origin},data:body});
  expect(first.status()).toBe(201);const receipt=await first.json();expect(receipt.requestId).toMatch(/^ADV-[a-f0-9]{32}$/);
  expect(await(await page.request.post('/api/member/advances',{headers:{Origin:origin},data:body})).json()).toMatchObject({requestId:receipt.requestId,delivery:'delivered'});
  expect((await page.request.post('/api/member/advances',{headers:{Origin:origin},data:{...body,amount:9999}})).status()).toBe(409);
});
test('responsive form restores uncertain submission and retries with the same identity',async({page})=>{
  await login(page);await page.goto('/Member');await page.getByRole('link',{name:'立替申請',exact:false}).click();
  for(const width of [1440,768,390,320]) {await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await fillRequired(page);
  await page.getByLabel('領収書（任意）').setInputFiles({name:'再送テスト.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  let originalKey='';
  await page.route('**/api/member/advances',async route=>{originalKey=route.request().postDataJSON().idempotencyKey;await route.fetch();await route.abort('failed');});
  await confirm(page);await send(page);await expect(page.locator('#advance-send-status')).toHaveAttribute('data-error','true');
  await page.getByRole('button',{name:'入力に戻る',exact:true}).click();
  await page.getByLabel('金額・円（必須）').fill('9999');await confirm(page);
  await expect(page.locator('#advance-preview')).not.toBeVisible();await expect(page.locator('#advance-status')).toContainText('エラー番号：SITE-009');
  await expect(page.locator('#advance-status')).toContainText('前回の内容に戻して送信してください');
  await page.reload();await expect(page.getByLabel('金額・円（必須）')).toHaveValue('1250');await expect(page.locator('#advance-status')).toContainText('復元');
  await page.unroute('**/api/member/advances');const sent=page.waitForRequest('**/api/member/advances');await confirm(page);await send(page);
  expect((await sent).postDataJSON().idempotencyKey).toBe(originalKey);await expect(page.locator('#advance-status')).toContainText('受付番号：ADV-');await expect(page.getByLabel('金額・円（必須）')).toHaveValue('');
  await expect(page.locator('#advance-preview')).not.toBeVisible();await expect(page.locator('#advance-status')).toBeFocused();
  expect(await page.evaluate(()=>sessionStorage.getItem('scharade-advance:member'))).toBeNull();
});
test('queued applications close the preview and clearly report that resubmission is unnecessary',async({page})=>{
  await login(page);await page.goto('/Member/advance');await fillRequired(page,'一時障害の試験');await confirm(page);
  const result=page.waitForResponse('**/api/member/advances');await send(page);
  expect((await result).status()).toBe(202);await expect(page.locator('#advance-status')).toContainText('再申請は不要');
  await expect(page.locator('#advance-preview')).not.toBeVisible();await expect(page.getByLabel('金額・円（必須）')).toHaveValue('');
});
test('confirmation shows every field safely, supports editing and fits phone and desktop screens',async({page,browserName})=>{
  await login(page);await page.goto('/Member/advance');
  let requests=0;page.on('request',request=>{if(request.url().endsWith('/api/member/advances'))requests++;});
  await confirm(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  await fillRequired(page,'撮影会 <img src=x onerror=alert(1)>');
  await page.getByLabel('領収書（任意）').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});await confirm(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  await page.getByLabel('領収書（任意）').setInputFiles({name:'領収書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  await page.getByLabel('備考（任意）').fill('備品の内訳\nフィルムと乾電池');
  await page.getByLabel('大学名（任意）').fill('テスト大学');await page.getByLabel('LINE名（任意）').fill('会員LINE');
  await confirm(page);
  const dialog=page.getByRole('dialog',{name:'Confirm'});
  await expect(dialog).toBeVisible();await expect(page.locator('#advance-close')).toBeFocused();
  await expect(dialog.locator('[data-preview-field="expenseDate"]')).toHaveText('2026年4月10日');
  await expect(dialog.locator('[data-preview-field="amount"]')).toHaveText('1,250 円');
  await expect(dialog.locator('[data-preview-field="item"]')).toHaveText('撮影会 <img src=x onerror=alert(1)>');
  await expect(dialog.locator('[data-preview-field="item"] img')).toHaveCount(0);
  await expect(dialog.locator('[data-preview-field="receiptUrl"]')).toContainText('領収書.pdf');
  await expect(dialog.locator('[data-preview-field="notes"]')).toHaveText('備品の内訳\nフィルムと乾電池');
  await expect(dialog.locator('[data-preview-field="rosterName"]')).toHaveText('申請テスト');
  await expect(dialog.locator('[data-preview-field="university"]')).toHaveText('テスト大学');
  await expect(dialog.locator('[data-preview-field="lineName"]')).toHaveText('会員LINE');
  await expect(dialog.locator('.advance-preview-account')).toContainText('長いログイン表示名');
  const help = dialog.getByRole('button', { name: /^ヘルプを開く/ });
  await page.keyboard.press('Shift+Tab');await expect(help).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(page.locator('#advance-send')).toBeFocused();
  await page.keyboard.press('Tab');await expect(help).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#advance-close')).toBeFocused();
  expect(requests).toBe(0);expect(await page.evaluate(()=>sessionStorage.getItem('scharade-advance:member'))).toBeNull();
  await page.getByRole('button',{name:'項目名・用途を修正'}).click();await expect(page.getByLabel('項目名・用途（必須）')).toBeFocused();
  await page.getByLabel('項目名・用途（必須）').fill('撮影会の備品代');await page.getByLabel('金額・円（必須）').fill('2500');
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>window.scrollTo(0,0));
  if(browserName==='chromium')await page.screenshot({path:test.info().outputPath('advance-form-desktop.png'),fullPage:true});
  await confirm(page);await expect(dialog.locator('[data-preview-field="amount"]')).toHaveText('2,500 円');await expect(dialog).toHaveCSS('opacity','1');
  for(const [width,height] of [[1440,1000],[1024,768],[769,600],[768,900],[390,844],[320,568],[844,390]]) {
    await page.setViewportSize({width,height});
    await expect.poll(()=>dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
    await dialog.locator('[data-preview-field="lineName"]').scrollIntoViewIfNeeded();await expect(dialog.locator('[data-preview-field="lineName"]')).toBeInViewport();
    await dialog.locator('.advance-preview-body').evaluate(element=>element.scrollTo(0,0));await expect(dialog.locator('.advance-preview-account')).toBeInViewport();
    const sendBox=await page.locator('#advance-send').boundingBox();expect(sendBox).not.toBeNull();expect(sendBox!.x).toBeGreaterThanOrEqual(0);expect(sendBox!.x+sendBox!.width).toBeLessThanOrEqual(width+1);expect(sendBox!.y+sendBox!.height).toBeLessThanOrEqual(height+1);
    if(browserName==='chromium'&&[1440,390,320].includes(width))await page.screenshot({path:test.info().outputPath(`advance-confirm-${width}.png`),animations:'disabled'});
  }
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.locator('#advance-form button[type="submit"]')).toBeFocused();
  await expect(page.getByLabel('金額・円（必須）')).toHaveValue('2500');expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  await page.getByLabel('備考（任意）').fill('');await confirm(page);await expect(dialog.locator('[data-preview-field="notes"]')).toHaveText('（未入力）');
  await page.locator('#advance-close').click();await expect(dialog).not.toBeVisible();
  await confirm(page);await page.getByRole('button',{name:'入力に戻る',exact:true}).click();await expect(dialog).not.toBeVisible();expect(requests).toBe(0);
});
test('only a confirmed snapshot is sent and a pending send cannot be repeated or dismissed',async({page})=>{
  await login(page);await page.goto('/Member/advance');await fillRequired(page);await confirm(page);
  let requests=0;let payload:Record<string,unknown>={};let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/member/advances',async route=>{requests++;payload=route.request().postDataJSON();await held;await route.fulfill({status:201,json:{ok:true,requestId:'ADV-confirmed',message:'立替申請を登録しました。'}});});
  await page.locator('#advance-send').evaluate((element:HTMLButtonElement)=>{element.click();element.click();});
  await expect(page.locator('#advance-send-status')).toHaveText('申請を送信しています…');await expect(page.locator('#advance-send')).toBeDisabled();await expect(page.locator('#advance-close')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.locator('#advance-preview')).toBeVisible();await expect.poll(()=>requests).toBe(1);
  expect(payload).toMatchObject({expenseDate:'2026-04-10',amount:1250,item:'撮影会の備品代',rosterName:'申請テスト'});expect(payload).not.toHaveProperty('accountName');
  release();await expect(page.locator('#advance-status')).toContainText('受付番号：ADV-confirmed');await expect(page.locator('#advance-preview')).not.toBeVisible();
});

test('receipt upload is deferred until confirmation and survives a lost upload response and reload',async({page})=>{
  await login(page);await page.goto('/Member/advance');await fillRequired(page);
  let uploads=0,applications=0;
  page.on('request',request=>{if(request.url().endsWith('/receipts/upload'))uploads++;if(request.url().endsWith('/member/advances'))applications++;});
  await page.getByLabel('領収書（任意）').setInputFiles('public/media/site/activity/Photo1-480.webp');
  await confirm(page);await expect(page.locator('#receipt-preview-image')).toBeVisible();expect(uploads).toBe(0);
  await page.getByRole('button',{name:'領収書を修正'}).click();await page.getByRole('button',{name:'添付を解除する'}).click();
  await expect(page.locator('#receipt-selection')).toContainText('選択されていません');
  await page.getByLabel('領収書（任意）').setInputFiles({name:'領収書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  let savedUrl='';
  await page.route('**/api/member/receipts/upload',async route=>{
    // WebKit does not expose file bytes to route.fetch; send the same fixture through the API context.
    const uploadKey=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('scharade-advance:member')!).attachment.uploadKey);
    const result=await page.request.post('/api/member/receipts/upload',{headers:{Origin:origin},multipart:{uploadKey,file:{name:'領収書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')}}});
    expect(result.status(),await result.text()).toBe(200);savedUrl=(await result.json()).receipt.url;await route.abort('failed');
  });
  await confirm(page);await send(page);await expect(page.locator('#advance-send-status')).toHaveAttribute('data-error','true');expect(applications).toBe(0);
  await page.reload();await expect(page.locator('#receipt-selection')).toContainText('領収書.pdf');await expect(page.locator('#advance-status')).toContainText('復元');
  await page.unroute('**/api/member/receipts/upload');
  const sent=page.waitForRequest('**/api/member/advances');await confirm(page);await send(page);
  expect((await sent).postDataJSON().receiptUrl).toBe(savedUrl);await expect(page.locator('#advance-status')).toContainText('受付番号：ADV-');
  expect(uploads).toBe(2);expect(applications).toBe(1);await expect(page.locator('#receipt-url')).toHaveValue('');await expect(page.locator('#receipt-selection')).toContainText('選択されていません');
});

test('refund method toggles required fields, previews bank zeroes and restores an uncertain bank submission',async({page,browserName})=>{
  await login(page);await page.goto('/Member/advance');await fillRequired(page);
  const method=page.getByLabel('希望の返金方法（必須）');
  await method.selectOption('');await confirm(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  await method.selectOption('bank');await expect(page.getByLabel('銀行名（必須）',{exact:true})).toBeVisible();
  await expect(page.getByLabel('PayPay連絡用のLINE名（必須）')).not.toBeVisible();
  await confirm(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  for(const [name,value] of [['bankName','架空銀行 <img src=x>'],['bankAccountName','カクウ タロウ'],['bankBranchName','試験支店'],['bankBranchCode','００１'],['bankAccountNumber','００１２３４５']])await page.locator(`[name="${name}"]`).fill(value);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(browserName==='chromium'&&width===390)await page.screenshot({path:test.info().outputPath('refund-bank-mobile.png'),fullPage:true});
  }
  await confirm(page);const dialog=page.locator('#advance-preview');
  await expect(dialog.locator('[data-preview-field="refundMethod"]')).toHaveText('口座振込');
  await expect(dialog.locator('[data-preview-field="bankBranchCode"]')).toHaveText('001');
  await expect(dialog.locator('[data-preview-field="bankAccountNumber"]')).toHaveText('0012345');
  await expect(dialog.locator('[data-preview-field="bankName"] img')).toHaveCount(0);
  await expect(dialog.locator('[data-preview-field="refundLineName"]')).not.toBeVisible();
  let saved:Record<string,unknown>={};
  await page.route('**/api/member/advances',async route=>{saved=route.request().postDataJSON();await route.fetch();await route.abort('failed');});
  await send(page);await expect(page.locator('#advance-send-status')).toHaveAttribute('data-error','true');
  expect(saved.bankAccountNumber).toBe('0012345');expect(saved).not.toHaveProperty('refundLineName');
  await page.reload();await expect(method).toHaveValue('bank');await expect(page.locator('[name="bankAccountNumber"]')).toHaveValue('0012345');
  await page.unroute('**/api/member/advances');const again=page.waitForRequest('**/api/member/advances');await confirm(page);await send(page);
  expect((await again).postDataJSON()).toEqual(saved);await expect(page.locator('#advance-status')).toContainText('受付番号：ADV-');
  await expect(method).toHaveValue('');await expect(page.getByLabel('銀行名（必須）',{exact:true})).not.toBeVisible();
  await method.selectOption('bank');await expect(page.locator('[name="bankAccountNumber"]')).toHaveValue('');
});

test('switching from bank to PayPay or cash never submits inactive bank details',async({page})=>{
  await login(page);await page.goto('/Member/advance');await fillRequired(page);
  const method=page.getByLabel('希望の返金方法（必須）');await method.selectOption('bank');
  await page.locator('[name="bankAccountNumber"]').fill('0012345');
  await method.selectOption('paypay');await expect(page.locator('[name="bankAccountNumber"]')).toBeDisabled();
  await expect(page.getByLabel('PayPay連絡用のLINE名（必須）')).toBeVisible();await confirm(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  await page.getByLabel('PayPay連絡用のLINE名（必須）').fill('返金連絡LINE');
  await confirm(page);await expect(page.locator('[data-preview-field="refundLineName"]')).toHaveText('返金連絡LINE');
  await expect(page.locator('[data-preview-field="bankAccountNumber"]')).not.toBeVisible();
  let payload:Record<string,unknown>={};
  await page.route('**/api/member/advances',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:201,json:{ok:true,requestId:'ADV-method',message:'申請を登録しました。'}});});
  await send(page);await expect(page.locator('#advance-status')).toContainText('受付番号');
  expect(payload.refundMethod).toBe('paypay');expect(payload.refundLineName).toBe('返金連絡LINE');expect(payload).not.toHaveProperty('bankAccountNumber');
  await fillRequired(page);await confirm(page);await send(page);await expect(page.locator('#advance-preview')).not.toBeVisible();
  expect(payload.refundMethod).toBe('cash');expect(payload).not.toHaveProperty('refundLineName');expect(payload).not.toHaveProperty('bankAccountNumber');
});

test('legacy uncertain requests can retry without changing their original payload',async({page})=>{
  await login(page);await page.goto('/Member/advance');
  const {idempotencyKey,refundMethod,...legacy}=input();
  await page.evaluate(({legacy,idempotencyKey})=>sessionStorage.setItem('scharade-advance:member',JSON.stringify({key:idempotencyKey,body:legacy,pendingSubmission:true})),{legacy,idempotencyKey});
  await page.reload();await expect(page.locator('#refund-method')).toBeDisabled();
  let payload:Record<string,unknown>={};await page.route('**/api/member/advances',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:201,json:{ok:true,requestId:'ADV-legacy',message:'受付を確認しました。'}});});
  await confirm(page);await expect(page.locator('[data-preview-field="refundMethod"]')).toContainText('未指定');await send(page);
  await expect(page.locator('#advance-status')).toContainText('ADV-legacy');expect(payload).toEqual({...legacy,idempotencyKey});await expect(page.locator('#refund-method')).toBeEnabled();await expect(page.locator('#refund-method')).toHaveValue('');
});
