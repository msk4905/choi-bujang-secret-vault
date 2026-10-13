// 검증본 연습 거부 규칙으로 현재 xdr/deny-rules.json을 되돌립니다. 운영 정책에는 접근하지 않습니다.
// 기본 실행은 바뀔 항목을 보여 주는 미리보기이고 아무것도 쓰지 않습니다.
// 쓰려면 미리보기가 알려 준 확인 코드를 --apply --confirm <코드>로 되돌려 줘야 합니다. 그 사이 파일이 바뀌면 코드가 달라져 중단됩니다.
// 되돌리는 범위는 검증본에 들어 있는 모듈(xdr.brute-force 같은 규칙 이름 앞 두 칸)뿐입니다. 다른 모듈 규칙은 그대로 두고,
// xdr/alerts.log는 지우거나 고치지 않고 되돌림 기록 한 줄만 덧붙입니다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PolicyCopyError, loadVerified, moduleOf } from './policy-diff.mjs';

const POLICY_FILE = 'xdr/deny-rules.json';
const AUDIT_LOG = 'xdr/alerts.log';
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function readCurrent(root) {
  let text;
  try { text = readFileSync(join(root, POLICY_FILE), 'utf8'); } catch { throw new PolicyCopyError(`현재 시험 정책(${POLICY_FILE})이 없습니다.`); }
  let policy;
  try { policy = JSON.parse(text); } catch { throw new PolicyCopyError('현재 시험 정책: JSON으로 읽을 수 없습니다.'); }
  if (policy?.schema !== 'aleph.xdr.deny-rules.v1' || !Array.isArray(policy.rules)
      || !policy.rules.every((rule) => typeof rule?.ruleId === 'string' && rule.ruleId !== '')) {
    throw new PolicyCopyError('현재 시험 정책: 거부 규칙 형식이 아닙니다.');
  }
  return { text, policy };
}

// 바뀔 항목 계산. 순수 함수라 쓰기 전에 몇 번이든 부를 수 있습니다.
export function planRestore(verified, current, now = Date.now()) {
  const scope = new Set(verified.rules.map((rule) => moduleOf(rule.ruleId)));
  const was = new Map(verified.rules.map((rule) => [rule.ruleId, rule]));
  const have = new Map(current.rules.map((rule) => [rule.ruleId, rule]));
  const restore = [...was.keys()].filter((id) => !have.has(id));
  const remove = current.rules.filter((rule) => scope.has(moduleOf(rule.ruleId)) && !was.has(rule.ruleId)).map((rule) => rule.ruleId);
  const change = [...was.keys()].filter((id) => have.has(id) && !sameJson(was.get(id), have.get(id)));
  const preserved = current.rules.filter((rule) => !scope.has(moduleOf(rule.ruleId)));
  const nextRules = [
    ...current.rules.flatMap((rule) => {
      if (!scope.has(moduleOf(rule.ruleId))) return [rule];
      return was.has(rule.ruleId) ? [was.get(rule.ruleId)] : [];
    }),
    ...restore.map((id) => was.get(id)),
  ];
  const expired = [...restore, ...change].filter((id) => Date.parse(was.get(id).expiresAt) <= now);
  return { scope: [...scope].sort(), restore, remove, change, preserved: preserved.map((rule) => rule.ruleId), expired,
    nextRules, noop: !restore.length && !remove.length && !change.length };
}

// 확인 코드: 검증본 해시 + 지금 파일 내용 + 바뀔 항목 목록. 하나라도 달라지면 코드가 달라집니다.
export function confirmCode(loaded, currentText, plan) {
  const body = JSON.stringify([loaded.sha256, createHash('sha256').update(currentText).digest('hex'), plan.restore, plan.remove, plan.change]);
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

function dirtyWarning(root) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--', POLICY_FILE], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() ? `주의: ${POLICY_FILE}에 커밋되지 않은 변경이 있어, 적용하면 Git으로도 복구할 수 없습니다.` : null;
  } catch { return null; }
}

