import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const ID = '11111111-1111-4111-8111-111111111111';
const base = () => fixtureRequests().normal;
const req = (method, path, extra = {}) => ({
  ...base(), requestId: randomUUID(), method, route: `${method} ${path.replace(ID, ':id').replace(/\/demo$/u, '/:id')}`, path, ...extra,
});

test('등록 기기의 메모 한 건 읽기·수정은 허용합니다', async () => {
  for (const method of ['GET', 'PUT']) {
    const out = await decide(req(method, `/notes/${ID}`));
    assert.equal(out.decision, 'allow');
    assert.ok(out.ruleIds.includes('zone_notes_own_route'));
  }
});

test('자기 메모의 정상 읽기는 계약 예시·앱 경로·목록 모두 허용합니다', async () => {
  const ok = [
    req('GET', '/notes/demo'), req('PUT', '/notes/demo'), req('GET', `/api/notes/${ID}`),
    req('PUT', `/api/notes/${ID}`),
  ];
  for (const request of ok) assert.equal((await decide(request)).decision, 'allow', `${request.method} ${request.path}`);
  assert.equal((await decide(base())).decision, 'allow');
});

test('메모 전체 목록과 공지·강사 자료 쓰기는 거부합니다', async () => {
  const bad = [
    req('GET', '/notes', { route: 'GET /notes' }), req('GET', '/api/notes', { route: 'GET /api/notes' }),
    req('POST', '/api/notes', { route: 'POST /api/notes' }),
    ...['POST', 'PUT', 'PATCH', 'DELETE'].flatMap(method => [
      req(method, `/announcements/${ID}`), req(method, '/announcements', { route: `${method} /announcements` }),
      req(method, `/api/announcements/${ID}`), req(method, `/instructor/${ID}`)]),
  ];
  for (const request of bad) {
    const out = await decide(request);
    assert.equal(out.decision, 'deny', `${request.method} ${request.path}`);
    assert.equal(out.reasonCode, 'zone_not_allowed');
  }
});

test('강사 공지 수정은 강사 확인 값이 계약에 없어 거부합니다', async () => {
  const out = await decide(req('PUT', `/announcements/${ID}`));
  assert.deepEqual([out.decision, out.reasonCode, out.ruleIds], ['deny', 'zone_not_allowed', ['zone_announcement_edit']]);
  assert.equal((await decide(req('GET', `/announcements/${ID}`))).decision, 'deny');
});

test('표에 없는 경로·메서드·깊이·export·쿼리는 거부합니다', async () => {
  const bad = [
    req('GET', '/notes/export', { route: 'GET /notes/:id' }),
    req('GET', `/notes/${ID}/export`, { route: 'GET /notes/:id/export' }),
    req('DELETE', `/notes/${ID}`),
    req('POST', '/notes', { route: 'POST /notes' }),
    req('GET', '/admin', { route: 'GET /admin' }),
    req('GET', `/notes/${ID}`, { route: 'PUT /notes/:id' }),
    req('GET', `/notes/${ID}`, { queryLength: 6 }),
    req('GET', `/notes/${ID}/`, { route: 'GET /notes/:id' }),
    { ...req('GET', `/notes/${ID}`), subjectId: '' },
    { ...req('GET', `/notes/${ID}`), deviceId: 'ZZ' },
  ];
  for (const request of bad) {
    const out = await decide(request);
    assert.equal(out.decision, 'deny', `${request.method} ${request.path}`);
    assert.equal(out.reasonCode, 'zone_not_allowed');
  }
});

test('이전 규칙은 그대로입니다', async () => {
  assert.equal((await decide({ ...base(), deviceRegistered: false })).reasonCode, 'device_not_registered');
  const { suspicious } = fixtureRequests();
  assert.equal((await decide(suspicious)).decision, 'step_up');
  assert.equal((await decide({ ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } })).decision, 'allow');
  for (const id of ['device_registered', 'step_up_required']) assert.ok(RULE_IDS.includes(id));
});
