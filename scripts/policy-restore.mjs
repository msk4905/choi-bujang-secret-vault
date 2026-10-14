// 10단계: 판정기 정책(src/decider.mjs의 POLICY 블록) 비교·복원 도구입니다.
//   npm run policy:snapshot [-- --version safe-v9]   침해 전에 안전 정책 사본을 한 번 만듭니다(이미 있으면 거부, 기본 이름 safe-v9).
//   npm run policy:verify                저장된 사본을 다시 읽어 검증하고(모양·해시·안전 조건) 결과를 기록합니다.
//                                        검증에 실패하면 중단하고 아무것도 쓰지 않습니다. 정책 파일은 바꾸지 않습니다.
//   npm run policy:diff                  사본과 현재 정책의 차이만 보여 줍니다(파일을 바꾸지 않음).
//   npm run policy:restore               되돌릴 때 바뀔 항목만 미리 보여 줍니다(파일을 바꾸지 않음).
//   npm run policy:restore -- --confirm <확인 코드>   미리보기의 확인 코드를 줘야만 되돌립니다.
// 두 명령 모두 --service <이름>을 주면 그 서비스(services.<이름>) 규칙만 다루고 다른 서비스는 그대로 둡니다.
// 배포 환경 설정·Supabase·서버 함수는 건드리지 않습니다.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRestore, countChanges, createSnapshot, previewRestore, verifyStoredSnapshot,
} from '../src/policy-restore.mjs';

const root = resolve(import.meta.dirname, '..');
export const PATHS = {
  deciderPath: resolve(root, 'src', 'decider.mjs'),
  snapshotPath: resolve(root, 'policy', 'safe-policy.snapshot.json'),
  auditPath: resolve(root, 'policy', 'audit.jsonl'),
};

const arg = (args, name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const show = value => JSON.stringify(value);

export function formatPlan(plan) {
  const lines = [
    `복원할 버전: ${plan.version} · 해시(sha256): ${plan.snapshotSha256}`,
    `사본 커밋: ${plan.commit} · 범위: ${plan.scope === 'all' ? '정책 전체' : plan.scope}`,
    `바뀔 항목 ${countChanges(plan.changes)}개 (현재 정책 해시 ${plan.currentHash.slice(0, 12)}… → ${plan.targetHash.slice(0, 12)}…):`,
  ];
  const section = (title, mark, items, detail) => {
    lines.push(`  ${title} ${items.length}개`);
    for (const item of items) lines.push(`    ${mark} ${item.rule}${detail(item)}`);
  };
  section('다시 생길 규칙', '+', plan.changes.added, item => (item.details.length === 1 && item.details[0].path === item.rule ? `: ${show(item.details[0].after)}` : ''));
  section('사라질 규칙', '-', plan.changes.removed, item => (item.details.length === 1 && item.details[0].path === item.rule ? `: ${show(item.details[0].before)}` : ''));
  section('바뀔 규칙', '~', plan.changes.changed, item => item.details.map(d => `\n        ${d.path}: ${show(d.before)} → ${show(d.after)}`).join(''));
  if (plan.preservedServices.length) lines.push(`그대로 남는 다른 서비스 규칙: ${plan.preservedServices.join(', ')}`);
  lines.push('감사 이력은 지우지 않고 한 줄만 덧붙입니다(policy/audit.jsonl).');
  return lines.join('\n');
}

export async function run(args, { now = () => new Date().toISOString(), paths = PATHS, commit } = {}) {
  const [command] = args;
  const service = arg(args, '--service');
  const scope = service ? `services.${service}` : 'all';
  if (command === 'snapshot') {
    const head = commit ?? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const made = await createSnapshot({ ...paths, version: arg(args, '--version') ?? 'safe-v9', commit: head, now: now() });
    return `안전 정책 사본 저장: ${made.version} · 커밋 ${made.commit} · sha256 ${made.sha256}`;
  }
  if (command === 'verify') {
    const head = commit ?? execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const done = await verifyStoredSnapshot({ ...paths, now: now(), head });
    return `사본 재검증 통과: ${done.version} · 해시(sha256): ${done.snapshotSha256}\n사본 커밋 ${done.commit} · 현재 정책과의 차이 ${done.changes}개${done.changes ? ' (npm run policy:diff로 확인)' : ''}\n기록: 사본 파일의 lastVerified와 policy/audit.jsonl의 verify 한 줄`;
  }
  if (command === 'diff') {
    const plan = await previewRestore({ ...paths, scope });
    return `${formatPlan(plan)}\n(비교만 했습니다. 파일은 바뀌지 않았습니다.)`;
  }
  if (command === 'restore') {
    const confirm = arg(args, '--confirm');
    if (!confirm) {
      const plan = await previewRestore({ ...paths, scope });
      if (!countChanges(plan.changes)) return `${formatPlan(plan)}\n되돌릴 항목이 없습니다. 파일은 바뀌지 않았습니다.`;
      return `${formatPlan(plan)}\n(미리보기입니다. 파일은 바뀌지 않았습니다.)\n되돌리려면: npm run policy:restore -- ${service ? `--service ${service} ` : ''}--confirm ${plan.planId}`;
    }
    const plan = await applyRestore({ ...paths, scope, confirm, now: now() });
    return `${formatPlan(plan)}\n복원 완료: 판정 정책이 ${plan.version}로 돌아왔습니다. 확인: npm run policy:diff, npm run decider:test`;
  }
  throw new Error('usage: snapshot | verify | diff | restore [--confirm <확인 코드>] [--service <이름>]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(await run(process.argv.slice(2)));
  } catch (error) {
    console.error(`중단: ${error.message}`);
    process.exitCode = 1;
  }
}
