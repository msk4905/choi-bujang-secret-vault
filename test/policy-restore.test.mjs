import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDecider, POLICY, RULE_IDS } from '../src/decider.mjs';
import {
  applyRestore, createSnapshot, diffPolicy, planRestore, policyHash, previewRestore, readCurrentPolicy, replaceBlock,
  snapshotHash, verifySnapshot, verifyStoredSnapshot,
} from '../src/policy-restore.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { run } from '../scripts/policy-restore.mjs';

const root = new URL('..', import.meta.url).pathname;
const NOW = '2026-10-13T12:00:00.000Z';
const COMMIT = 'a'.repeat(40);
const ID = '11111111-1111-4111-8111-111111111111';
const saved = async () => JSON.parse(await readFile(join(root, 'policy', 'safe-policy.snapshot.json'), 'utf8'));

// 임시 폴더에 판정기 복사본·사본·감사 이력을 두고 시험합니다. 실제 src/decider.mjs는 건드리지 않습니다.
async function workspace({ tamper } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'policy-restore-'));
  const paths = { deciderPath: join(dir, 'decider.mjs'), snapshotPath: join(dir, 'snapshot.json'), auditPath: join(dir, 'audit.jsonl') };
  await copyFile(join(root, 'src', 'decider.mjs'), paths.deciderPath);
  await writeFile(paths.snapshotPath, JSON.stringify(await saved(), null, 2));
  await writeFile(paths.auditPath, '{"at":"2026-10-01T00:00:00.000Z","action":"older"}\n');
  if (tamper) {
    const bad = structuredClone(POLICY);
    tamper(bad);
    await writeFile(paths.deciderPath, replaceBlock(await readFile(paths.deciderPath, 'utf8'), bad));
  }
  return { dir, paths, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function tamperAll(bad) {
  bad.deviceGate.requireRegistered = false;
  bad.stepUp.burstMinCount = 9999;
  bad.zoneCommon.reservedItemNames = [];
  bad.zoneCommon.queryMustBeEmpty = false;
  bad.services.announcements.zones['PUT /announcements/:id'].allow = true;
  delete bad.services.notes.zones['PUT /notes/:id'];
  bad.services.notes.zones['DELETE /api/notes/:id'] = { ruleId: 'zone_notes_own_route', method: 'DELETE', base: '/api/notes', allow: true };
  bad.ruleIds = bad.ruleIds.filter(id => id !== 'zone_unknown_route').concat('rogue_allow_all');
}

test('저장된 안전 정책 사본은 검증을 통과하고 현재 판정 정책과 같다', async () => {
  const snapshot = await saved();
  assert.deepEqual(verifySnapshot(snapshot), { ok: true });
  assert.match(snapshot.version, /^safe-v\d+$/u);
  assert.match(snapshot.commit, /^[0-9a-f]{40}$/u);
  assert.equal(snapshot.sha256, snapshotHash(snapshot));
  assert.equal(policyHash(snapshot.policy), policyHash(POLICY));
  assert.deepEqual(RULE_IDS, POLICY.ruleIds);
  const plan = planRestore({ current: structuredClone(POLICY), snapshot });
  assert.equal(plan.changes.added.length + plan.changes.removed.length + plan.changes.changed.length, 0);
});

test('사본이 없거나 해시가 다르거나 안전하지 않으면 계획 단계에서 중단하고 아무것도 쓰지 않는다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const decider = await readFile(paths.deciderPath, 'utf8');
    const audit = await readFile(paths.auditPath, 'utf8');
    const good = await saved();
    const current = await readCurrentPolicy(paths.deciderPath);
    assert.throws(() => planRestore({ current, snapshot: undefined }), /^Error: snapshot_missing$/u);
    const edited = structuredClone(good);
    edited.policy.stepUp.burstMinCount = 1;
    assert.throws(() => planRestore({ current, snapshot: edited }), /snapshot_invalid:hash_mismatch/u);
    assert.throws(() => planRestore({ current, snapshot: { ...good, sha256: 'b'.repeat(64) } }), /hash_mismatch/u);
    for (const [change, reason] of [
      [p => { p.deviceGate.requireRegistered = false; }, 'safety_device_gate'],
      [p => { p.stepUp.enabled = false; }, 'safety_step_up'],
      [p => { p.zoneCommon.queryMustBeEmpty = false; }, 'safety_zone_common'],
      [p => { p.services.announcements.zones['PUT /announcements/:id'].allow = true; }, 'safety_announcement_edit'],
      [p => { p.ruleIds = p.ruleIds.slice(1); }, 'safety_rule_ids'],
    ]) {
      const weak = structuredClone(good);
      change(weak.policy);
      weak.sha256 = snapshotHash(weak); // 해시는 맞아도 안전 조건이 약하면 거부한다
      assert.equal(verifySnapshot(weak).reason, reason);
      assert.throws(() => planRestore({ current, snapshot: weak }), new RegExp(`snapshot_invalid:${reason}`, 'u'));
    }
    await writeFile(paths.snapshotPath, JSON.stringify(edited));
    await assert.rejects(applyRestore({ ...paths, confirm: 'x', now: NOW }), /hash_mismatch/u);
    await rm(paths.snapshotPath);
    await assert.rejects(previewRestore(paths), /snapshot_missing/u);
    await assert.rejects(applyRestore({ ...paths, confirm: 'x', now: NOW }), /snapshot_missing/u);
    assert.equal(await readFile(paths.deciderPath, 'utf8'), decider);
    assert.equal(await readFile(paths.auditPath, 'utf8'), audit);
  } finally { await cleanup(); }
});

