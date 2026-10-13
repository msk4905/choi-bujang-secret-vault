import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeOwnerKey } from '../src/verify-login.mjs';

const SUB = '66666666-6666-4666-8666-666666666666';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

test('심판 소유자 키는 같은 sub라도 신원 a·b마다 다르고, 같은 입력이면 늘 같고, UUID 모양이다', () => {
  const a = judgeOwnerKey(SUB, 'a');
  const b = judgeOwnerKey(SUB, 'b');
  assert.notEqual(a, b);
  assert.equal(judgeOwnerKey(SUB, 'a'), a);
  assert.equal(judgeOwnerKey(SUB.toUpperCase(), 'a'), a); // sub의 대소문자는 구분하지 않음
  assert.notEqual(a, SUB);
  assert.match(a, V4);
  assert.match(b, V4);
  assert.notEqual(judgeOwnerKey('77777777-7777-4777-8777-777777777777', 'a'), a);
});
