import {test,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {getBlogBySlug} from '../src/lib/blog.ts';
import {invalidateCache} from '../src/lib/cache.ts';
import {linkToPost} from '../src/utils/linkToPost.ts';
import {buildTabs} from '../src/utils/blog.ts';
import type {Blog} from '../src/types/microcms.ts';

const originalFetch=globalThis.fetch;
process.env.MICROCMS_SERVICE_DOMAIN='fixture';
process.env.MICROCMS_SERVER_API_KEY='test';
beforeEach(()=>invalidateCache());
after(()=>{globalThis.fetch=originalFetch});

test('tag tabs distinguish Japanese names, punctuation variants and the reserved all tab',()=>{
 const names=['暗室','撮影会','お知らせ','All','all','a b','a-b','tag'];
 const posts=names.map((tag,i)=>({id:`post-${i}`,slug:`post-${i}`,title:tag,tags:[tag]})) as Blog[];
 const tabs=buildTabs(posts);
 assert.equal(tabs[0].slug,'all');
 assert.equal(tabs[0].posts.length,posts.length);
 assert.equal(new Set(tabs.map(tab=>tab.slug)).size,tabs.length);
 for(const tab of tabs.slice(1))assert.deepEqual(tab.posts.map(post=>post.title),[tab.label]);
});

test('blog links keep Japanese punctuation, query delimiters and literal percent sequences in the path',()=>{
 for(const slug of ['暗室の使い方②　〜現像編〜','ホームページを作成しました！','撮影会 [春] #1? 100%','literal%20text']) {
  const url=new URL(linkToPost(slug,'activity'),'https://scharade.jp');
  assert.equal(decodeURIComponent(url.pathname.slice('/posts/'.length)),slug);
  assert.equal(url.search,'?from=activity');
  assert.equal(url.hash,'');
 }
});

test('blog lookup paginates the slug index and never turns URL text into a CMS filter',async()=>{
 const slug='撮影会 [春] #1? 100%';
 const index=[...Array.from({length:100},(_,i)=>({id:`post-${i}`,slug:`記事${i}`})),{id:'selected',slug}];
 const urls:URL[]=[];
 globalThis.fetch=async(input)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  urls.push(url);
  assert.equal(url.hostname,'fixture.microcms.io');
  assert.equal(url.searchParams.has('filters'),false);
  const ids=url.searchParams.get('ids');
  if(ids) {
   assert.equal(ids,'selected');
   return Response.json({contents:[{id:'selected',slug,title:'本文のある記事',body:'<p>内容</p>'}],totalCount:1,offset:0,limit:1});
  }
  assert.equal(url.searchParams.get('fields'),'id,slug');
  const offset=Number(url.searchParams.get('offset')||0);
  return Response.json({contents:index.slice(offset,offset+100),totalCount:101,offset,limit:100});
 };
 const post=await getBlogBySlug(slug);
 assert.equal(post?.id,'selected');
 assert.equal(post?.body,'<p>内容</p>');
 assert.equal(urls.length,3);
 assert.equal(await getBlogBySlug('記事0[or]slug[exists]'),undefined);
 assert.equal(await getBlogBySlug('存在しない記事！'),undefined);
 assert.equal(urls.length,3,'missing slugs reuse the cached index and fetch no unrelated post');
});