test('제작 1: 비교는 복원할 버전·해시와 다시 생길/사라질/바뀔 규칙을 보여 주고 파일을 바꾸지 않는다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const before = [await readFile(paths.deciderPath, 'utf8'), await readFile(paths.auditPath, 'utf8')];
    const plan = await previewRestore(paths);
    assert.equal(plan.version, 'safe-v9');
    assert.equal(plan.snapshotSha256, (await saved()).sha256);
    const names = list => list.map(item => item.rule);
    assert.ok(names(plan.changes.added).includes('ruleIds.zone_unknown_route'));
    assert.ok(names(plan.changes.added).includes('services.notes.zones.PUT /notes/:id'));
    assert.ok(names(plan.changes.removed).includes('ruleIds.rogue_allow_all'));
    assert.ok(names(plan.changes.removed).includes('services.notes.zones.DELETE /api/notes/:id'));
    for (const rule of ['deviceGate.requireRegistered', 'stepUp.burstMinCount', 'zoneCommon.queryMustBeEmpty',
      'zoneCommon.reservedItemNames', 'services.announcements.zones.PUT /announcements/:id']) {
      assert.ok(names(plan.changes.changed).includes(rule), rule);
    }
    const text = await run(['diff'], { paths });
    assert.match(text.split('\n')[0], /^복원할 버전: safe-v9 · 해시\(sha256\): [0-9a-f]{64}$/u);
    assert.match(text, /다시 생길 규칙 \d+개/u);
    assert.match(text, /사라질 규칙 \d+개/u);
    assert.match(text, /바뀔 규칙 \d+개/u);
    assert.deepEqual([await readFile(paths.deciderPath, 'utf8'), await readFile(paths.auditPath, 'utf8')], before);
  } finally { await cleanup(); }
});

