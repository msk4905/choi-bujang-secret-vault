import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { backupRecord, noteHash } from '../src/notes-backup.mjs';
import { createRestoreRoute } from '../api/restore/[id].js';

// 가짜 로그인 검사기와 메모리 DB만 씁니다. 실제 Supabase·실제 토큰은 쓰지 않습니다.
// 복원 대상은 시험 계정 B의 가상 메모뿐입니다. A는 B의 메모를 요청했을 때 거부되는지 보는 요청자로만 나옵니다.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const B_NOTE = '44444444-4444-4444-8444-444444444441';
const B_OTHER = '44444444-4444-4444-8444-444444444442';
const A_NOTE = '55555555-5555-4555-8555-555555555551';
const people = { 'Bearer token-a': { userId: A }, 'Bearer token-b': { userId: B } };
const AUTH_B = 'Bearer token-b';
const ORIGINAL = { title: '가상 B 메모', body: '가상 내용입니다' };

function fakeDb(rows, writes, { dropWrites = false, corruptWrites = false, onWrite = null, failInsertFor = null, stats = null } = {}, tables = {}) {
  // stats가 있으면 DB 호출마다 잠깐 기다리며 동시에 진행 중인 호출 수의 최댓값을 기록한다(순서대로만 부르는지 겹쳐 부르는지 확인용).
  const track = async (fn) => {
    if (!stats) return fn();
    stats.inFlight = (stats.inFlight ?? 0) + 1;
    stats.max = Math.max(stats.max ?? 0, stats.inFlight);
    await new Promise(resolve => setTimeout(resolve, 5));
    try { return fn(); } finally { stats.inFlight -= 1; }
  };
  let firstWrite = true; // 변조·끼어들기는 첫 쓰기에만 적용한다
  const once = () => { const first = firstWrite; firstWrite = false; return first; };
  return {
    from(table = 'notes') {
      const isNotes = table === 'notes';
      const target = isNotes ? rows : (tables[table] ??= []);
      const filters = [];
      let action = 'select';
      let patch = null;
      const run = () => {
        const norm = (k, v) => ((k === 'id' || k === 'note_id') && typeof v === 'string' ? v.toLowerCase() : v); // uuid 칸은 대소문자를 구분하지 않음
        const hit = target.filter(row => filters.every(([k, v]) => norm(k, row[k]) === norm(k, v)));
        if (action === 'select') return hit.map(row => ({ ...row }));
        if (isNotes) writes.push(action);
        if (action === 'update') {
          if (!dropWrites) hit.forEach(row => Object.assign(row, patch));
          if (isNotes && once()) {
            if (corruptWrites) hit.forEach(row => { row.content += '(변조)'; });
            if (onWrite) onWrite();
          }
          return hit.map(row => ({ id: row.id, owner_id: row.owner_id }));
        }
        for (const row of hit) target.splice(target.indexOf(row), 1);
        return hit.map(row => ({ id: row.id }));
      };
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        order() { return builder; },
        limit() { return builder; },
        update(value) { action = 'update'; patch = value; return builder; },
        delete() { action = 'delete'; return builder; },
        insert(row) { return track(() => insertNow(row)); },
        maybeSingle: () => track(() => ({ data: run()[0] ?? null, error: null })),
        then(resolve, reject) { return track(() => ({ data: run(), error: null })).then(resolve, reject); },
      };
      const insertNow = (row) => {
        if (failInsertFor && failInsertFor(row, table)) return { error: { code: 'XX000' } };
        if (!isNotes) {
          if (table === 'vault_notes_backup') {
            row = { ...row, note_id: row.note_id.toLowerCase() };
            if (target.some(item => item.note_id === row.note_id)) return { error: { code: '23505' } };
            row.id = target.length + 1;
            row.created_at = '2026-01-01T00:00:00.000Z';
          }
          target.push({ ...row });
          return { error: null };
        }
        row = { ...row, id: typeof row.id === 'string' ? row.id.toLowerCase() : row.id };
        if (rows.some(item => item.id === row.id)) return { error: { code: '23505' } };
        writes.push('insert');
        if (!dropWrites) rows.push({ ...row });
        if (once() && !dropWrites) {
          if (corruptWrites) rows[rows.length - 1].content += '(변조)';
          if (onWrite) onWrite();
        }
        return { error: null };
      };
      return builder;
    },
  };
}

