import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
function reads(count, { owner = 'learner_fixture', step = 2, device } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    at: new Date(START + i * step * 1000).toISOString(), method: 'GET', identity: { sub: owner },
    ...(device ? { deviceId: device, deviceRegistered: true } : {}),
  }));
}
const proposal = { action: 'propose_revocation', reasonCode: 'burst_read', subject: 'learner_fixture' };

test('계약 모양의 121건·200건은 대상과 이유가 있는 회수 제안을 낸다', () => {
  assert.deepEqual(detect(reads(121)), proposal);
  assert.deepEqual(detect(reads(200)), proposal);
});
test('정상 사건은 제안을 내지 않는다', () => {
  assert.deepEqual(detect(reads(30)), { action: 'observe' });
  assert.deepEqual(detect(reads(120)), { action: 'observe' });
  assert.deepEqual(detect([...reads(100), ...reads(100, { owner: 'other_fixture' })]), { action: 'observe' });
  assert.deepEqual(detect(reads(200, { step: 7 })), { action: 'observe' });
});
test('등록 기기 한 개가 확인되면 그 기기를 대상에 덧붙인다', () => {
  assert.deepEqual(detect(reads(121, { device: 'device_fixture_1' })), { ...proposal, deviceId: 'device_fixture_1' });
});