export function previewText(loaded, plan, code, warning) {
  const lines = [
    `복원할 검증본: 버전 ${loaded.version} · 커밋 ${loaded.commit} · ${POLICY_FILE} · sha256 ${loaded.sha256.slice(0, 12)}… (해시 일치)`,
    `되돌리는 범위: ${plan.scope.join(', ')} 모듈의 규칙만`,
    `바뀔 항목: 다시 생길 규칙 ${plan.restore.length} · 사라질 규칙 ${plan.remove.length} · 내용이 바뀔 규칙 ${plan.change.length}`,
    `그대로 둘 다른 모듈 규칙: ${plan.preserved.length}개 · ${AUDIT_LOG}: 지우지 않고 되돌림 기록 한 줄만 덧붙임`,
  ];
  for (const id of plan.restore) lines.push(`  + 다시 생김  ${id}`);
  for (const id of plan.remove) lines.push(`  - 사라짐    ${id}`);
  for (const id of plan.change) lines.push(`  ~ 바뀜     ${id}`);
  if (plan.expired.length) lines.push(`알림: 되돌릴 규칙 ${plan.expired.length}개는 검증본에서 이미 만료 시각이 지났습니다. 복원해도 만료된 규칙은 맞지 않습니다.`);
  if (warning) lines.push(warning);
  if (plan.noop) lines.push('되돌릴 것이 없습니다: 현재 시험 정책이 검증본과 같습니다. 아무것도 쓰지 않습니다.');
  else lines.push(`아직 아무것도 쓰지 않았습니다. 위 항목이 맞으면 다음을 실행하세요: npm run policy:restore -- --apply --confirm ${code}`);
  return lines.join('\n');
}

export function restore(root, { apply = false, confirm = null, now = Date.now() } = {}) {
  try {
    const loaded = loadVerified(root);
    const { text, policy } = readCurrent(root);
    const plan = planRestore(loaded.policy, policy, now);
    const code = confirmCode(loaded, text, plan);
    const preview = previewText(loaded, plan, code, plan.noop ? null : dirtyWarning(root));
    if (!apply) return { ok: true, applied: false, text: preview };
    if (plan.noop) return { ok: true, applied: false, text: preview };
    if (confirm !== code) {
      return { ok: false, applied: false, text: `중단: 확인 코드가 맞지 않습니다. 파일이 바뀌었거나 미리보기를 거치지 않았습니다. 아무것도 쓰지 않았습니다.\n${preview}` };
    }
    const logPath = join(root, AUDIT_LOG);
    let logBefore = '';
    try { logBefore = readFileSync(logPath, 'utf8'); } catch { /* 기록 파일이 아직 없음 */ }
    const target = join(root, POLICY_FILE);
    const temp = `${target}.restore-tmp`;
    writeFileSync(temp, `${JSON.stringify({ schema: policy.schema, rules: plan.nextRules }, null, 2)}\n`, 'utf8');
    renameSync(temp, target);
    const line = [new Date(now).toISOString(), 'restore', 'policy-restore', '-', 1,
      `검증본 버전 ${loaded.version}(커밋 ${loaded.commit})로 복원: 생김 ${plan.restore.length}, 사라짐 ${plan.remove.length}, 바뀜 ${plan.change.length} (모듈 ${plan.scope.join(' ')})`].join(' | ');
    try {
      appendFileSync(logPath, `${logBefore && !logBefore.endsWith('\n') ? '\n' : ''}${line}\n`, 'utf8');
    } catch {
      // 기록 없이 규칙만 바뀐 상태를 남기지 않도록, 방금 바꾼 규칙 파일을 읽어 둔 원래 내용으로 되돌립니다.
      writeFileSync(temp, text, 'utf8');
      renameSync(temp, target);
      return { ok: false, applied: false, text: `중단: ${AUDIT_LOG}에 되돌림 기록을 쓰지 못해 ${POLICY_FILE}을 원래대로 되돌렸습니다. 기록 파일을 확인한 뒤 미리보기부터 다시 실행하세요.` };
    }
    return { ok: true, applied: true, text: `${preview.split('\n').slice(0, -1).join('\n')}\n적용했습니다. 다시 확인: npm run policy:diff (영향받는 모듈 없음이어야 함)` };
  } catch (error) {
    if (error instanceof PolicyCopyError) return { ok: false, applied: false, text: `중단: ${error.message}\n아무것도 쓰지 않았습니다.` };
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--confirm');
  const result = restore(join(dirname(fileURLToPath(import.meta.url)), '..'), {
    apply: args.includes('--apply'), confirm: at >= 0 ? args[at + 1] ?? null : null,
  });
  (result.ok ? console.log : console.error)(result.text);
  process.exitCode = result.ok ? 0 : 1;
}