test('제작 2: 미리보기나 틀린 확인 코드로는 쓰지 않고, 맞는 코드면 정책이 돌아오고 이력은 한 줄만 늘어난다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const source = await readFile(paths.deciderPath, 'utf8');
    const preview = await run(['restore'], { paths });
    assert.match(preview, /미리보기입니다/u);
    const code = /--confirm ([0-9a-f]{12})/u.exec(preview)[1];
    assert.equal(await readFile(paths.deciderPath, 'utf8'), source);
    await assert.rejects(run(['restore', '--confirm', '000000000000'], { paths, now: () => NOW }), /confirm_mismatch/u);
    await assert.rejects(applyRestore({ ...paths, confirm: code, now: 'yesterday' }), /now_invalid/u);
    assert.equal(await readFile(paths.deciderPath, 'utf8'), source);
    const outside = text => text.slice(0, text.indexOf('// POLICY-BLOCK-BEGIN')) + text.slice(text.indexOf('// POLICY-BLOCK-END'));
    const done = await run(['restore', '--confirm', code], { paths, now: () => NOW });
    assert.match(done, /복원 완료/u);
    const restored = await readCurrentPolicy(paths.deciderPath);
    assert.equal(policyHash(restored), policyHash(POLICY));
    assert.equal(outside(await readFile(paths.deciderPath, 'utf8')), outside(source), '블록 밖 코드는 그대로');
    const lines = (await readFile(paths.auditPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[0], { at: '2026-10-01T00:00:00.000Z', action: 'older' });
    assert.equal(lines[1].action, 'restore');
    assert.equal(lines[1].version, 'safe-v9');
    assert.equal(lines[1].toHash, policyHash(POLICY));
    await assert.rejects(run(['restore', '--confirm', code], { paths, now: () => NOW }), /nothing_to_restore/u);
    assert.equal((await readFile(paths.auditPath, 'utf8')).trim().split('\n').length, 2);
  } finally { await cleanup(); }
});

test('서비스 범위 복원은 그 서비스 규칙만 되돌리고 다른 서비스 규칙은 그대로 둔다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const before = await readCurrentPolicy(paths.deciderPath);
    const preview = await run(['restore', '--service', 'notes'], { paths });
    assert.match(preview, /그대로 남는 다른 서비스 규칙: announcements/u);
    assert.doesNotMatch(preview, /services\.announcements/u);
    const code = /--confirm ([0-9a-f]{12})/u.exec(preview)[1];
    await run(['restore', '--service', 'notes', '--confirm', code], { paths, now: () => NOW });
    const after = await readCurrentPolicy(paths.deciderPath);
    assert.deepEqual(after.services.notes, POLICY.services.notes);
    assert.deepEqual(after.services.announcements, before.services.announcements);
    assert.equal(after.services.announcements.zones['PUT /announcements/:id'].allow, true);
    assert.deepEqual(after.deviceGate, before.deviceGate);
    await assert.rejects(run(['diff', '--service', 'nope'], { paths }), /scope_invalid/u);
  } finally { await cleanup(); }
});

test('복원 확인: 변조된 정책이 허용하던 금지 요청이 다시 거부되고 정상 요청은 유지된다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const { normal } = fixtureRequests();
    const forbidden = {
      '미등록 기기': { ...normal, deviceRegistered: false },
      '강사 공지 수정': { ...normal, method: 'PUT', path: `/announcements/${ID}`, route: 'PUT /announcements/:id' },
      '기능 이름 export': { ...normal, path: '/notes/export' },
      '쿼리가 붙은 요청': { ...normal, queryLength: 5 },
      '메모 삭제(표에 없음)': { ...normal, method: 'DELETE', path: `/api/notes/${ID}`, route: 'DELETE /api/notes/:id' },
    };
    const tampered = createDecider(await readCurrentPolicy(paths.deciderPath));
    const allowedWhileTampered = [];
    for (const [name, request] of Object.entries(forbidden)) {
      if ((await tampered(request)).decision === 'allow') allowedWhileTampered.push(name);
    }
    assert.deepEqual(allowedWhileTampered, Object.keys(forbidden), '변조된 정책에서는 금지 요청이 모두 통과한다');
    const preview = await run(['restore'], { paths });
    await run(['restore', '--confirm', /--confirm ([0-9a-f]{12})/u.exec(preview)[1]], { paths, now: () => NOW });
    const restored = createDecider(await readCurrentPolicy(paths.deciderPath));
    for (const [name, request] of Object.entries(forbidden)) {
      assert.equal((await restored(request)).decision, 'deny', name);
    }
    const ok = await restored(normal);
    assert.equal(ok.decision, 'allow');
    assert.equal(ok.reasonCode, 'approved');
  } finally { await cleanup(); }
});

