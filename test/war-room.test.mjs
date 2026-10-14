import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { buildWarRoom } from '../src/war-room.mjs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

// 가짜 로그인 검사기와 메모리 DB만 씁니다. 실제 Supabase·실제 토큰은 쓰지 않습니다.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SHA = 'ab'.repeat(32);
const BODY = '비밀가상본문';
const TITLE = '비밀가상제목';
const people = { 'Bearer token-a': { userId: A }, 'Bearer token-b': { userId: B } };

function fakeDb(tables, { denied = [] } = {}) {
  return {
    from(name) {
      const filters = [];
      let max = Infinity;
      const run = () => {
        if (denied.includes(name)) return { data: null, error: { code: '42501' } };
        const rows = (tables[name] ?? []).filter(row => filters.every(([k, v]) => row[k] === v));
        return { data: rows.slice(0, max).map(row => ({ ...row })), error: null };
      };
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        order() { return builder; },
        limit(n) { max = n; return builder; },
        maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function world(extra = {}) {
  const tables = {
    notes: [{ id: 'n1', title: TITLE, content: BODY, owner_id: A }, { id: 'n2', title: TITLE, content: BODY, owner_id: B }],
    notes_backup_copy_v10: [
      { id: 'c1', owner_id: B, title: TITLE, content: BODY, content_sha256: SHA },
      { id: 'c2', owner_id: A, title: TITLE, content: BODY, content_sha256: SHA },
    ],
    notes_restore_audit_v10: [
      { id: 'r1', note_id: '33333333-3333-4333-8333-333333330001', owner_id: B, content_sha256: SHA, created_at: '2026-10-13T15:00:00Z' },
      { id: 'r2', note_id: '33333333-3333-4333-8333-333333330002', owner_id: B, content_sha256: SHA, created_at: '2026-10-13T15:05:00Z' },
      { id: 'r3', note_id: '33333333-3333-4333-8333-333333330003', owner_id: A, content_sha256: SHA, created_at: '2026-10-13T15:06:00Z' },
    ],
  };
  const handler = createNotesHandler({
    getDeps: () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(tables, extra) }),
  });
  const call = (method, { query = {}, auth, body } = {}) => new Promise(resolve => {
    const response = {
      setHeader() {},
      status(code) { return { json: json => resolve({ code, json }), end: () => resolve({ code, json: undefined }) }; },
    };
    handler({ method, query, headers: { authorization: auth }, body }, response);
  });
  return { tables, call, db: fakeDb(tables, extra) };
}

test('작전실 수치는 본인의 서버 기록과 같고 다른 사람 기록은 세지 않는다', async () => {
  const { tables, call } = world();
  const result = await call('GET', { query: { warRoom: '1' }, auth: 'Bearer token-b' });
  assert.equal(result.code, 200);
  const room = result.json;
  const mineAudit = tables.notes_restore_audit_v10.filter(row => row.owner_id === B);
  const mineCopies = tables.notes_backup_copy_v10.filter(row => row.owner_id === B);
  assert.equal(room.restore.status, 'confirmed');
  assert.equal(room.restore.restoreCount, mineAudit.length);
  assert.equal(room.restore.records.length, mineAudit.length);
  assert.equal(room.restore.backupCopies, mineCopies.length);
  assert.deepEqual(room.restore.records.map(r => r.sha256Head), mineAudit.map(() => SHA.slice(0, 8)));
  assert.equal(room.decider.ruleCount, room.decider.ruleIds.length);
  assert.equal(room.decider.matchesSnapshot, true);
  const other = await call('GET', { query: { warRoom: '1' }, auth: 'Bearer token-a' });
  assert.equal(other.json.restore.restoreCount, 1);
});

test('작전실 응답에는 메모 본문·제목·전체 ID·전체 해시·사용자 ID가 없다', async () => {
  const { call } = world();
  const text = JSON.stringify((await call('GET', { query: { warRoom: '1' }, auth: 'Bearer token-b' })).json);
  for (const secret of [BODY, TITLE, SHA, A, B, '33333333-3333-4333-8333-333333330001']) assert.equal(text.includes(secret), false, secret);
});

test('읽을 출처가 없는 탐지·회수는 미실행이고, 읽기 실패는 값을 만들지 않는다', async () => {
  const { call } = world({ denied: ['notes_restore_audit_v10'] });
  const room = (await call('GET', { query: { warRoom: '1' }, auth: 'Bearer token-b' })).json;
  assert.deepEqual([room.detect.status, room.revocation.status], ['not_run', 'not_run']);
  assert.equal(room.restore.status, 'unavailable');
  assert.equal('restoreCount' in room.restore, false);
});

test('로그인 없거나 POST면 작전실은 열리지 않는다', async () => {
  const { call } = world();
  for (const auth of [undefined, 'Bearer nope']) assert.equal((await call('GET', { query: { warRoom: '1' }, auth })).code, 401);
  assert.equal((await call('POST', { query: { warRoom: '1' }, auth: 'Bearer token-b', body: {} })).code, 405);
});

test('총공세 세 괴물 연속 요청: 규칙이 충돌하지 않고 정상 사용자는 계속 쓴다', async () => {
  const { call, tables } = world();
  const mine = '/x';
  // 광주: 무인증 조회 뒤 타인 메모 조회
  assert.equal((await call('GET', { auth: undefined })).code, 401);
  assert.equal((await call('GET', { query: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, auth: 'Bearer token-a' })).code, 404);
  tables.notes.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: TITLE, content: BODY, owner_id: B });
  const cross = await call('GET', { query: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, auth: 'Bearer token-a' });
  assert.equal(cross.code, 404);
  assert.equal(JSON.stringify(cross.json).includes(BODY), false);
  // 천안: 미등록 기기 뒤 회수된 신원(로그인 검사 실패)
  const { normal } = fixtureRequests();
  const unregistered = await decide({ ...normal, requestId: randomUUID(), deviceRegistered: false });
  assert.deepEqual([unregistered.decision, unregistered.reasonCode], ['deny', 'device_not_registered']);
  assert.equal((await call('GET', { auth: 'Bearer revoked' })).code, 401);
  // 양양: 복구 뒤 서명 없는 변경 요청과 구역 밖 조회
  for (const method of ['PUT', 'DELETE']) {
    assert.equal((await call(method, { query: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, body: { title: 't', body: 'b' } })).code, 401);
  }
  assert.equal((await call('POST', { query: { restore: '1' }, body: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } })).code, 401);
  const outside = await decide({ ...normal, requestId: randomUUID(), method: 'GET', route: 'GET /notes/:id', path: '/notes/export' });
  assert.equal(outside.decision, 'deny');
  // 정상 사용자는 마지막에도 자기 메모를 읽는다
  const own = await call('GET', { auth: 'Bearer token-a' });
  assert.equal(own.code, 200);
  assert.ok(mine);
});
