import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { contentSha256 } from '../src/note-restore.mjs';

// 가짜 로그인 검사기와 메모리 DB만 씁니다. 실제 Supabase·실제 토큰·실제 메모는 쓰지 않습니다.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const N1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const N2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const people = { 'Bearer token-a': { userId: A }, 'Bearer token-b': { userId: B } };

function fakeDb(tables, { failAudit = false } = {}) {
  return {
    from(name) {
      const rows = tables[name];
      const filters = [];
      let action = 'select';
      let patch = null;
      const hits = () => rows.filter(row => filters.every(([k, v]) => row[k] === v));
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        update(value) { action = 'update'; patch = value; return builder; },
        insert(row) {
          if (failAudit && name === 'notes_restore_audit_v10') return Promise.resolve({ error: { code: 'XX000' } });
          if (rows.some(item => item.id === row.id)) return Promise.resolve({ error: { code: '23505' } });
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({ data: hits()[0] ? { ...hits()[0] } : null, error: null }),
        then(resolve, reject) {
          const found = hits();
          if (action === 'update') found.forEach(row => Object.assign(row, patch));
          return Promise.resolve({ data: found.map(row => ({ ...row })), error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

const backupRow = (id, owner, title, content) => ({
  id, owner_id: owner, title, content, content_sha256: contentSha256(content),
});

function setup(options) {
  const tables = {
    notes: [
      { id: N2, title: 'A 메모', content: 'A 가상 내용', owner_id: A },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'B 다른 메모', content: 'B 다른 내용', owner_id: B },
    ],
    notes_backup_copy_v10: [
      backupRow(N1, B, 'B 복구 대상', 'B 가상 원본 내용'),
      backupRow(N2, A, 'A 메모', 'A 가상 내용'),
    ],
    notes_restore_audit_v10: [{ id: 'old-1', note_id: 'x', owner_id: B, content_sha256: 'x', action: 'restore' }],
  };
  let auditCalls = 0;
  const handler = createNotesHandler({
    getDeps: () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(tables, options) }),
    newAuditId: () => (auditCalls++ === 0 ? 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
      : `dddddddd-dddd-4ddd-8ddd-${String(auditCalls).padStart(12, '0')}`),
  });
  const call = (method, { auth, body, query = { restore: '1' } } = {}) => new Promise(resolve => {
    const req = { method, query, headers: { authorization: auth }, body };
    const response = {
      setHeader() {},
      status: code => ({ json: json => resolve({ code, json, req }), end: () => resolve({ code, json: undefined, req }) }),
    };
    handler(req, response);
  });
  return { tables, call };
}
const snap = tables => JSON.stringify(tables);
const HASH = contentSha256('B 가상 원본 내용');

test('제작 3: B의 삭제된 메모 한 건을 복원하면 ID·소유자·내용 해시가 사본과 같다', async () => {
  const { tables, call } = setup();
  const othersBefore = structuredClone(tables.notes);
  const backupBefore = structuredClone(tables.notes_backup_copy_v10);
  const result = await call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH } });
  assert.equal(result.code, 200);
  assert.deepEqual(result.json, { id: N1, restored: true, contentSha256: HASH });
  assert.equal(result.req.resourceId, `note:${N1}`);
  const live = tables.notes.find(row => row.id === N1);
  const copy = backupBefore.find(row => row.id === N1);
  assert.equal(live.id, copy.id);
  assert.equal(live.owner_id, copy.owner_id);
  assert.equal(live.owner_id, B);
  assert.equal(contentSha256(live.content), copy.content_sha256);
  assert.equal(live.title, copy.title);
  assert.deepEqual(tables.notes.filter(row => row.id !== N1), othersBefore);
  assert.deepEqual(tables.notes_backup_copy_v10, backupBefore);
});

test('감사 기록은 보존되고 한 건만 더해진다', async () => {
  const { tables, call } = setup();
  const before = structuredClone(tables.notes_restore_audit_v10);
  await call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH } });
  assert.deepEqual(tables.notes_restore_audit_v10.slice(0, 1), before);
  assert.equal(tables.notes_restore_audit_v10.length, 2);
  assert.deepEqual(tables.notes_restore_audit_v10[1], {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', note_id: N1, owner_id: B, content_sha256: HASH, action: 'restore',
  });
});

test('내용이 바뀐 B의 메모도 사본 내용으로 되돌리고 다른 메모는 그대로다', async () => {
  const { tables, call } = setup();
  tables.notes.push({ id: N1, title: '바뀐 제목', content: '바뀐 내용', owner_id: B });
  const others = structuredClone(tables.notes.filter(row => row.id !== N1));
  const result = await call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH.toUpperCase() } });
  assert.equal(result.code, 200);
  const live = tables.notes.find(row => row.id === N1);
  assert.deepEqual([live.title, live.content, live.owner_id], ['B 복구 대상', 'B 가상 원본 내용', B]);
  assert.deepEqual(tables.notes.filter(row => row.id !== N1), others);
});

