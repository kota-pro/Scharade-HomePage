import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedPortfolioGrade } from '../src/lib/portfolioRosterGrade.ts';
import { normalizePortfolioGrade } from '../src/lib/microcms.ts';
import { notificationGradeOptions, notificationRecipient } from '../src/lib/notificationRecipients.ts';
import type { ActivityRoster, ActivityStore, Grade } from '../src/lib/activityTypes.ts';

const users = [{ id: 'admin', portfolioId: 'admin-portfolio' }, { id: 'member', portfolioId: 'member-portfolio' }];
const roster = (): ActivityRoster => ({ revision: 1, spreadsheetId: 'test', sheetId: 0, title: '名簿', sheetTitle: '名簿', fetchedAt: '', fetchedBy: 'admin', bindings: { admin: 'admin-record', member: 'member-record' }, records: [
  { key: 'admin-record', name: '管理者', university: '', gender: 'male', grade: 'master', active: true },
  { key: 'member-record', name: '会員', university: '', gender: 'female', grade: 'doctorate', active: true },
] });

test('Portfolio defaults use the edited owner and authoritative linked roster grade', () => {
  const data = roster();
  assert.equal(linkedPortfolioGrade('admin-portfolio', users, data), "Master's Program");
  assert.equal(linkedPortfolioGrade('member-portfolio', users, data), "Doctor's Program");
  for (const [grade, expected] of Object.entries({ '1': '1st Grade', '2': '2nd Grade', '3': '3rd Grade', '4': '4th Grade', alumni: 'OB/OG' })) {
    data.records[1].grade = grade as Grade;
    assert.equal(linkedPortfolioGrade('member-portfolio', users, data), expected);
  }
});
test('missing, ambiguous or unmappable links preserve the saved Portfolio grade through null fallback', () => {
  assert.equal(linkedPortfolioGrade('member-portfolio', users, undefined), null);
  assert.equal(linkedPortfolioGrade('missing', users, roster()), null);
  assert.equal(linkedPortfolioGrade('member-portfolio', [...users, { id: 'duplicate', portfolioId: 'member-portfolio' }], roster()), null);
  const data = roster();
  for (const grade of [null, 'other', '5', '6'] as const) {
    data.records[1].grade = grade;
    assert.equal(linkedPortfolioGrade('member-portfolio', users, data), null);
  }
  delete data.bindings.member;
  assert.equal(linkedPortfolioGrade('member-portfolio', users, data), null);
});
test('retired linked members default to OB/OG, and a restored active record takes precedence', () => {
  const data = roster(); const person = data.records.pop()!;
  data.retiredRecords = [{ ...person, active: false, withdrawnAt: '2026-10-28T00:00:00Z' }];
  assert.equal(linkedPortfolioGrade('member-portfolio', users, data), 'OB/OG');
  data.records.push(person);
  assert.equal(linkedPortfolioGrade('member-portfolio', users, data), "Doctor's Program");
});
test('doctoral CMS strings and select arrays normalize to the new Portfolio category', () => {
  for (const value of ["Doctor's Program", "doctors program", '博士', '博士課程', 'doctorate']) {
    assert.equal(normalizePortfolioGrade(value), "Doctor's Program");
    assert.equal(normalizePortfolioGrade([value]), "Doctor's Program");
  }
});
test('notification filters omit fifth and sixth years without deleting existing recipients', () => {
  assert.deepEqual(notificationGradeOptions.map(([value]) => value), ['1', '2', '3', '4', 'master', 'doctorate', 'alumni', 'other']);
  const activities = { profiles: { member: { rosterKey: 'member-record', grade: '5' } }, roster: roster() } as unknown as ActivityStore;
  assert.equal(notificationRecipient({ id: 'member', name: '会員' }, activities).grade, '5');
});
