import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';

const config = {
  step: 2,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const stepOne = { ...config, step: 1, sampleMarker: 'SAMPLE_NOTE_1' };
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, stepOne), {
    schema: 'aleph.defense.deployment.v1',
    step: 1,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: stepOne.sampleMarker,
  });
  const second = deploymentIdentity(env, config);
  assert.equal(second.step, 2);
  assert.equal('sampleMarker' in second, false);
  assert.equal(JSON.stringify(second).includes('SAMPLE_NOTE_1'), false);
  const third = deploymentIdentity(env, { ...config, step: 3 });
  assert.equal(third.step, 3);
  assert.equal('sampleMarker' in third, false);
  const fourth = deploymentIdentity(env, { ...config, step: 4 });
  assert.equal(fourth.step, 4);
  assert.equal('sampleMarker' in fourth, false);
  assert.throws(() => deploymentIdentity(env, { ...config, step: 5 }));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const withFetch = async (routes, run) => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), redirect: init?.redirect });
      return routes[new URL(String(url)).pathname]();
    };
    return await run(seen);
  } finally {
    globalThis.fetch = originalFetch;
  }
};
const clean = { '/data.json': () => json({ notes: [] }), '/aleph.json': () => json({ step: 2 }) };

test('attack check reads static files without credentials and finds no memos or marker', async () => {
  await withFetch(clean, async (seen) => {
    const [notes, marker] = await runAttackChecks(config);
    assert.deepEqual(seen.map(item => item.url), [
      'https://student-defense.vercel.app/data.json',
      'https://student-defense.vercel.app/aleph.json',
    ]);
    assert.ok(seen.every(item => item.redirect === 'error'));
    assert.match(notes.observed, /가상 메모가 보이지 않음/u);
    assert.match(marker.observed, /확인 표시가 보이지 않음/u);
  });
});

test('attack check reports memos or the starter marker that are still visible', async () => {
  await withFetch({ ...clean, '/data.json': () => json({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }) }, async () => {
    const [notes, marker] = await runAttackChecks(config);
    assert.match(notes.observed, /가상 메모가 아직 보임/u);
    assert.match(marker.observed, /확인 표시가 아직 보임/u);
  });
  await withFetch({ ...clean, '/aleph.json': () => json({ sampleMarker: 'SAMPLE_NOTE_1' }) }, async () => {
    const [, marker] = await runAttackChecks(config);
    assert.match(marker.observed, /확인 표시가 아직 보임/u);
  });
});

test('attack check treats a missing data.json as no memos and bad JSON as unknown', async () => {
  await withFetch({ ...clean, '/data.json': () => new Response('', { status: 404 }) }, async () => {
    const [notes] = await runAttackChecks(config);
    assert.match(notes.observed, /가상 메모가 보이지 않음/u);
  });
  await withFetch({ ...clean, '/data.json': () => new Response('<html>x</html>', { status: 200 }) }, async () => {
    const [notes] = await runAttackChecks(config);
    assert.match(notes.observed, /형식을 확인할 수 없음/u);
  });
});

test('3단계 점검은 토큰 없는 요청과 위조 토큰의 거부 여부를 상태 코드로만 기록한다', async () => {
  const step3 = { ...config, step: 3, identityProvider: { issuer: 'https://p.supabase.co/auth/v1', audience: 'authenticated' } };
  const sent = [];
  const originalFetch = globalThis.fetch;
  try {
    for (const respond of [() => new Response('{"error":"UNAUTHENTICATED"}', { status: 401 }),
      () => new Response('[{"title":"비밀"}]', { status: 200 })]) {
      sent.length = 0;
      globalThis.fetch = async (url, init) => {
        const { pathname } = new URL(String(url));
        sent.push({ method: init?.method ?? 'GET', pathname, auth: init?.headers?.Authorization });
        if (pathname === '/data.json') return json({ notes: [] });
        if (pathname === '/aleph.json') return json({ step: 3 });
        return respond();
      };
      const attempts = await runAttackChecks(step3);
      const api = attempts.filter(item => /^(anonymous_api|forged)/u.test(item.attackId));
      assert.equal(api.length, 5);
      const rejected = respond().status === 401;
      assert.ok(api.every(item => item.observed.includes(rejected ? '401로 거부됨' : 'HTTP 200로 응답해')));
      assert.equal(attempts.at(-1).attackId, 'normal_login_crud');
      assert.match(attempts.at(-1).observed, /^미실행/u);
      assert.deepEqual(sent.filter(item => item.pathname.startsWith('/api')).map(item => item.method),
        ['GET', 'POST', 'PUT', 'DELETE', 'GET']);
      assert.ok(sent.filter(item => item.auth).length === 1);
      assert.equal(JSON.stringify(attempts).includes('비밀'), false);
      assert.equal(JSON.stringify(attempts).includes('eyJ'), false);
    }
    globalThis.fetch = async (url) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/data.json') return json({ notes: [] });
      if (pathname === '/aleph.json') return json({ step: 3 });
      throw new Error('offline');
    };
    const offline = await runAttackChecks(step3);
    assert.match(offline.find(item => item.attackId === 'anonymous_api_list').observed, /요청을 보내지 못함/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('4단계 점검은 A·B 로그인이 필요한 소유자 시험을 실행하지 않고 미실행으로 남긴다', async () => {
  const step4 = { ...config, step: 4, identityProvider: { issuer: 'https://p.supabase.co/auth/v1', audience: 'authenticated' } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      const { pathname } = new URL(String(url));
      if (pathname === '/data.json') return json({ notes: [] });
      if (pathname === '/aleph.json') return json({ step: 4 });
      return new Response('{"error":"UNAUTHENTICATED"}', { status: 401 });
    };
    const attempts = await runAttackChecks(step4);
    const cross = attempts.find(item => item.attackId === 'cross_owner_access');
    assert.match(cross.observed, /^미실행/u);
    assert.equal(attempts.at(-1).attackId, 'normal_login_crud');
    assert.equal(new Set(attempts.map(item => item.attackId)).size, attempts.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
