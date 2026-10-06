import test from 'node:test';
import assert from 'node:assert/strict';
import route from '../api/notes.js';

const call = async (method, url, env) => {
  const saved = { ...process.env };
  for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']) delete process.env[k];
  Object.assign(process.env, env);
  const out = { headers: {} };
  const response = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
    end() { return this; },
  };
  try { await route({ method, url, headers: {} }, response); } finally { process.env = saved; }
  return out;
};

test('설정이 없으면 503, GET이 아니면 405', async () => {
  assert.equal((await call('GET', '/api/notes?config=1', {})).status, 503);
  assert.equal((await call('POST', '/api/notes?config=1', {})).status, 405);
});

test('공개 값 둘만 돌려주고 secret 값은 싣지 않는다', async () => {
  const out = await call('GET', '/api/notes?config=1', {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy',
    SUPABASE_SECRET_KEY: 'dummy-secret',
  });
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.body).sort(), ['publishableKey', 'supabaseUrl']);
  assert.equal(JSON.stringify(out.body).includes('dummy-secret'), false);
});

test('config 없는 요청은 기존처럼 로그인 검사로 간다(토큰 없으면 401 또는 설정 없음 503, 자료 없음)', async () => {
  const out = await call('GET', '/api/notes', { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'dummy' });
  assert.ok([401, 503].includes(out.status));
  assert.equal(JSON.stringify(out.body ?? {}).includes('publishableKey'), false);
});
