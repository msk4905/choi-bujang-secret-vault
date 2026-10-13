import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restore } from '../scripts/policy-restore.mjs';

const NOW = Date.UTC(2026, 9, 13);
const rule = (ruleId, extra = {}) => ({ ruleId, srcip: '203.0.113.1', action: 'deny', confidence: 0.9,
  expiresAt: new Date(NOW + 3600e3).toISOString(), ...extra });
const policy = (rules) => JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules }, null, 2) + '\n';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const LOG = '2026-09-27T09:12:01+09:00 | block | bf-01 | 203.0.113.10 | 0.92 | 기존 감사 기록\n';

const V = policy([rule('xdr.brute-force.deny.a'), rule('xdr.web-injection.deny.b'), rule('xdr.brute-force.deny.c')]);
const OTHER = rule('xdr.other-service.deny.q', { srcip: '198.51.100.9' });
const CURRENT = policy([rule('xdr.brute-force.deny.a', { confidence: 0.1 }), OTHER, rule('xdr.web-injection.deny.test'), rule('xdr.web-injection.deny.b')]);

function setup({ verified = V, current = CURRENT, manifest = true, sha } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'policy-restore-'));
  mkdirSync(join(root, 'xdr'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'xdr/deny-rules.json'), verified);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'verified');
  const commit = git(root, 'rev-parse', '--short=7', 'HEAD');
  writeFileSync(join(root, 'xdr/deny-rules.json'), current);
  writeFileSync(join(root, 'xdr/alerts.log'), LOG);
  if (manifest) {
    writeFileSync(join(root, 'xdr/verified-policy.json'), JSON.stringify({
      schema: 'aleph.xdr.verified-policy.v1', file: 'xdr/deny-rules.json', commit,
      sha256: sha ?? createHash('sha256').update(verified).digest('hex'),
    }));
  }
  return root;
}
const read = (root, file) => readFileSync(join(root, file), 'utf8');
const codeOf = (text) => text.match(/--confirm ([0-9a-f]{12})/u)?.[1];

test('미리보기는 복원 버전·변경 범위·확인 코드를 보여 주고 아무것도 쓰지 않는다', () => {
  const root = setup();
  const result = restore(root, { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.match(result.text, /복원할 검증본: 커밋 [0-9a-f]{7}/u);
  assert.match(result.text, /다시 생길 규칙 1 · 사라질 규칙 1 · 내용이 바뀔 규칙 1/u);
  assert.match(result.text, /그대로 둘 다른 모듈 규칙: 1개/u);
  assert.match(result.text, /\+ 다시 생김\s+xdr\.brute-force\.deny\.c/u);
  assert.match(result.text, /- 사라짐\s+xdr\.web-injection\.deny\.test/u);
  assert.ok(codeOf(result.text));
  assert.equal(read(root, 'xdr/deny-rules.json'), CURRENT);
  assert.equal(read(root, 'xdr/alerts.log'), LOG);
});

test('확인 코드 없이 또는 틀린 코드로 --apply하면 중단하고 쓰지 않는다', () => {
  const root = setup();
  for (const confirm of [null, '000000000000']) {
    const result = restore(root, { apply: true, confirm, now: NOW });
    assert.equal(result.ok, false);
    assert.match(result.text, /^중단: 확인 코드/u);
  }
  assert.equal(read(root, 'xdr/deny-rules.json'), CURRENT);
  assert.equal(read(root, 'xdr/alerts.log'), LOG);
});

test('맞는 코드로 적용하면 검증본 모듈만 되돌리고 다른 모듈 규칙과 감사 이력은 보존한다', () => {
  const root = setup();
  const code = codeOf(restore(root, { now: NOW }).text);
  const result = restore(root, { apply: true, confirm: code, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  const after = JSON.parse(read(root, 'xdr/deny-rules.json'));
  const ids = after.rules.map((r) => r.ruleId).sort();
  assert.deepEqual(ids, ['xdr.brute-force.deny.a', 'xdr.brute-force.deny.c', 'xdr.other-service.deny.q', 'xdr.web-injection.deny.b']);
  assert.deepEqual(after.rules.find((r) => r.ruleId === 'xdr.other-service.deny.q'), OTHER);
  assert.equal(after.rules.find((r) => r.ruleId === 'xdr.brute-force.deny.a').confidence, 0.9);
  const log = read(root, 'xdr/alerts.log');
  assert.ok(log.startsWith(LOG));
  const added = log.slice(LOG.length).trim().split('\n');
  assert.equal(added.length, 1);
  assert.match(added[0], / \| restore \| policy-restore \| - \| 1 \| 검증본 [0-9a-f]{7}로 복원: 생김 1, 사라짐 1, 바뀜 1/u);
  assert.equal(existsSync(join(root, 'xdr/deny-rules.json.restore-tmp')), false);
  const again = restore(root, { now: NOW });
  assert.match(again.text, /되돌릴 것이 없습니다/u);
});

test('미리보기 뒤에 파일이 바뀌면 코드가 달라져 중단한다', () => {
  const root = setup();
  const code = codeOf(restore(root, { now: NOW }).text);
  const changed = policy([rule('xdr.brute-force.deny.zz')]);
  writeFileSync(join(root, 'xdr/deny-rules.json'), changed);
  const result = restore(root, { apply: true, confirm: code, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(read(root, 'xdr/deny-rules.json'), changed);
});

test('검증본 기록이 없거나 해시가 다르면 중단하고 코드를 만들지 않는다', () => {
  for (const options of [{ manifest: false }, { sha: 'a'.repeat(64) }]) {
    const root = setup(options);
    const result = restore(root, { apply: true, confirm: '000000000000', now: NOW });
    assert.equal(result.ok, false);
    assert.match(result.text, /^중단: /u);
    assert.doesNotMatch(result.text, /--confirm/u);
    assert.equal(read(root, 'xdr/deny-rules.json'), CURRENT);
    assert.equal(read(root, 'xdr/alerts.log'), LOG);
  }
});

test('차이가 없으면 --apply여도 아무것도 쓰지 않는다', () => {
  const root = setup({ current: V });
  const result = restore(root, { apply: true, confirm: null, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.applied, false);
  assert.equal(read(root, 'xdr/alerts.log'), LOG);
});

test('이미 만료된 검증본 규칙은 미리보기에서 알려 준다', () => {
  const root = setup({ current: policy([OTHER]) });
  const result = restore(root, { now: NOW + 2 * 3600e3 });
  assert.match(result.text, /이미 만료 시각이 지났습니다/u);
});
