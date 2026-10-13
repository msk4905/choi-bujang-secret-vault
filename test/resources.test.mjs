import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RESOURCE_TYPES, noteResourceId, resourceId } from '../src/resources.mjs';

const ID = '11111111-1111-4111-8111-111111111111';

test('메모와 강사 공지는 같은 항목 ID여도 자원 ID가 다릅니다', () => {
  const note = resourceId(RESOURCE_TYPES.note, ID);
  const announcement = resourceId(RESOURCE_TYPES.announcement, ID);
  assert.equal(note, `note:${ID}`);
  assert.equal(announcement, `announcement:${ID}`);
  assert.notEqual(note, announcement);
  assert.notEqual(noteResourceId(), resourceId(RESOURCE_TYPES.announcement));
});

test('모르는 종류나 형식이 틀린 항목 ID는 자원 ID를 만들지 않습니다', () => {
  assert.equal(resourceId('role', ID), null);
  assert.equal(noteResourceId('not-a-uuid'), null);
  assert.equal(noteResourceId(['x']), null);
  assert.equal(noteResourceId(), 'note:collection');
});
