import test from 'node:test';
import assert from 'node:assert/strict';
import { readEvents, detect } from '../src/detect.mjs';

const good = { at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture' } };

test('정상 사건은 at·method·subject 세 값만 남긴다', () => {
  const { events, skipped } = readEvents([{ ...good, body: 'memo text', token: 'x', name: 'real name', identity: { ...good.identity, email: 'a@b.c' } }]);
  assert.equal(skipped, 0);
  assert.deepEqual(events, [{ at: Date.parse(good.at), method: 'GET', subject: 'learner_fixture' }]);
  assert.deepEqual(Object.keys(events[0]), ['at', 'method', 'subject']);
});

test('형식이 틀린 사건은 값 없이 개수로만 센다', () => {
  const { events, skipped } = readEvents([good, null, {}, { ...good, at: 'bad' }, { ...good, method: 'get' },
    { ...good, identity: {} }, { ...good, identity: { sub: 'a b' } }]);
  assert.equal(events.length, 1);
  assert.equal(skipped, 6);
  assert.doesNotMatch(JSON.stringify({ events, skipped }), /memo|token|bad/u);
});

test('배열이 아니면 거부하고 detect는 아직 observe만 돌려준다', () => {
  assert.throws(() => readEvents('x'), /invalid_detection_events/u);
  assert.deepEqual(detect([good]), { action: 'observe' });
});