function setup(options) {
  const rows = [];
  const writes = [];
  const tables = { vault_notes_backup: [], vault_audit: [] }; // 사본 전용 표와 감사 표(메모 표와 따로)
  const getDeps = () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(rows, writes, options, tables) });
  const handler = createNotesHandler({ getDeps });
  const restoreRoute = createRestoreRoute({ getDeps });
  const call = (method, { id, auth = AUTH_B, body, restore = false } = {}) => new Promise(resolve => {
    const response = {
      setHeader() {},
      status(code) { return { json: json => resolve({ code, json }), end: () => resolve({ code }) }; },
    };
    // 복구 요청은 api/restore/[id].js의 경로 함수로만 처리된다(쿼리 값으로는 열리지 않음).
    (restore ? restoreRoute : handler)({ method, query: id === undefined ? {} : { id }, headers: { authorization: auth }, body }, response);
  });
  const restore = (opts = {}) => call('POST', { id: B_NOTE, restore: true, ...opts });
  return { rows, writes, call, restore, backups: tables.vault_notes_backup, audit: tables.vault_audit, tables };
}

// 심판이 하는 순서: B가 메모를 만들고(서버가 사본을 남김) → 변조하고 → 복구 경로를 호출한다.
async function bCreatesAndTampers(state, { tamper = 'edit' } = {}) {
  assert.equal((await state.call('POST', { body: { id: B_NOTE, ...ORIGINAL } })).code, 201);
  if (tamper === 'edit') assert.equal((await state.call('PUT', { id: B_NOTE, body: { title: '변조된 제목', body: '변조된 내용' } })).code, 200);
  if (tamper === 'delete') assert.equal((await state.call('DELETE', { id: B_NOTE })).code, 204);
  state.writes.length = 0;
}

async function quiet(fn) {
  const saved = { warn: console.warn, info: console.info, error: console.error };
  const logged = [];
  for (const k of ['warn', 'info', 'error']) console[k] = line => logged.push(String(line));
  try { return [await fn(), logged]; } finally { Object.assign(console, saved); }
}
const snapshot = rows => JSON.stringify(rows);
const live = (rows, id = B_NOTE) => rows.find(row => row.id === id);
const hash = noteHash(ORIGINAL.title, ORIGINAL.body);

test('B의 메모를 변조한 뒤 본문 없이 복구 경로를 한 번 호출하면 사본으로 돌아오고 ID·소유자·내용 해시가 같다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  await state.call('POST', { body: { id: B_OTHER, title: '다른 메모', body: '다른 내용' } });
  const others = snapshot(state.rows.filter(row => row.id !== B_NOTE));
  const [result, logged] = await quiet(() => state.restore());
  assert.equal(result.code, 200);
  assert.deepEqual(result.json, { id: B_NOTE, ownerId: B, contentSha256: hash, title: ORIGINAL.title, body: ORIGINAL.body, ownerMatched: true, wrote: true, restored: 'updated', backupAt: '2026-01-01T00:00:00.000Z', version: `sha256:${hash.slice(0, 12)}`, willChange: ['title', 'content'], verified: true });
  const row = live(state.rows);
  assert.deepEqual([row.id, row.owner_id, noteHash(row.title, row.content)], [B_NOTE, B, hash]);
  assert.equal(snapshot(state.rows.filter(row2 => row2.id !== B_NOTE)), others);
  assert.deepEqual(logged, ['notes restored: updated']);
  for (const secret of [B_NOTE, A, B, 'token-b', ORIGINAL.body, hash]) assert.equal(logged.join('\n').includes(secret), false);
});

test('지워진 B 메모도 본문 없이 한 번 호출하면 되살아난다', async () => {
  const state = setup();
  await bCreatesAndTampers(state, { tamper: 'delete' });
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json.restored], [201, 'created']);
  const row = live(state.rows);
  assert.deepEqual([row.owner_id, noteHash(row.title, row.content)], [B, hash]);
});

