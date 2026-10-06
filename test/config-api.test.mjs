import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/config.js';

const call = (method, env) => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) if (env[k] === undefined) delete process.env[k];
  const out = { headers: {} };
  const response = {
    setHeader: (k, v) => { out.headers[k] = v; },
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  try { handler({ method }, response); } finally { process.env = saved; }
  return out;
};

test('설정이 없으면 503, GET이 아니면 405', () => {
  assert.equal(call('GET', {}).status, 503);
  assert.equal(call('POST', {}).status, 405);
});

test('공개 값 둘만 돌려주고 secret 값은 싣지 않는다', () => {
  const out = call('GET', {
    SUPABASE_URL: 'https://x.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy',
    SUPABASE_SECRET_KEY: 'dummy-secret',
  });
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.body).sort(), ['publishableKey', 'supabaseUrl']);
  assert.equal(JSON.stringify(out.body).includes('dummy-secret'), false);
});