test('해시가 다르거나 사본이 손상됐으면 409이고 아무것도 바뀌지 않는다', async () => {
  const wrong = setup();
  const wrongBefore = snap(wrong.tables);
  const r1 = await wrong.call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: 'a'.repeat(64) } });
  assert.deepEqual([r1.code, r1.json], [409, { error: 'HASH_MISMATCH' }]);
  assert.equal(snap(wrong.tables), wrongBefore);
  const corrupt = setup();
  corrupt.tables.notes_backup_copy_v10[0].content = '몰래 바뀐 사본 내용';
  const corruptBefore = snap(corrupt.tables);
  const r2 = await corrupt.call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH } });
  assert.deepEqual([r2.code, r2.json], [409, { error: 'BACKUP_CORRUPT' }]);
  assert.equal(snap(corrupt.tables), corruptBefore);
});

test('남의 사본·없는 사본·남이 가진 같은 ID는 모두 같은 404이고 아무것도 바뀌지 않는다', async () => {
  const { tables, call } = setup();
  tables.notes.push({ id: N1, title: 'A가 가진 같은 ID', content: 'A 내용', owner_id: A });
  const before = snap(tables);
  const bToAsBackup = await call('POST', { auth: 'Bearer token-a', body: { id: N1, contentSha256: HASH } });
  const missing = await call('POST', { auth: 'Bearer token-b',
    body: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', contentSha256: HASH } });
  const taken = await call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH } });
  for (const r of [bToAsBackup, missing, taken]) assert.deepEqual([r.code, r.json], [404, { error: 'NOT_FOUND' }]);
  assert.equal(snap(tables), before);
});

test('로그인 없음은 401, 모양이 틀린 요청은 400, GET은 405', async () => {
  const { tables, call } = setup();
  const before = snap(tables);
  assert.equal((await call('POST', { body: { id: N1, contentSha256: HASH } })).code, 401);
  assert.equal((await call('POST', { auth: 'Bearer nope', body: { id: N1, contentSha256: HASH } })).code, 401);
  const bad = [
    { contentSha256: HASH }, { id: 'x', contentSha256: HASH }, { id: N1, contentSha256: 'zz' },
    { id: N1, contentSha256: 5 }, {}, [], 'text',
  ];
  for (const body of bad) {
    const r = await call('POST', { auth: 'Bearer token-b', body });
    assert.deepEqual([r.code, r.json], [400, { error: 'INVALID_RESTORE' }], JSON.stringify(body));
  }
  assert.equal((await call('GET', { auth: 'Bearer token-b' })).code, 405);
  assert.equal(snap(tables), before);
});

function tamper(tables) {
  tables.notes.push({ id: N1, title: '변조된 제목', content: '변조된 내용', owner_id: B });
}
function assertRestored(tables) {
  const live = tables.notes.filter(row => row.id === N1);
  assert.equal(live.length, 1);
  assert.deepEqual([live[0].owner_id, live[0].title, contentSha256(live[0].content)], [B, 'B 복구 대상', HASH]);
}

test('id만 보내거나 모르는 칸이 섞여도 변조된 메모가 복원되고, 소유자 칸은 읽지 않는다', async () => {
  const idOnly = setup();
  tamper(idOnly.tables);
  assert.equal((await idOnly.call('POST', { auth: 'Bearer token-b', body: { id: N1 } })).code, 200);
  assertRestored(idOnly.tables);
  const extras = setup();
  tamper(extras.tables);
  const ok = await extras.call('POST', { auth: 'Bearer token-b',
    body: { id: N1, owner_id: A, userId: A, ownerId: A, contentHash: 'zz', noteId: N2, contentSha256: HASH } });
  assert.equal(ok.code, 200);
  assertRestored(extras.tables);
  const cross = setup();
  tamper(cross.tables);
  const before = snap(cross.tables);
  const denied = await cross.call('POST', { auth: 'Bearer token-a', body: { id: N1, owner_id: B } });
  assert.deepEqual([denied.code, denied.json], [404, { error: 'NOT_FOUND' }]);
  assert.equal(snap(cross.tables), before);
});

test('감사 기록이 실패하면 502로 알린다', async () => {
  const { call } = setup({ failAudit: true });
  const r = await call('POST', { auth: 'Bearer token-b', body: { id: N1, contentSha256: HASH } });
  assert.deepEqual([r.code, r.json], [502, { error: 'NOTES_UNAVAILABLE' }]);
});

test('복원 경로는 id가 있는 주소나 기존 메모 처리를 바꾸지 않는다', async () => {
  const { call } = setup();
  const r = await call('POST', { auth: 'Bearer token-b', query: { id: N1, restore: '1' },
    body: { id: N1, contentSha256: HASH } });
  assert.equal(r.code, 405);
});

test('같은 메모를 두 번 복원해도 둘 다 200이고 내용은 같으며 감사 기록은 호출마다 한 줄씩 늘어난다', async () => {
  const { tables, call } = setup();
  tables.notes.push({ id: N1, title: '변조된 제목', content: '변조된 내용', owner_id: B });
  const first = await call('POST', { auth: 'Bearer token-b', body: { id: N1 } });
  const afterFirst = structuredClone(tables.notes.find(row => row.id === N1));
  const auditAfterFirst = tables.notes_restore_audit_v10.length;
  const second = await call('POST', { auth: 'Bearer token-b', body: { id: N1 } });
  assert.deepEqual([first.code, second.code], [200, 200]);
  assert.deepEqual(tables.notes.find(row => row.id === N1), afterFirst);
  assert.equal(contentSha256(afterFirst.content), HASH);
  assert.equal(tables.notes_restore_audit_v10.length, auditAfterFirst + 1);
});