test('요청에 내용 해시를 함께 보내면 사본과 같을 때만 복원한다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const [wrong] = await quiet(() => state.restore({ body: { contentSha256: 'a'.repeat(64) } }));
  assert.deepEqual([wrong.code, wrong.json], [409, { error: 'HASH_MISMATCH' }]);
  assert.deepEqual(state.writes, []);
  assert.equal(live(state.rows).title, '변조된 제목');
  const [right] = await quiet(() => state.restore({ body: { contentSha256: hash.toUpperCase() } }));
  assert.equal(right.code, 200);
});

test('dryRun은 복원할 버전과 바뀔 항목만 보여 주고 아무것도 쓰지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const before = snapshot(state.rows);
  const [result, logged] = await quiet(() => state.restore({ body: { dryRun: true } }));
  assert.deepEqual(result.json, { id: B_NOTE, ownerId: B, contentSha256: hash, preview: true, version: `sha256:${hash.slice(0, 12)}`, action: 'update', willChange: ['title', 'content'] });
  assert.deepEqual(logged, ['notes restore preview']);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

test('이미 사본과 같으면 쓰지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state, { tamper: 'none' });
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json.restored], [200, 'unchanged']);
  assert.deepEqual(state.writes, []);
});

test('사본은 전용 표에 메모당 한 건만 남고 이후 수정으로 덮어쓰이지 않으며 메모 API로 보이지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  assert.equal(state.backups.length, 1);
  assert.deepEqual([state.backups[0].note_id, state.backups[0].owner_id, state.backups[0].source], [B_NOTE, B, 'create']);
  assert.equal(state.backups[0].content_hash, hash); // 변조 뒤에도 원래 해시
  assert.equal(state.rows.some(row => row.title === 'backup'), false); // 메모 표에는 사본 행이 없다
  assert.deepEqual((await state.call('GET')).json.map(item => item.id), [B_NOTE]);
  await quiet(() => state.call('PUT', { id: B_NOTE, body: { title: '또 변조', body: '또 변조 내용' } }));
  assert.equal(state.backups.length, 1);
  assert.equal(state.backups[0].content_hash, hash);
});

test('사본을 변조하면(내용과 해시가 다름) 쓰지 않고 멈춘다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  state.backups[0].content = '바뀐 사본 내용'; // 해시는 그대로 두고 내용만 바꿈
  const before = snapshot(state.rows);
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json], [409, { error: 'BACKUP_HASH_MISMATCH' }]);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

test('사본의 소유자가 요청자와 다르면 404, 저장된 해시 칸이 어긋나면 409로 멈추고 아무것도 쓰지 않는다', async () => {
  for (const [forge, code] of [[copy => { copy.owner_id = A; }, 404], [copy => { copy.content_hash = 'a'.repeat(64); }, 409]]) {
    const state = setup();
    await bCreatesAndTampers(state);
    forge(state.backups[0]);
    const [result] = await quiet(() => state.restore());
    assert.equal(result.code, code);
    assert.deepEqual(state.writes, []);
  }
});

test('사본이 없는 메모는 복원하지 않고 404로 멈춘다', async () => {
  const state = setup();
  state.rows.push({ id: B_NOTE, title: '사본 없는 메모', content: '내용', owner_id: B });
  const before = snapshot(state.rows);
  const [result, logged] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
  assert.deepEqual(logged, ['notes restore denied: no_backup']);
});

