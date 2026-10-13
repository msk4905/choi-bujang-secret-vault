// 검증본 연습 거부 규칙(xdr/verified-policy.json이 가리키는 Git 사본)과 현재 xdr/deny-rules.json의 차이만 보여 줍니다.
// 읽기 전용입니다: 어떤 파일도 쓰지 않고 git은 읽기 명령만 부릅니다. 운영 정책에는 접근하지 않습니다.
// 사본이 없거나 검증에 실패하면 차이를 보여 주지 않고 중단합니다(종료 코드 1).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MANIFEST = 'xdr/verified-policy.json';
const POLICY_FILE = 'xdr/deny-rules.json';
const SCHEMA = 'aleph.xdr.deny-rules.v1';

export class PolicyCopyError extends Error {}

const fail = (message) => { throw new PolicyCopyError(message); };
const isRule = (rule) => Boolean(rule) && typeof rule === 'object' && !Array.isArray(rule)
  && typeof rule.ruleId === 'string' && rule.ruleId !== '' && rule.action === 'deny';

function parsePolicy(text, label) {
  let policy;
  try { policy = JSON.parse(text); } catch { fail(`${label}: JSON으로 읽을 수 없습니다.`); }
  if (policy?.schema !== SCHEMA || !Array.isArray(policy.rules)) fail(`${label}: 거부 규칙 형식(${SCHEMA})이 아닙니다.`);
  if (!policy.rules.every(isRule)) fail(`${label}: 규칙 이름(ruleId)이 없거나 action이 deny가 아닌 규칙이 있습니다.`);
  const names = policy.rules.map((rule) => rule.ruleId);
  if (new Set(names).size !== names.length) fail(`${label}: 같은 규칙 이름이 두 번 나옵니다.`);
  return policy;
}

// 검증본을 읽습니다. 하나라도 어긋나면 PolicyCopyError로 중단합니다.
export function loadVerified(root, git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) {
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')); } catch { fail(`검증본 기록(${MANIFEST})이 없거나 읽을 수 없습니다.`); }
  if (manifest?.schema !== 'aleph.xdr.verified-policy.v1' || manifest.file !== POLICY_FILE
      || typeof manifest.commit !== 'string' || !/^[0-9a-f]{7,40}$/u.test(manifest.commit)
      || typeof manifest.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(manifest.sha256)) {
    fail('검증본 기록 형식이 올바르지 않습니다.');
  }
  let text;
  try {
    git(['cat-file', '-e', `${manifest.commit}^{commit}`]);
    text = git(['show', `${manifest.commit}:${POLICY_FILE}`]);
  } catch { fail(`검증본 커밋 ${manifest.commit}에서 ${POLICY_FILE} 사본을 찾을 수 없습니다.`); }
  if (createHash('sha256').update(text).digest('hex') !== manifest.sha256) fail('검증본 사본의 해시가 기록과 다릅니다. 사본이 바뀌었을 수 있습니다.');
  return { commit: manifest.commit, sha256: manifest.sha256, policy: parsePolicy(text, `검증본 ${manifest.commit}`) };
}

export function loadCurrent(root) {
  let text;
  try { text = readFileSync(join(root, POLICY_FILE), 'utf8'); } catch { fail(`현재 시험 정책(${POLICY_FILE})이 없습니다.`); }
  return parsePolicy(text, '현재 시험 정책');
}

const moduleOf = (ruleId) => ruleId.split('.').slice(0, 2).join('.');
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 복원하면 생길 변화입니다. restore: 검증본에만 있어 다시 생길 규칙, remove: 현재에만 있어 사라질 규칙, change: 내용이 달라 검증본 값으로 바뀔 규칙.
export function diffPolicies(verified, current) {
  const now = new Map(current.rules.map((rule) => [rule.ruleId, rule]));
  const was = new Map(verified.rules.map((rule) => [rule.ruleId, rule]));
  const restore = [...was.keys()].filter((id) => !now.has(id));
  const remove = [...now.keys()].filter((id) => !was.has(id));
  const change = [...was.keys()].filter((id) => now.has(id) && !sameJson(was.get(id), now.get(id)))
    .map((id) => ({ ruleId: id, fields: [...new Set([...Object.keys(was.get(id)), ...Object.keys(now.get(id))])]
      .filter((key) => !sameJson(was.get(id)[key], now.get(id)[key])) }));
  const unchanged = [...was.keys()].filter((id) => now.has(id) && sameJson(was.get(id), now.get(id))).length;
  const touched = new Set([...restore, ...remove, ...change.map((item) => item.ruleId)].map(moduleOf));
  return { restore, remove, change, unchanged, touchedModules: [...touched].sort() };
}

export function report(loaded, current) {
  const diff = diffPolicies(loaded.policy, current);
  const lines = [
    `복원할 검증본: 커밋 ${loaded.commit} · ${POLICY_FILE} · sha256 ${loaded.sha256.slice(0, 12)}… (해시 일치)`,
    `비교 대상: 현재 시험 정책 ${POLICY_FILE} (규칙 ${current.rules.length}개)`,
    `변경 범위: 다시 생길 규칙 ${diff.restore.length} · 사라질 규칙 ${diff.remove.length} · 내용이 바뀔 규칙 ${diff.change.length} · 그대로 ${diff.unchanged}`,
    `영향받는 모듈: ${diff.touchedModules.length ? diff.touchedModules.join(', ') : '없음'}`,
  ];
  for (const id of diff.restore) lines.push(`  + 다시 생김  ${id}`);
  for (const id of diff.remove) lines.push(`  - 사라짐    ${id}`);
  for (const item of diff.change) lines.push(`  ~ 바뀜     ${item.ruleId} (${item.fields.join(', ')})`);
  if (!diff.restore.length && !diff.remove.length && !diff.change.length) lines.push('차이 없음: 현재 시험 정책이 검증본과 같습니다.');
  lines.push('이 명령은 비교만 하며 파일을 쓰지 않습니다. 운영 정책에는 접근하지 않습니다.');
  return lines.join('\n');
}

export function run(root) {
  try {
    const verified = loadVerified(root);
    return { ok: true, text: report(verified, loadCurrent(root)) };
  } catch (error) {
    if (error instanceof PolicyCopyError) return { ok: false, text: `중단: ${error.message}\n차이를 보여 주지 않았습니다.` };
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = run(join(dirname(fileURLToPath(import.meta.url)), '..'));
  (result.ok ? console.log : console.error)(result.text);
  process.exitCode = result.ok ? 0 : 1;
}
