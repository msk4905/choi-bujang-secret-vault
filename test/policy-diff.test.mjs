import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPolicies, run } from '../scripts/policy-diff.mjs';

const rule = (ruleId, extra = {}) => ({ ruleId, srcip: '203.0.113.1', action: 'deny', confidence: 0.9, ...extra });
const policy = (rules) => JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules }, null, 2) + '\n';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function setup({ verified, current, manifest = true, sha }) {
  const root = mkdtempSync(join(tmpdir(), 'policy-diff-'));
  mkdirSync(join(root, 'xdr'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.invalid');
  git(root, 'config', 'user.name', 't');
  writeFileSync(join(root, 'xdr/deny-rules.json'), verified);
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'verified');
  const commit = git(root, 'rev-parse', '--short=7', 'HEAD');
  writeFileSync(join(root, 'xdr/deny-rules.json'), current);
  if (manifest) {
    writeFileSync(join(root, 'xdr/verified-policy.json'), JSON.stringify({
      schema: 'aleph.xdr.verified-policy.v1', file: 'xdr/deny-rules.json', commit,
      sha256: sha ?? createHash('sha256').update(verified).digest('hex'),
    }));
  }
  return root;
}

const V = policy([rule('xdr.brute-force.deny.a'), rule('xdr.web-injection.deny.b'), rule('xdr.brute-force.deny.c')]);

test('차이는 복원할 버전과 변경 범위를 보여 주고 파일을 쓰지 않는다', () => {
  const current = policy([rule('xdr.brute-force.deny.a', { confidence: 0.1 }), rule('xdr.web-injection.deny.b'), rule('xdr.test.deny.z')]);
  const root = setup({ verified: V, current });
  const result = run(root);
  assert.equal(result.ok, true);
  assert.match(result.text, /복원할 검증본: 버전 \S+ · 커밋 [0-9a-f]{7} .*해시 일치/u);
  assert.match(result.text, /다시 생길 규칙 1 · 사라질 규칙 1 · 내용이 바뀔 규칙 1 · 그대로 1/u);
  assert.match(result.text, /\+ 다시 생김\s+xdr\.brute-force\.deny\.c/u);
  assert.match(result.text, /- 사라짐\s+xdr\.test\.deny\.z/u);
  assert.match(result.text, /~ 바뀜\s+xdr\.brute-force\.deny\.a \(confidence\)/u);
  assert.equal(readFileSync(join(root, 'xdr/deny-rules.json'), 'utf8'), current);
  assert.equal(git(root, 'status', '--porcelain', '--', 'xdr/deny-rules.json'), 'M xdr/deny-rules.json');
});

test('같으면 차이 없음으로 끝난다', () => {
  const result = run(setup({ verified: V, current: V }));
  assert.equal(result.ok, true);
  assert.match(result.text, /차이 없음/u);
});

test('검증본 기록이 없으면 중단하고 차이를 보여 주지 않는다', () => {
  const result = run(setup({ verified: V, current: V, manifest: false }));
  assert.equal(result.ok, false);
  assert.match(result.text, /^중단: 검증본 기록/u);
  assert.doesNotMatch(result.text, /다시 생김|사라짐/u);
});

test('해시가 다르면 중단한다', () => {
  const result = run(setup({ verified: V, current: V, sha: 'a'.repeat(64) }));
  assert.equal(result.ok, false);
  assert.match(result.text, /해시가 기록과 다릅니다/u);
});

test('가리키는 커밋에 사본이 없으면 중단한다', () => {
  const root = setup({ verified: V, current: V });
  const manifest = JSON.parse(readFileSync(join(root, 'xdr/verified-policy.json'), 'utf8'));
  writeFileSync(join(root, 'xdr/verified-policy.json'), JSON.stringify({ ...manifest, commit: 'deadbee' }));
  const result = run(root);
  assert.equal(result.ok, false);
  assert.match(result.text, /사본을 찾을 수 없습니다/u);
});

test('검증본 형식이 틀리면 해시가 맞아도 중단한다', () => {
  const broken = policy([rule('xdr.brute-force.deny.a', { action: 'allow' })]);
  const result = run(setup({ verified: broken, current: V }));
  assert.equal(result.ok, false);
  assert.match(result.text, /action이 deny가 아닌/u);
});

test('현재 정책이 깨져 있으면 중단한다', () => {
  const result = run(setup({ verified: V, current: '{깨진' }));
  assert.equal(result.ok, false);
  assert.match(result.text, /현재 시험 정책/u);
});

test('diffPolicies는 같은 규칙 이름이 다른 모듈에 걸치면 영향 모듈을 모은다', () => {
  const d = diffPolicies({ rules: [rule('xdr.brute-force.deny.a')] }, { rules: [rule('xdr.web-injection.deny.b')] });
  assert.deepEqual(d.touchedModules, ['xdr.brute-force', 'xdr.web-injection']);
});

test('검증본 기록의 버전 이름을 보여 주고, 형식이 틀린 버전이면 중단한다', () => {
  const root = setup({ verified: V, current: V });
  const manifest = JSON.parse(readFileSync(join(root, 'xdr/verified-policy.json'), 'utf8'));
  writeFileSync(join(root, 'xdr/verified-policy.json'), JSON.stringify({ ...manifest, version: 'safe-v1' }));
  const named = run(root);
  assert.equal(named.ok, true);
  assert.match(named.text, /복원할 검증본: 버전 safe-v1 · 커밋 [0-9a-f]{7}/u);
  assert.match(named.text, /바뀔 항목: 다시 생길 규칙 0/u);
  writeFileSync(join(root, 'xdr/verified-policy.json'), JSON.stringify({ ...manifest, version: '버전 1 !' }));
  const broken = run(root);
  assert.equal(broken.ok, false);
  assert.match(broken.text, /형식이 올바르지 않습니다/u);
});