test('A가 B의 메모를 복원하려 하면 404이고 아무것도 쓰지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const before = snapshot(state.rows);
  const [result] = await quiet(() => state.restore({ auth: 'Bearer token-a' }));
  assert.deepEqual([result.code, result.json], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

test('같은 ID의 현재 메모 주인이 사본 소유자와 다르면 덮어쓰지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state, { tamper: 'delete' });
  state.rows.push({ id: B_NOTE, title: '다른 주인', content: '다른 내용', owner_id: A });
  const before = snapshot(state.rows);
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

// 같은 메모리 DB를 쓰되, 복원 때 쓰는 첫 쓰기만 어긋나게 만드는 핸들러를 따로 만든다.
const callOn = (state, options) => {
  const handler = createRestoreRoute({ getDeps: () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(state.rows, [], options, state.tables) }) });
  return new Promise(resolve => handler({ method: 'POST', query: { id: B_NOTE }, headers: { authorization: AUTH_B } },
    { setHeader() {}, status: code => ({ json: json => resolve({ code, json }) }) }));
};

test('복원 뒤 검증에 실패하면 쓴 내용을 되돌린다: 고친 행은 이전 내용으로, 새로 만든 행은 지운다', async () => {
  for (const tamper of ['edit', 'delete']) {
    const state = setup();
    await bCreatesAndTampers(state, { tamper });
    const before = snapshot(state.rows);
    const [result, logged] = await quiet(() => callOn(state, { corruptWrites: true }));
    assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
    assert.equal(snapshot(state.rows), before);
    assert.ok(logged.includes('notes restore unverified'));
    for (const secret of [B_NOTE, B, hash, '변조']) assert.equal(logged.join('\n').includes(secret), false);
  }
});

test('쓰는 사이 사본이 바뀌면 사본을 다시 읽어 알아채고 되돌린다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const before = snapshot(state.rows);
  const onWrite = () => {
    state.backups[0].content = '사이에 바뀜';
  };
  const [result] = await quiet(() => callOn(state, { onWrite }));
  assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
  assert.equal(live(state.rows).title, '변조된 제목');
  assert.equal(snapshot(state.rows), before.replace('변조된 내용', '변조된 내용')); // 메모는 이전 내용으로 되돌아와 있다
});

test('사본을 남기지 못해도 메모 만들기는 성공하고, 그 메모는 복원할 수 없다', async () => {
  const state = setup({ failInsertFor: (row, table) => table === 'vault_notes_backup' });
  const [created] = await quiet(() => state.call('POST', { body: { id: B_NOTE, ...ORIGINAL } }));
  assert.equal(created.code, 201);
  const [result, logged] = await quiet(() => state.restore());
  assert.equal(result.code, 404);
  assert.deepEqual(logged, ['notes restore denied: no_backup']);
});

