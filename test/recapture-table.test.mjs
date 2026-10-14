import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTable, renderMarkdown } from '../scripts/recapture-table.mjs';

// 가짜 fetch만 씁니다. 실제 서버·실제 계정·실제 토큰은 쓰지 않습니다.
const config = { identityProvider: { issuer: 'https://idp.example/auth/v1', audience: 'authenticated' }, originalApiUrl: 'https://db.example/rest/v1/notes' };
const base = new URL('https://app.example/');
const TOKEN = 'secret-token-value-for-test';
const TOKEN_B = 'secret-token-b-for-test';
const PASSWORD = 'pw-for-test-only';
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function fakeFetch({ war = 401, calls = [] } = {}) {
  return async (url, init = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    const method = init.method ?? 'GET';
    calls.push({ method, path, auth: init.headers?.Authorization });
    const reply = (status, body = '') => ({ status, ok: status < 300, headers: new Map([['x-vercel-id', 'test::id']]), text: async () => body, json: async () => JSON.parse(body) });
    if (url === config.originalApiUrl) return reply(401, '{}');
    if (path === '/' ) return reply(200, 'ok');
    if (path === '/data.json') return reply(200, JSON.stringify({ notes: [] }));
    if (path === '/api/config') return reply(200, JSON.stringify({ publishableKey: 'sb_publishable_test' }));
    if (path.startsWith('/auth/v1/token')) return reply(200, JSON.stringify({ access_token: JSON.parse(init.body).email.startsWith('b@') ? TOKEN_B : TOKEN }));
    if (path === '/api/war-room') return reply(init.headers?.Authorization ? 200 : war, '{}');
    if (path === '/api/notes/restore') return reply(method === 'GET' ? 405 : 401, '{}');
    if (!init.headers?.Authorization) return reply(401, '{}');
    if (method === 'POST' && path === '/api/notes') return reply(201, JSON.stringify({ id: '44444444-4444-4444-8444-444444444444' }));
    if (init.headers.Authorization === `Bearer ${TOKEN}` && method === 'GET' && path === '/api/notes') return reply(200, '[]');
    return reply(method === 'DELETE' && init.headers.Authorization === `Bearer ${TOKEN}` ? 204 : 404, '{}');
  };
}
const local = {
  decide: async req => ({ requestId: req.requestId, decision: 'allow', reasonCode: 'approved' }),
  fixtureRequests: () => ({ normal: { requestId: 'x', method: 'GET', route: 'r', path: '/p' }, suspicious: { requestId: 'y' } }),
  detect: async () => ({ action: 'observe' }),
};

test('로그인 정보가 없으면 로그인 줄은 미실행이고 41종은 통과 처리하지 않는다', async () => {
  const rows = await buildTable({ base: base.href, config, fetchImpl: fakeFetch(), newId, local });
  const login = rows.filter(row => row.request.includes('A 토큰'));
  assert.ok(login.length >= 6 && login.every(row => row.verdict === '미실행' && row.requestId === '해당 없음'));
  const all = rows.find(row => row.step === '전체');
  assert.equal(all.verdict, '미실행');
  assert.equal(rows.some(row => /통과/u.test(row.verdict)), false);
});

test('기대와 다른 실제 응답은 불일치로 남고, 일치로 바꾸지 않는다', async () => {
  const rows = await buildTable({ base: base.href, config, fetchImpl: fakeFetch({ war: 404 }), newId, local });
  const war = rows.find(row => row.request === '토큰 없는 GET /api/war-room');
  assert.deepEqual([war.actual, war.verdict], ['HTTP 404', '불일치']);
});

test('가상 연습의 불일치도 숨기지 않는다', async () => {
  const bad = { ...local, detect: async () => ({ action: 'propose_revocation' }) };
  const rows = await buildTable({ base: base.href, config, fetchImpl: fakeFetch(), newId, local: bad });
  assert.equal(rows.find(row => row.step === '9' && row.kind === '정상').verdict, '불일치');
});

test('시험 계정이 있으면 정상·금지 줄이 모두 실제 요청이 되고 시험 메모를 정리한다', async () => {
  const calls = [];
  const env = { ALEPH_A_EMAIL: 'a@test.invalid', ALEPH_A_PASSWORD: PASSWORD, ALEPH_B_EMAIL: 'b@test.invalid', ALEPH_B_PASSWORD: PASSWORD };
  const rows = await buildTable({ base: base.href, config, env, fetchImpl: fakeFetch({ calls }), newId, local });
  const cross = rows.filter(row => row.step === '4·8');
  assert.equal(cross.length, 3);
  assert.ok(cross.every(row => row.verdict === '일치' && row.actual === 'HTTP 404'));
  const cleanup = rows.find(row => row.request.includes('시험 메모 정리'));
  assert.deepEqual([cleanup.actual, cleanup.verdict], ['HTTP 204', '일치']);
  assert.ok(calls.some(call => call.method === 'DELETE' && call.path.endsWith('44444444-4444-4444-8444-444444444444')));
});

test('표와 JSON에는 토큰·비밀번호·이메일이 없다', async () => {
  const env = { ALEPH_A_EMAIL: 'a@test.invalid', ALEPH_A_PASSWORD: PASSWORD, ALEPH_B_EMAIL: 'b@test.invalid', ALEPH_B_PASSWORD: PASSWORD };
  const rows = await buildTable({ base: base.href, config, env, fetchImpl: fakeFetch(), newId, local });
  const text = renderMarkdown(rows, { base: base.origin, generatedAt: 'now' }) + JSON.stringify(rows);
  for (const secret of [TOKEN, TOKEN_B, PASSWORD, 'a@test.invalid', 'b@test.invalid', 'sb_publishable_test']) assert.equal(text.includes(secret), false, secret);
});
