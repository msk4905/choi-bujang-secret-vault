import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { respond as bruteForce } from '../xdr/brute-force/respond.mjs';
import { respond as webInjection } from '../xdr/web-injection/respond.mjs';

// 임시 폴더의 규칙 파일·기록 파일만 씁니다. 실제 xdr/deny-rules.json과 xdr/alerts.log는 건드리지 않습니다.
const fixture = (name) => JSON.parse(readFileSync(new URL(`../xdr/fixtures/${name}.json`, import.meta.url), 'utf8')).alerts;
const NOW = Date.parse('2026-10-13T00:00:00Z');
const read = (file) => JSON.parse(readFileSync(file, 'utf8')).rules;
const ids = (rules) => rules.map((rule) => rule.ruleId).sort();

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'xdr-merge-'));
  return { rulesFile: join(dir, 'deny-rules.json'), logFile: join(dir, 'alerts.log') };
}

test('무차별 로그인 규칙을 다시 만들어도 같은 주소의 웹 주입 규칙은 남는다', async () => {
  const files = sandbox();
  await bruteForce(fixture('brute-force'), NOW, files);
  await webInjection(fixture('web-injection'), NOW, files);
  const before = ids(read(files.rulesFile));
  assert.ok(before.includes('xdr.brute-force.deny.203.0.113.10'));
  assert.ok(before.includes('xdr.web-injection.deny.203.0.113.10'));
  await bruteForce(fixture('brute-force'), NOW + 1000, files);
  assert.deepEqual(ids(read(files.rulesFile)), before);
  await webInjection(fixture('web-injection'), NOW + 2000, files);
  assert.deepEqual(ids(read(files.rulesFile)), before);
});

test('다른 모듈 규칙은 만료됐어도 지우지 않고, 내 규칙의 만료분만 버린다', async () => {
  const files = sandbox();
  const stale = (ruleId, srcip) => ({ ruleId, srcip, action: 'deny', evidenceAlertIds: ['x'], confidence: 0.9, reason: 'r',
    createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-01T01:00:00.000Z' });
  const other = stale('xdr.other-service.deny.198.51.100.99', '198.51.100.99');
  writeFileSync(files.rulesFile, JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules: [other, stale('xdr.brute-force.deny.192.0.2.250', '192.0.2.250')] }));
  await bruteForce(fixture('brute-force'), NOW, files);
  const rules = read(files.rulesFile);
  assert.deepEqual(rules.find((rule) => rule.ruleId === other.ruleId), other);
  assert.equal(rules.some((rule) => rule.ruleId === 'xdr.brute-force.deny.192.0.2.250'), false);
});

test('경보 기록은 지우지 않고 덧붙이며, 다시 실행해도 같은 경보를 중복해 쌓지 않는다', async () => {
  const files = sandbox();
  writeFileSync(files.logFile, '기존 감사 기록 한 줄\n');
  await bruteForce(fixture('brute-force'), NOW, files);
  const first = readFileSync(files.logFile, 'utf8');
  assert.ok(first.startsWith('기존 감사 기록 한 줄\n'));
  await bruteForce(fixture('brute-force'), NOW + 1000, files);
  assert.equal(readFileSync(files.logFile, 'utf8'), first);
});
