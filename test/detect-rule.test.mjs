import test from 'node:test';
import assert from 'node:assert/strict';
import { flagSuspicious as detect } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
function reads(count, { owner = 'learner_fixture', network, region, step = 2, start = START, unusualAt = [] } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(start + i * step * 1000).toISOString(), method: 'GET', identity: { sub: owner },
    ...(network ? { network: unusualAt.length === 0 || unusualAt.includes(i) ? network : 'usual' } : {}),
    ...(region ? { region } : {}),
  }));
}
const flagged = { action: 'flag_suspicious', reasonCode: 'burst_unusual_network', subject: 'learner_fixture' };

test('복합: 121건 다량 조회 + 낯선 네트워크만 의심 표시', () => {
  assert.deepEqual(detect(reads(121, { network: 'unusual', unusualAt: [60] })), flagged);
});
test('정상 사건은 그대로 observe', () => {
  assert.deepEqual(detect(reads(30)), { action: 'observe' });
  assert.deepEqual(detect(reads(120, { network: 'unusual' })), { action: 'observe' });
  assert.deepEqual(detect(reads(200, { network: 'usual' })), { action: 'observe' });
});
test('다량 조회만 또는 낯선 네트워크만으로는 표시하지 않음', () => {
  assert.deepEqual(detect(reads(200)), { action: 'observe' });
  assert.deepEqual(detect(reads(10, { network: 'unusual' })), { action: 'observe' });
});
test('지역 하나만으로는 표시하지 않음', () => {
  assert.deepEqual(detect(reads(200, { region: 'far_region' })), { action: 'observe' });
  assert.deepEqual(detect(reads(10, { region: 'far_region' })), { action: 'observe' });
});
test('다른 사용자 합산·10분 밖 흩어진 조회는 표시하지 않음', () => {
  const mixed = [...reads(100, { network: 'unusual' }), ...reads(100, { owner: 'other_fixture' })];
  assert.deepEqual(detect(mixed), { action: 'observe' });
  assert.deepEqual(detect(reads(200, { network: 'unusual', step: 7 })), { action: 'observe' });
});
test('낯선 네트워크 사건이 다량 구간 밖이면 표시하지 않음', () => {
  const far = reads(121, { network: 'usual' }).concat(reads(1, { network: 'unusual', start: START + 3600 * 1000 }));
  assert.deepEqual(detect(far), { action: 'observe' });
});