test('로그인 없음 401, 잘못된 본문·ID 400, POST 아닌 메서드 405', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const before = snapshot(state.rows);
  const [codes] = await quiet(async () => [
    (await state.restore({ auth: null })).code,
    (await state.restore({ body: { contentSha256: 'zz' } })).code,
    (await state.restore({ body: { dryRun: 'yes' } })).code,
    (await state.restore({ body: [1] })).code,
    (await state.call('POST', { id: 'not-a-uuid', restore: true })).code,
    (await state.call('POST', { restore: true })).code,
    (await state.call('GET', { id: B_NOTE, restore: true })).code,
    (await state.call('PUT', { id: B_NOTE, restore: true, body: { title: 't', body: 'b' } })).code,
    (await state.call('DELETE', { id: B_NOTE, restore: true })).code,
  ]);
  assert.deepEqual(codes, [401, 400, 400, 400, 400, 400, 405, 405, 405]);
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

test('사본 레코드는 메모 ID·소유자·제목·내용과 sha256(제목+0x00+내용) 해시를 담고 출처를 적는다', () => {
  const record = backupRecord({ noteId: B_NOTE, userId: B, title: ORIGINAL.title, content: ORIGINAL.body, source: 'create' });
  assert.deepEqual(record, { note_id: B_NOTE, owner_id: B, title: ORIGINAL.title, content: ORIGINAL.body, content_hash: hash, source: 'create' });
  assert.notEqual(noteHash('ab', 'c'), noteHash('a', 'bc')); // 제목과 본문 경계가 모호하지 않다
});

test('B의 메모를 지우고 복구한 직후에도 3·4·8단계 대표 공격은 그대로 거부되고 다른 사용자 자료는 보이지 않는다', async () => {
  const state = setup();
  await state.call('POST', { auth: 'Bearer token-a', body: { id: A_NOTE, title: '가상 A 메모', body: 'A 내용' } });
  await bCreatesAndTampers(state, { tamper: 'delete' });
  const [restored] = await quiet(() => state.restore());
  assert.equal(restored.code, 201);
  state.writes.length = 0;
  const before = snapshot(state.rows);
  const rolePlay = { title: 'x', body: 'y', role: 'instructor', aleph_role: 'judge', owner_id: A, userId: A, isInstructor: true };
  const [codes] = await quiet(async () => {
    const out = {};
    // 3단계: 로그인 없음·위조 토큰은 자료 없이 401 (목록·추가·수정·삭제·복구 모두)
    for (const auth of [null, 'Bearer forged']) {
      for (const [name, method, opts] of [['list', 'GET', {}], ['create', 'POST', { body: rolePlay }],
        ['update', 'PUT', { id: A_NOTE, body: rolePlay }], ['remove', 'DELETE', { id: A_NOTE }],
        ['restore', 'POST', { id: B_NOTE, restore: true }]]) {
        out[`${name}:${auth}`] = (await state.call(method, { ...opts, auth })).code;
      }
    }
    // 4·8단계: B가 메뉴를 우회해 A의 메모 id를 직접 요청하면 404, role·owner_id 같은 조작값은 무시
    for (const [method, body] of [['GET'], ['PUT', rolePlay], ['DELETE', rolePlay]]) {
      out[`cross:${method}`] = (await state.call(method, { id: A_NOTE, body })).code;
    }
    // A가 B의 메모를 복구하려 하는 요청, B가 A의 메모 id로 복구를 요청하는 경우도 404
    out.aRestoresB = (await state.restore({ auth: 'Bearer token-a' })).code;
    out.bRestoresA = (await state.call('POST', { id: A_NOTE, restore: true })).code;
    return out;
  });
  for (const [name, code] of Object.entries(codes)) {
    const expected = name.startsWith('cross') || name.endsWith('Restores') || name === 'aRestoresB' || name === 'bRestoresA' ? 404 : 401;
    assert.equal(code, expected, name);
  }
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
  // 목록은 각자 자기 것만, 사본 행은 어느 쪽에도 보이지 않는다
  assert.deepEqual((await state.call('GET')).json.map(item => item.id), [B_NOTE]);
  assert.deepEqual((await state.call('GET', { auth: 'Bearer token-a' })).json.map(item => item.id), [A_NOTE]);
  // 복구된 B 메모는 처음 내용 그대로이고 A의 메모는 바뀌지 않았다
  assert.equal(noteHash(live(state.rows).title, live(state.rows).content), hash);
  assert.equal(live(state.rows, A_NOTE).content, 'A 내용');
});

// 사본이 없던 옛 메모(이 기능 이전에 만들어 사본이 없음)를 직접 넣는다.
const legacy = (state, id = B_NOTE) => state.rows.push({ id, title: ORIGINAL.title, content: ORIGINAL.body, owner_id: B });

test('사본이 없던 옛 메모도 처음 변조되기 직전 상태가 사본으로 남아 변조 뒤 복구된다', async () => {
  const state = setup();
  legacy(state);
  const [noBackup] = await quiet(() => state.restore());
  assert.equal(noBackup.code, 404); // 아직 한 번도 고치지 않았으면 사본이 없다
  assert.equal((await state.call('PUT', { id: B_NOTE, body: { title: '변조된 제목', body: '변조된 내용' } })).code, 200);
  assert.deepEqual(state.backups.map(copy => copy.source), ['before_change']);
  assert.equal((await state.call('PUT', { id: B_NOTE, body: { title: '두 번째 변조', body: '또 변조' } })).code, 200);
  assert.equal(state.backups.length, 1);
  assert.equal(state.backups[0].content_hash, hash); // 두 번째 변조가 사본을 덮어쓰지 못함
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json.restored, result.json.verified], [200, 'updated', true]);
  const row = live(state.rows);
  assert.equal(noteHash(row.title, row.content), hash);
});

test('사본이 없던 옛 메모를 지워도 직전 상태가 사본으로 남아 되살릴 수 있다', async () => {
  const state = setup();
  legacy(state);
  assert.equal((await state.call('DELETE', { id: B_NOTE })).code, 204);
  const [result] = await quiet(() => state.restore());
  assert.deepEqual([result.code, result.json.restored], [201, 'created']);
  const row = live(state.rows);
  assert.deepEqual([row.owner_id, noteHash(row.title, row.content)], [B, hash]);
});