test('사본 만들기는 한 번만 되고 이미 있으면 거부한다', async () => {
  const { paths, cleanup } = await workspace();
  try {
    await rm(paths.snapshotPath);
    const made = await createSnapshot({ ...paths, version: 'safe-v9', commit: COMMIT, now: NOW });
    assert.deepEqual(verifySnapshot(made), { ok: true });
    await assert.rejects(createSnapshot({ ...paths, version: 'safe-v10', commit: COMMIT, now: NOW }), /snapshot_exists/u);
    assert.equal((await readFile(paths.auditPath, 'utf8')).trim().split('\n').length, 2);
    assert.deepEqual(diffPolicy(POLICY, POLICY), { added: [], removed: [], changed: [] });
  } finally { await cleanup(); }
});

test('사본 재검증: 통과하면 lastVerified와 감사 한 줄만 더하고 해시·정책 내용은 그대로다', async () => {
  const { paths, cleanup } = await workspace();
  try {
    const { lastVerified: previous, ...before } = JSON.parse(await readFile(paths.snapshotPath, 'utf8'));
    const done = await verifyStoredSnapshot({ ...paths, now: NOW, head: COMMIT });
    assert.equal(done.version, 'safe-v9');
    assert.equal(done.changes, 0);
    const after = JSON.parse(await readFile(paths.snapshotPath, 'utf8'));
    assert.deepEqual(after.lastVerified, { at: NOW, head: COMMIT, changesFromCurrent: 0 });
    assert.notDeepEqual(after.lastVerified, previous);
    const { lastVerified, ...rest } = after;
    assert.deepEqual(rest, before);
    assert.deepEqual(verifySnapshot(after), { ok: true });
    const lines = (await readFile(paths.auditPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines[1], { at: NOW, action: 'verify', version: 'safe-v9', snapshotSha256: before.sha256, head: COMMIT, changes: 0 });
    const text = await run(['verify'], { paths, now: () => NOW, commit: COMMIT });
    assert.match(text, /사본 재검증 통과: safe-v9 · 해시\(sha256\): [0-9a-f]{64}/u);
  } finally { await cleanup(); }
});

test('사본 재검증: 사본이 없거나 손상됐으면 중단하고 아무것도 쓰지 않는다', async () => {
  const { paths, cleanup } = await workspace();
  try {
    const audit = await readFile(paths.auditPath, 'utf8');
    const bad = JSON.parse(await readFile(paths.snapshotPath, 'utf8'));
    bad.policy.stepUp.burstMinCount = 1;
    await writeFile(paths.snapshotPath, JSON.stringify(bad));
    const damaged = await readFile(paths.snapshotPath, 'utf8');
    await assert.rejects(verifyStoredSnapshot({ ...paths, now: NOW, head: COMMIT }), /hash_mismatch/u);
    assert.equal(await readFile(paths.snapshotPath, 'utf8'), damaged);
    await rm(paths.snapshotPath);
    await assert.rejects(verifyStoredSnapshot({ ...paths, now: NOW, head: COMMIT }), /snapshot_missing/u);
    await assert.rejects(verifyStoredSnapshot({ ...paths, now: 'yesterday', head: COMMIT }), /now_invalid/u);
    assert.equal(await readFile(paths.auditPath, 'utf8'), audit);
  } finally { await cleanup(); }
});

test('변조된 정책이 있어도 사본 재검증은 사본을 검증하고 차이 수를 기록한다', async () => {
  const { paths, cleanup } = await workspace({ tamper: tamperAll });
  try {
    const done = await verifyStoredSnapshot({ ...paths, now: NOW, head: COMMIT });
    assert.ok(done.changes > 0);
    assert.equal(JSON.parse(await readFile(paths.snapshotPath, 'utf8')).lastVerified.changesFromCurrent, done.changes);
    assert.equal(policyHash(await readCurrentPolicy(paths.deciderPath)) === policyHash(POLICY), false, '재검증은 정책을 되돌리지 않는다');
  } finally { await cleanup(); }
});
