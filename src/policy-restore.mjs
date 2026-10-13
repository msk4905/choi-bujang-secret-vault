// 10단계: 판정기 정책(src/decider.mjs의 POLICY 블록)을 검증한 안전 정책 사본과 비교하고 되돌립니다.
// 다루는 파일은 세 개뿐입니다: 판정기 소스(POLICY 블록 안만), 사본 JSON, 감사 이력(policy/audit.jsonl, 추가만).
// 배포 환경의 설정, Supabase, 서버 함수는 읽지도 쓰지도 않습니다. 이 도구의 결과는 심판의 판정이 아닙니다.
// 한계: 사본이 지키는 것은 POLICY 블록의 "데이터"입니다. 블록 밖의 판정 논리(decide 안의 순서와 입력 검사)가
// 바뀐 것은 이 도구가 보지 못하므로 Git 기록으로 확인해야 합니다.
import { createHash } from 'node:crypto';
import { access, appendFile, constants, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SNAPSHOT_SCHEMA = 'aleph.decider.snapshot.v1';
export const POLICY_SCHEMA = 'aleph.decider.policy.v1';
export const BLOCK_BEGIN = '// POLICY-BLOCK-BEGIN';
export const BLOCK_END = '// POLICY-BLOCK-END';
export const REQUIRED_RULES = Object.freeze([
  'device_registered', 'step_up_required', 'zone_notes_own_route', 'zone_announcement_edit', 'zone_unknown_route',
]);

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = text => createHash('sha256').update(text).digest('hex');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
const fail = code => { throw new Error(code); };

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export const policyHash = policy => sha256(canonicalJson(policy));
export const snapshotHash = ({ schema, version, commit, policy }) => sha256(canonicalJson({ schema, version, commit, policy }));

// 사본이 "안전 정책"인지 확인합니다: 모양, 해시, 그리고 안전 조건.
export function verifySnapshot(snapshot) {
  if (snapshot === null || snapshot === undefined) return { ok: false, reason: 'snapshot_missing' };
  if (!isObj(snapshot)) return { ok: false, reason: 'snapshot_invalid' };
  if (snapshot.schema !== SNAPSHOT_SCHEMA) return { ok: false, reason: 'schema_invalid' };
  if (typeof snapshot.version !== 'string' || !/^safe-v\d+$/u.test(snapshot.version)) return { ok: false, reason: 'version_invalid' };
  if (typeof snapshot.commit !== 'string' || !/^[0-9a-f]{40}$/u.test(snapshot.commit)) return { ok: false, reason: 'commit_invalid' };
  if (!isObj(snapshot.policy) || snapshot.policy.schema !== POLICY_SCHEMA) return { ok: false, reason: 'policy_invalid' };
  if (typeof snapshot.sha256 !== 'string' || snapshot.sha256 !== snapshotHash(snapshot)) return { ok: false, reason: 'hash_mismatch' };
  const unsafe = unsafeReason(snapshot.policy);
  return unsafe ? { ok: false, reason: unsafe } : { ok: true };
}

// 안전 정책이 반드시 지켜야 하는 조건입니다. 하나라도 어긋난 정책은 사본이 될 수 없습니다.
function unsafeReason(policy) {
  if (!Array.isArray(policy.ruleIds) || REQUIRED_RULES.some(id => !policy.ruleIds.includes(id))) return 'safety_rule_ids';
  if (policy.deviceGate?.requireRegistered !== true) return 'safety_device_gate';
  if (policy.stepUp?.enabled !== true) return 'safety_step_up';
  if (policy.zoneCommon?.denyUnknownRoutes !== true || policy.zoneCommon?.queryMustBeEmpty !== true) return 'safety_zone_common';
  const zones = policy.services?.announcements?.zones;
  if (!isObj(zones) || !Object.keys(zones).length || Object.values(zones).some(zone => zone?.allow !== false)) return 'safety_announcement_edit';
  return null;
}

// 현재 판정기 파일에서 POLICY를 읽습니다(파일을 바꾸지 않음).
export async function readCurrentPolicy(deciderPath) {
  const module = await import(`${pathToFileURL(deciderPath).href}?v=${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (!isObj(module.POLICY)) fail('policy_unreadable');
  return structuredClone(module.POLICY);
}

// 비교용 평면 표: 규칙 이름 목록은 이름마다 한 칸, 나머지는 끝 값 하나가 한 칸입니다.
function flatten(policy) {
  const out = {};
  const walk = (value, path) => {
    if (isObj(value) && Object.keys(value).length) for (const key of Object.keys(value)) walk(value[key], path ? `${path}.${key}` : key);
    else out[path] = value;
  };
  const { ruleIds, ...rest } = policy;
  walk(rest, '');
  delete out[''];
  if (Array.isArray(ruleIds)) for (const id of ruleIds) out[`ruleIds.${id}`] = true;
  return out;
}

// 구역 규칙은 "services.<서비스>.zones.<경로>" 한 줄을 규칙 하나로 묶어 보여 줍니다.
const unitOf = path => (/^(services\.[^.]+\.zones\.[A-Z]+ \S+)\./u.exec(path)?.[1] ?? path);

export function diffPolicy(current, wanted) {
  const a = flatten(current);
  const b = flatten(wanted);
  const units = new Map();
  for (const path of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const had = Object.hasOwn(a, path);
    const has = Object.hasOwn(b, path);
    if (had && has && canonicalJson(a[path]) === canonicalJson(b[path])) continue;
    const unit = unitOf(path);
    const entry = units.get(unit) ?? { rule: unit, kinds: new Set(), details: [] };
    entry.kinds.add(had && has ? 'changed' : has ? 'added' : 'removed');
    entry.details.push({ path, ...(had ? { before: a[path] } : {}), ...(has ? { after: b[path] } : {}) });
    units.set(unit, entry);
  }
  const result = { added: [], removed: [], changed: [] };
  for (const entry of units.values()) {
    const kind = entry.kinds.size === 1 ? [...entry.kinds][0] : 'changed';
    result[kind].push({ rule: entry.rule, details: entry.details });
  }
  return result;
}

const countChanges = diff => diff.added.length + diff.removed.length + diff.changed.length;

// scope: 'all' 또는 'services.<이름>'. 서비스 범위는 그 서비스 규칙만 사본 쪽으로 바꾸고 다른 서비스는 그대로 둡니다.
export function targetFor(current, snapshot, scope = 'all') {
  if (scope === 'all') return structuredClone(snapshot.policy);
  const name = /^services\.([a-z][a-z0-9_-]*)$/u.exec(scope)?.[1];
  if (!name || !isObj(snapshot.policy.services?.[name])) fail('scope_invalid');
  const target = structuredClone(current);
  target.services = { ...target.services, [name]: structuredClone(snapshot.policy.services[name]) };
  return target;
}

// 실행 전 계획입니다. 사본이 없거나 검증에 실패하면 던지고, 아무것도 쓰지 않습니다.
export function planRestore({ current, snapshot, scope = 'all' }) {
  const verdict = verifySnapshot(snapshot);
  if (!verdict.ok) fail(verdict.reason === 'snapshot_missing' ? 'snapshot_missing' : `snapshot_invalid:${verdict.reason}`);
  if (!isObj(current) || current.schema !== POLICY_SCHEMA) fail('policy_unreadable');
  const target = targetFor(current, snapshot, scope);
  const changes = diffPolicy(current, target);
  const preserved = scope === 'all' ? [] : Object.keys(current.services ?? {}).filter(name => `services.${name}` !== scope).sort();
  const planId = sha256(canonicalJson({
    from: policyHash(current), to: policyHash(target), snapshot: snapshot.sha256, scope,
  })).slice(0, 12);
  return {
    version: snapshot.version, commit: snapshot.commit, snapshotSha256: snapshot.sha256, scope,
    currentHash: policyHash(current), targetHash: policyHash(target), target, changes, preservedServices: preserved, planId,
  };
}

export function replaceBlock(source, policy) {
  const start = source.indexOf(BLOCK_BEGIN);
  const end = source.indexOf(BLOCK_END);
  if (start < 0 || end < start || source.indexOf(BLOCK_BEGIN, start + 1) >= 0) fail('block_markers_invalid');
  const afterBegin = source.indexOf('\n', start) + 1;
  return `${source.slice(0, afterBegin)}export const POLICY = deepFreeze(${JSON.stringify(policy, null, 2)});\n${source.slice(end)}`;
}

async function readSnapshot(snapshotPath) {
  try { return JSON.parse(await readFile(snapshotPath, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    return fail('snapshot_unreadable');
  }
}

async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { encoding: 'utf8', flag: 'w' });
  await rename(tmp, path);
}

// 사본을 한 번만 만듭니다(이미 있으면 거부). 안전 조건을 통과한 현재 정책만 사본이 됩니다.
export async function createSnapshot({ deciderPath, snapshotPath, auditPath, version, commit, now }) {
  if (await readSnapshot(snapshotPath) !== undefined) fail('snapshot_exists');
  if (typeof now !== 'string' || !ISO.test(now)) fail('now_invalid');
  const draft = { schema: SNAPSHOT_SCHEMA, version, commit, policy: await readCurrentPolicy(deciderPath) };
  const snapshot = { ...draft, sha256: snapshotHash(draft) };
  const verdict = verifySnapshot(snapshot);
  if (!verdict.ok) fail(`snapshot_invalid:${verdict.reason}`);
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeAtomic(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  await mkdir(dirname(auditPath), { recursive: true });
  await appendFile(auditPath, `${JSON.stringify({ at: now, action: 'snapshot', version, commit, snapshotSha256: snapshot.sha256 })}\n`);
  return snapshot;
}

// 저장된 사본을 다시 읽어 검증하고(모양·해시·안전 조건), 현재 정책과의 차이 수를 세어 기록합니다.
// 검증에 실패하면 던지고 아무것도 쓰지 않습니다. 성공하면 사본 파일에 해시와 무관한 lastVerified 기록을 더하고
// 감사 이력에 verify 한 줄을 덧붙입니다. 정책 내용과 사본의 sha256은 바뀌지 않습니다.
export async function verifyStoredSnapshot({ deciderPath, snapshotPath, auditPath, now, head }) {
  if (typeof now !== 'string' || !ISO.test(now)) fail('now_invalid');
  if (typeof head !== 'string' || !/^[0-9a-f]{40}$/u.test(head)) fail('head_invalid');
  const snapshot = await readSnapshot(snapshotPath);
  const verdict = verifySnapshot(snapshot);
  if (!verdict.ok) fail(verdict.reason === 'snapshot_missing' ? 'snapshot_missing' : `snapshot_invalid:${verdict.reason}`);
  const current = await readCurrentPolicy(deciderPath);
  const changes = countChanges(diffPolicy(current, snapshot.policy));
  const next = { ...snapshot, lastVerified: { at: now, head, changesFromCurrent: changes } };
  if (!verifySnapshot(next).ok) fail('verify_failed'); // lastVerified는 해시에 들어가지 않아야 한다
  await writeAtomic(snapshotPath, `${JSON.stringify(next, null, 2)}\n`);
  await appendFile(auditPath, `${JSON.stringify({
    at: now, action: 'verify', version: snapshot.version, snapshotSha256: snapshot.sha256, head, changes,
  })}\n`);
  return { version: snapshot.version, snapshotSha256: snapshot.sha256, commit: snapshot.commit, changes };
}

export async function previewRestore({ deciderPath, snapshotPath, scope = 'all' }) {
  const snapshot = await readSnapshot(snapshotPath);
  return planRestore({ current: await readCurrentPolicy(deciderPath), snapshot, scope });
}

// 확인 코드(planId)가 미리보기와 같을 때만 POLICY 블록을 다시 씁니다. 실패하면 판정기 파일은 원래 그대로입니다.
export async function applyRestore({ deciderPath, snapshotPath, auditPath, scope = 'all', confirm, now }) {
  const plan = await previewRestore({ deciderPath, snapshotPath, scope });
  if (!countChanges(plan.changes)) fail('nothing_to_restore');
  if (typeof confirm !== 'string' || confirm !== plan.planId) fail('confirm_mismatch');
  if (typeof now !== 'string' || !ISO.test(now)) fail('now_invalid');
  await access(auditPath, constants.W_OK).catch(async () => { await (await open(auditPath, 'a')).close(); });
  const original = await readFile(deciderPath, 'utf8');
  await writeAtomic(deciderPath, replaceBlock(original, plan.target));
  const after = await readCurrentPolicy(deciderPath).catch(() => null);
  if (!after || policyHash(after) !== plan.targetHash) {
    await writeAtomic(deciderPath, original);
    fail('verify_failed');
  }
  await appendFile(auditPath, `${JSON.stringify({
    at: now, action: 'restore', version: plan.version, scope, snapshotSha256: plan.snapshotSha256,
    fromHash: plan.currentHash, toHash: plan.targetHash, changes: countChanges(plan.changes),
  })}\n`);
  return plan;
}

export { countChanges };