test('수정 직전 사본을 남기지 못해도 수정은 그대로 성공한다', async () => {
  const state = setup({ failInsertFor: (row, table) => table === 'vault_notes_backup' });
  legacy(state);
  const [result] = await quiet(() => state.call('PUT', { id: B_NOTE, body: { title: '새 제목', body: '새 내용' } }));
  assert.equal(result.code, 200);
  assert.equal(live(state.rows).title, '새 제목');
});

test('대문자로 보낸 메모 ID로 만들어도 사본이 맞게 남아 복구된다', async () => {
  const state = setup();
  const lower = 'abcdefab-cdef-4cde-8fab-cdefabcdefab'; // 16진수 글자가 있어 대문자로 바꾸면 달라지는 ID
  const upper = lower.toUpperCase();
  assert.notEqual(upper, lower);
  assert.equal((await state.call('POST', { body: { id: upper, ...ORIGINAL } })).code, 201);
  // 수정하기 전에, 만들 때 남은 사본이 소문자 ID 기준으로 맞게 저장됐는지 먼저 본다
  const created = state.backups.find(copy => copy.note_id === lower);
  assert.ok(created, '소문자 ID 기준 사본 행이 없음');
  assert.equal(created.content_hash, hash);
  assert.equal((await state.call('PUT', { id: lower, body: { title: '변조', body: '변조' } })).code, 200);
  const [result] = await quiet(() => state.restore({ id: lower }));
  assert.equal(result.code, 200);
  assert.equal(noteHash(live(state.rows, lower).title, live(state.rows, lower).content), hash);
});

const { createHash } = await import('node:crypto');
const bodyOnly = createHash('sha256').update(ORIGINAL.body, 'utf8').digest('hex');

test('요청이 담아 온 ID·소유자·제목·내용·해시가 사본과 모두 맞으면 복원한다(이름이 달라도, 해시는 두 방식 모두)', async () => {
  for (const claims of [
    { id: B_NOTE, ownerId: B, contentSha256: hash },
    { noteId: B_NOTE.toUpperCase(), owner_id: B, hash: `sha256:${hash}` },
    { id: B_NOTE, userId: B, sha256: bodyOnly, title: ORIGINAL.title, body: ORIGINAL.body },
  ]) {
    const state = setup();
    await bCreatesAndTampers(state);
    const [result] = await quiet(() => state.restore({ body: claims }));
    assert.equal(result.code, 200, JSON.stringify(Object.keys(claims)));
    assert.equal(noteHash(live(state.rows).title, live(state.rows).content), hash);
  }
});

test('변조된 ID·소유자·제목·내용·해시를 담아 보내면 복원하지 않고 409로 멈춘다', async () => {
  const forged = [
    { id: B_OTHER },
    { ownerId: A },
    { owner_id: A, id: B_NOTE },
    { title: '변조된 제목' },
    { body: '변조된 내용' },
    { content: '변조된 내용' },
    { contentSha256: noteHash('변조된 제목', '변조된 내용') },
    { hash: createHash('sha256').update('변조된 내용', 'utf8').digest('hex') },
    { id: B_NOTE, ownerId: B, contentSha256: hash, body: '변조된 내용' }, // 일부만 맞아도 하나라도 다르면 멈춘다
  ];
  for (const claims of forged) {
    const state = setup();
    await bCreatesAndTampers(state);
    const before = snapshot(state.rows);
    const [result, logged] = await quiet(() => state.restore({ body: claims }));
    assert.equal(result.code, 409, JSON.stringify(claims));
    assert.match(result.json.error, /^(HASH|CLAIM)_MISMATCH$/u);
    assert.deepEqual(state.writes, []);
    assert.equal(snapshot(state.rows), before);
    assert.equal(logged.join('\n').includes('변조된'), false); // 주장한 값은 로그에 남기지 않음
  }
});

