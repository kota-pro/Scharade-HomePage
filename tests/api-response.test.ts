import test from 'node:test';
import assert from 'node:assert/strict';
import {readApiResponse,apiErrorMessage} from '../src/scripts/apiResponse.ts';
import { formatSiteError } from '../src/lib/siteErrors.ts';
test('API replies preserve server validation and Contact acknowledgement messages',async()=>{
 const invalid={ok:false,message:'入力を確認してください。'};assert.deepEqual(await readApiResponse(Response.json(invalid)),{...invalid,errorCode:'SITE-001',message:formatSiteError(invalid.message)});
 const success={message:'お問い合わせを受け付けました。'};assert.deepEqual(await readApiResponse(Response.json(success)),success);
});
test('HTML, empty, malformed and array replies report unknown results',async()=>{
 for(const body of ['<!DOCTYPE html><title>502</title>','','{broken','[]','null'])await assert.rejects(readApiResponse(new Response(body,{status:502})),/結果を確認/);
 await assert.rejects(readApiResponse(new Response('HTML'),'保存結果が未確認です。'),/重複した送信を避ける/);
});
test('non-JSON expired sessions and login redirects ask for reauthentication',async()=>{
 await assert.rejects(readApiResponse(new Response('HTML',{status:401})),/再度ログイン/);
 const redirected=new Response('HTML');Object.defineProperties(redirected,{redirected:{value:true},url:{value:'https://scharade.jp/Login?next=%2FMember'}});
 await assert.rejects(readApiResponse(redirected),/再度ログイン/);
 const denial={ok:false,message:'この操作を行う権限がありません。'};const result=await readApiResponse(Response.json(denial,{status:403}));assert.equal(result.errorCode,'SITE-003');assert.match(result.message,/^エラー番号：SITE-003\n/);assert.match(result.message,/アカウント/);
});
test('network and parser errors never expose browser diagnostics; application messages survive',()=>{
 for(const error of [new TypeError('Failed to fetch'),new SyntaxError('Unexpected token <'),new DOMException('signal','TimeoutError'),new DOMException('signal','AbortError')])assert.equal(apiErrorMessage(error,'結果未確認'), formatSiteError('結果未確認'));
 assert.equal(apiErrorMessage(new Error('他の操作で変更されています。')),formatSiteError('他の操作で変更されています。'));
});
