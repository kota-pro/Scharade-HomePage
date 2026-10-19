import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeDuration } from '../src/lib/noticeTiming.ts';
test('notice reading time is bounded and counts Unicode characters',()=>{
  assert.equal(noticeDuration('保存しました。'),4000);
  assert.equal(noticeDuration('あ'.repeat(50)),7000);
  assert.equal(noticeDuration('😀'.repeat(50)),7000);
  assert.equal(noticeDuration('あ'.repeat(2000)),15000);
});
