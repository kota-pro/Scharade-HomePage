import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditPortfolio, type User } from '../src/lib/auth.ts';
import { isArchivedPortfolio, isListedPortfolio } from '../src/data/portfolioVisibility.ts';
import { normalizePortfolioGrade } from '../src/lib/microcms.ts';
const archived = 'wpfqu4-8h10';
const member: User = { id: 'member', name: '会員', email: '', approved: true, role: 'member', portfolioId: archived, providers: {}, createdAt: '' };
test('archived works remain publicly listed but are editable only by an approved administrator', () => {
  assert.equal(isListedPortfolio({id:archived}),true);
  assert.equal(isArchivedPortfolio({id:archived}),true);
  for(const role of ['member','staff','executive','admin'] as const) {
    assert.equal(canEditPortfolio({...member,role},archived),role==='admin');
    assert.equal(canEditPortfolio({...member,role,approved:false},archived),false);
  }
  assert.equal(canEditPortfolio(null,archived),false);
  assert.equal(canEditPortfolio({...member,portfolioId:'active'},'active'),true);
  assert.equal(canEditPortfolio(member,'unrelated'),false);
});
test('existing alumni grade spellings normalize to the alumni section',()=>{
  for(const grade of ['OG','OB','OB/OG','ob/og','卒業',['OB/OG']]) assert.equal(normalizePortfolioGrade(grade),'OB/OG');
});
