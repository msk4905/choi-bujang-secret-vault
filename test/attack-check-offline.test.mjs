import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 12,
  publicAppUrl: 'https://student-defense.vercel.app',
  identityProvider: { issuer: 'https://p.supabase.co/auth/v1', audience: 'authenticated' },
  originalApiUrl: 'https://p.supabase.co/rest/v1/notes',
};
const REQUEST_CHECKS = ['anonymous_note_read', 'static_marker_absent', 'anonymous_api_list', 'forged_token_list', 'anonymous_war_room', 'original_api_direct'];

test('bundleNetwork가 off이면 요청을 하나도 보내지 않고 요청 점검을 not_run으로 기록한다', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('요청이 보내지면 안 됨'); };
  try {
    const attempts = await runAttackChecks({ ...config, bundleNetwork: 'off' });
    assert.equal(calls, 0);
    assert.equal(new Set(attempts.map(item => item.attackId)).size, attempts.length);
    for (const id of REQUEST_CHECKS) assert.match(attempts.find(item => item.attackId === id).observed, /^미실행\(not_run\)/u);
    assert.ok(attempts.every(item => !/통과|HTTP \d{3}/u.test(item.observed)));
    assert.ok(attempts.every(item => item.expected.length <= 300 && item.observed.length <= 300));
  } finally {
    globalThis.fetch = original;
  }
});

test('설정이 없으면 지금까지처럼 실제 요청 결과를 기록한다', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const { pathname } = new URL(String(url));
    if (pathname === '/data.json') return new Response('{"notes":[]}', { status: 200 });
    if (pathname === '/aleph.json') return new Response('{}', { status: 200 });
    if (pathname === '/api/config') return new Response('{}', { status: 200 });
    return new Response('{}', { status: 401 });
  };
  try {
    const attempts = await runAttackChecks(config);
    assert.match(attempts.find(item => item.attackId === 'anonymous_api_list').observed, /HTTP 401로 거부됨 · 요청 ID /u);
    assert.match(attempts.find(item => item.attackId === 'anonymous_war_room').observed, /HTTP 401로 거부됨/u);
  } finally {
    globalThis.fetch = original;
  }
});
