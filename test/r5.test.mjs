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
  assert.throws(() => deploymentIdentity(env, { ...config, step: 3 }));
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