test('형식이 틀린 주장은 400이고 아무것도 쓰지 않는다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const before = snapshot(state.rows);
  for (const body of [{ id: 'not-a-uuid' }, { ownerId: 7 }, { contentSha256: 'zz' }, { title: 5 }, { body: {} }]) {
    const [result] = await quiet(() => state.restore({ body }));
    assert.equal(result.code, 400, JSON.stringify(body));
  }
  assert.deepEqual(state.writes, []);
  assert.equal(snapshot(state.rows), before);
});

test('복구 응답은 소유자·전체 내용 해시·소유자 일치·썼는지 여부와 되살린 제목·본문(요청자 본인 것)을 보여 준다', async () => {
  const state = setup();
  await bCreatesAndTampers(state);
  const [result] = await quiet(() => state.restore());
  assert.equal(result.json.ownerId, B);
  assert.equal(result.json.contentSha256, hash);
  assert.deepEqual([result.json.contentSha256, result.json.ownerMatched, result.json.wrote], [hash, true, true]);
  assert.deepEqual([result.json.title, result.json.body], [ORIGINAL.title, ORIGINAL.body]);
});

test('서로 독립인 DB 호출은 겹쳐 실행된다: 복구와 수정·삭제가 순서대로만 기다리지 않는다', async () => {
  const stats = {};
  const state = setup({ stats });
  await bCreatesAndTampers(state); // 생성 → 변조(PUT) 중에도 수정은 사본 저장과 겹쳐 실행된다
  assert.ok(stats.max >= 2, `수정/삭제에서 겹침 없음(최대 동시 ${stats.max})`);
  stats.max = 0;
  const [result] = await quiet(() => state.restore());
  assert.equal(result.code, 200);
  assert.ok(stats.max >= 2, `복구에서 겹침 없음(최대 동시 ${stats.max})`); // 사본·메모 읽기와 쓴 뒤 재확인 읽기가 겹침
});

test('복구 경로는 선언한 api/restore/[id].js 하나뿐이다: 설정·파일·vercel.json이 서로 맞고 숨은 입구가 없다', async () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  assert.ok(existsSync(new URL('../api/restore/[id].js', import.meta.url)), 'api/restore/[id].js 파일이 없음');
  assert.ok(config.allowedRoutes.includes('POST /api/restore/:id'));
  assert.equal(config.restoreRoute, 'POST /api/restore/:id');
  assert.equal(config.allowedRoutes.some(route => route.includes('/restore') && route !== 'POST /api/restore/:id'), false);
  assert.equal(vercel.rewrites.some(item => /restore/u.test(item.source) || /restore/u.test(item.destination)), false); // 옛 rewrite·restore=1 쿼리 입구 없음
  // 실제 진입 파일을 부른다: Supabase 환경변수가 없으면 503, 복구 분기는 POST만 받는다(GET은 405).
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY;
  try {
    const { default: restoreEntry } = await import('../api/restore/[id].js');
    const { default: notesEntry } = await import('../api/notes.js');
    const run = (entry, request) => new Promise(resolve => {
      const headers = {};
      entry(request, { setHeader: (k, v) => { headers[k] = v; }, status: code => ({ json: json => resolve({ code, json, headers }), end: () => resolve({ code, headers }) }) });
    });
    const get = await run(restoreEntry, { method: 'GET', query: { id: B_NOTE }, headers: {} });
    assert.deepEqual([get.code, get.headers.Allow], [405, 'POST']);
    const post = await run(restoreEntry, { method: 'POST', query: { id: B_NOTE }, headers: {}, body: {} });
    assert.deepEqual([post.code, post.json], [503, { error: 'NOTES_NOT_CONFIGURED' }]);
    // 옛 입구(쿼리 restore=1)는 더 이상 복구 분기를 열지 않는다: 메모 한 건 경로의 POST는 허용 메서드가 아니라 405.
    const viaQuery = await run(notesEntry, { method: 'POST', url: `/api/notes?id=${B_NOTE}&restore=1`, query: { id: B_NOTE, restore: '1' }, headers: {}, body: {} });
    assert.deepEqual([viaQuery.code, viaQuery.headers.Allow], [405, 'GET, PUT, DELETE']);
  } finally {
    if (saved.url !== undefined) process.env.SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.SUPABASE_SECRET_KEY = saved.key;
  }
});
