import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, proposeRevocation } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
function reads(count, { network, device, registered = true, step = 2, start = START, unusualAt = [] } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * step * 1000).toISOString(), method: 'GET', identity: { sub: 'learner_fixture' },
    ...(network ? { network: unusualAt.includes(i) ? 'unusual' : 'usual' } : {}),
    ...(device ? { deviceId: typeof device === 'function' ? device(i) : device, deviceRegistered: registered } : {}),
  }));
}
const proposal = { action: 'propose_revocation', reasonCode: 'burst_unusual_network', subject: 'learner_fixture', deviceId: 'device_fixture_1' };

test('복합 의심 + 확인된 기기 한 개 → 대상·이유가 있는 회수 제안', () => {
  const events = reads(121, { network: true, device: 'device_fixture_1', unusualAt: [60] });
  assert.deepEqual(proposeRevocation(events), proposal);
  assert.deepEqual(Object.keys(proposeRevocation(events)).sort(), ['action', 'deviceId', 'reasonCode', 'subject']);
  assert.equal(detect(events).action, 'flag_suspicious');
});
test('정상 사건은 회수 제안을 내지 않는다', () => {
  assert.deepEqual(proposeRevocation(reads(30, { device: 'device_fixture_1' })), { action: 'observe' });
  assert.deepEqual(proposeRevocation(reads(120, { network: true, device: 'device_fixture_1', unusualAt: [1] })), { action: 'observe' });
  assert.deepEqual(proposeRevocation(reads(200, { device: 'device_fixture_1' })), { action: 'observe' });
  assert.deepEqual(proposeRevocation(reads(10, { network: true, device: 'device_fixture_1', unusualAt: [1] })), { action: 'observe' });
});
test('기기를 확인할 수 없으면 의심이어도 제안하지 않는다', () => {
  const none = reads(121, { network: true, unusualAt: [60] });
  assert.deepEqual(proposeRevocation(none), { action: 'observe' });
  assert.deepEqual(proposeRevocation(reads(121, { network: true, device: 'device_fixture_1', registered: false, unusualAt: [60] })), { action: 'observe' });
  assert.equal(detect(none).action, 'flag_suspicious');
});
test('기기가 둘 이상이면 하나로 고르지 않고 제안하지 않는다', () => {
  const two = reads(121, { network: true, device: i => (i % 2 ? 'device_fixture_1' : 'device_fixture_2'), unusualAt: [60] });
  assert.deepEqual(proposeRevocation(two), { action: 'observe' });
});
test('제안에 시각·토큰·메모 값이 없다', () => {
  const out = JSON.stringify(proposeRevocation(reads(121, { network: true, device: 'device_fixture_1', unusualAt: [60] })));
  assert.doesNotMatch(out, /token|body|\d{4}-\d\d-\d\dT/u);
});
