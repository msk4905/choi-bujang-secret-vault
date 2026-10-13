import test from 'node:test';
import assert from 'node:assert/strict';
import { readSignals, decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const EMPTY = { region: null, network: null, hour: null };

test('실제 경로의 none 출처는 값이 있어도 비웁니다', () => {
  const out = readSignals({ signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 } });
  assert.deepEqual(out, { origin: 'none', verified: false, ...EMPTY });
});

test('signals가 없거나 형식이 틀리면 정상값으로 채우지 않습니다', () => {
  for (const bad of [undefined, null, 'x', [], 7]) {
    assert.deepEqual(readSignals({ signals: bad }), { origin: 'unverified', verified: false, ...EMPTY });
  }
  assert.equal(readSignals(undefined).verified, false);
});

test('위조한 출처·헤더 값은 신뢰 정보로 올라가지 않습니다', () => {
  const forged = { signals: { source: 'x-forwarded-for', region: 'local', network: 'usual', hour: 14 },
    headers: { 'x-region': 'local', 'x-verified': 'true' }, trusted: true };
  assert.deepEqual(readSignals(forged), { origin: 'unverified', verified: false, ...EMPTY });
  assert.equal(readSignals({ signals: { source: 'judge_fixture', verified: true } }).verified, false);
});

test('judge_fixture는 연습용으로만 표시하고 verified는 false입니다', () => {
  const { normal } = fixtureRequests();
  assert.deepEqual(readSignals(normal), { origin: 'judge_fixture', verified: false,
    region: 'local', network: 'usual', hour: 14 });
  const odd = readSignals({ signals: { source: 'judge_fixture', region: 'UP PER', network: '', hour: 24 } });
  assert.deepEqual(odd, { origin: 'judge_fixture', verified: false, ...EMPTY });
  assert.equal(readSignals({ signals: { source: 'judge_fixture', hour: 3.5 } }).hour, null);
});

test('판정 결과는 이번 변경으로 달라지지 않습니다', async () => {
  const { normal } = fixtureRequests();
  assert.equal((await decide(normal)).decision, 'allow');
  assert.equal((await decide({ ...normal, deviceRegistered: false })).decision, 'deny');
});
