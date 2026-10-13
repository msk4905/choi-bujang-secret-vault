import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { noteHash } from '../src/notes-restore.mjs';

// 가짜 로그인 검사기와 메모리 DB만 씁니다. 실제 Supabase·실제 토큰은 쓰지 않습니다.
// 복원 대상은 시험 계정 B의 가상 메모뿐입니다. A는 B의 메모를 요청했을 때 거부되는지 보는 요청자로만 나옵니다.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const B_NOTE = '44444444-4444-4444-8444-444444444441';
const B_OTHER = '44444444-4444-4444-8444-444444444442';
const A_NOTE = '55555555-5555-4555-8555-555555555551';
const people = { 'Bearer token-a': { userId: A }, 'Bearer token-b': { userId: B } };

function fakeDb(tables, writes, { dropWrites = false, corruptWrites = false, onWrite = null } = {}) {
  let firstWrite = true; // 변조·끼어들기는 첫 쓰기에만 적용한다
  const once = () => { const first = firstWrite; firstWrite = false; return first; };
  return {
    from(name) {
      const rows = tables[name];
      const filters = [];
      let action = 'select';
      let patch = null;
      const run = () => {
        const hit = rows.filter(row => filters.every(([k, v]) => row[k] === v));
        if (action === 'select') return hit.map(row => ({ ...row }));
        writes.push([name, action]);
        if (action === 'update') {
          if (!dropWrites) hit.forEach(row => Object.assign(row, patch));
          if (once()) {
            if (corruptWrites) hit.forEach(row => { row.content += '(변조)'; });
            if (onWrite) onWrite();
          }
          return hit.map(row => ({ id: row.id, owner_id: row.owner_id }));
        }
        for (const row of hit) rows.splice(rows.indexOf(row), 1);
        return hit.map(row => ({ id: row.id }));
      };
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        order() { return builder; },
        update(value) { action = 'update'; patch = value; return builder; },
        delete() { action = 'delete'; return builder; },
        insert(row) {
          writes.push([name, 'insert']);
          if (rows.some(item => item.id === row.id)) return Promise.resolve({ error: { code: '23505' } });
          if (!dropWrites) rows.push({ ...row });
          if (once()) {
            if (corruptWrites) rows[rows.length - 1].content += '(변조)';
            if (onWrite) onWrite();
          }
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

const note = (id, owner, title, content) => ({ id, owner_id: owner, title, content });
const backupOf = row => ({ ...row, content_sha256: noteHash(row.title, row.content) });

function setup(options) {
  const original = note(B_NOTE, B, '가상 B 메모', '가상 내용입니다');
  const tables = {
    notes: [note(B_OTHER, B, '가상 B 다른 메모', '다른 내용'), note(A_NOTE, A, '가상 A 메모', 'A 내용')],
    notes_backup: [backupOf(original), backupOf(note(B_OTHER, B, '가상 B 다른 메모', '옛 내용'))],
  };
  const writes = [];
  const handler = createNotesHandler({ getDeps: () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(tables, writes, options) }) });
  const call = (method, { id, auth, body, restore = '1' } = {}) => new Promise(resolve => {
    const response = {
      setHeader() {},
      status(code) { return { json: json => resolve({ code, json }), end: () => resolve({ code }) }; },
    };
    handler({ method, query: { ...(id === undefined ? {} : { id }), ...(restore ? { restore } : {}) }, headers: { authorization: auth }, body }, response);
  });
  return { tables, writes, call, original, hash: noteHash(original.title, original.content) };
}

async function quiet(fn) {
  const saved = { warn: console.warn, info: console.info, error: console.error };
  const logged = [];
  for (const k of ['warn', 'info', 'error']) console[k] = line => logged.push(String(line));
  try { return [await fn(), logged]; } finally { Object.assign(console, saved); }
}
const snapshot = rows => JSON.stringify(rows);

test('지워진 B 메모 한 건을 사본에서 되살리고 ID·소유자·내용 해시가 사본과 같다', async () => {
  const { tables, writes, call, original, hash } = setup();
  const before = { others: snapshot(tables.notes), backup: snapshot(tables.notes_backup) };
  const [result, logged] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.equal(result.code, 201);
  assert.deepEqual(result.json, { id: B_NOTE, restored: 'created', verified: true });
  const live = tables.notes.find(row => row.id === B_NOTE);
  assert.equal(live.id, original.id);
  assert.equal(live.owner_id, original.owner_id);
  assert.equal(noteHash(live.title, live.content), hash);
  assert.deepEqual(writes, [['notes', 'insert']]);
  assert.equal(snapshot(tables.notes.filter(row => row.id !== B_NOTE)), before.others);
  assert.equal(snapshot(tables.notes_backup), before.backup);
  assert.deepEqual(logged, ['notes restored: created']);
  for (const secret of [B_NOTE, A, B, 'token-b', original.content, hash]) assert.equal(logged.join('\n').includes(secret), false);
});

test('내용이 바뀐 B 메모는 사본 내용으로 한 건만 되돌리고 다른 메모는 그대로 둔다', async () => {
  const { tables, writes, call, original, hash } = setup();
  tables.notes.push(note(B_NOTE, B, '고친 제목', '고친 내용'));
  const others = snapshot(tables.notes.filter(row => row.id !== B_NOTE));
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash.toUpperCase(), owner_id: A } }));
  assert.equal(result.code, 200);
  assert.equal(result.json.restored, 'updated');
  const live = tables.notes.find(row => row.id === B_NOTE);
  assert.deepEqual([live.title, live.content, live.owner_id], [original.title, original.content, B]);
  assert.deepEqual(writes, [['notes', 'update']]);
  assert.equal(snapshot(tables.notes.filter(row => row.id !== B_NOTE)), others);
});

test('이미 사본과 같으면 아무것도 쓰지 않는다', async () => {
  const { tables, writes, call, hash } = setup();
  tables.notes.push({ ...tables.notes_backup[0] });
  delete tables.notes[tables.notes.length - 1].content_sha256;
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json.restored], [200, 'unchanged']);
  assert.deepEqual(writes, []);
});

test('요청의 해시가 사본과 다르면 409로 중단하고 쓰지 않는다', async () => {
  const { tables, writes, call } = setup();
  const before = snapshot(tables.notes);
  const [result, logged] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: 'a'.repeat(64) } }));
  assert.deepEqual([result.code, result.json], [409, { error: 'HASH_MISMATCH' }]);
  assert.deepEqual(writes, []);
  assert.equal(snapshot(tables.notes), before);
  assert.deepEqual(logged, ['notes restore denied: request_hash_differs']);
});

test('사본 내용이 적힌 해시와 다르면(변조) 요청 해시가 맞아도 중단한다', async () => {
  const { tables, writes, call, hash } = setup();
  tables.notes_backup[0].content = '바뀐 사본 내용';
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [409, { error: 'BACKUP_HASH_MISMATCH' }]);
  assert.deepEqual(writes, []);
});

test('A가 B의 메모를 요청하면 사본이 있어도 404이고 아무것도 쓰지 않는다', async () => {
  const { tables, writes, call, hash } = setup();
  const before = snapshot(tables.notes);
  const [result, logged] = await quiet(() => call('POST', { auth: 'Bearer token-a', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual(writes, []);
  assert.equal(snapshot(tables.notes), before);
  assert.deepEqual(logged, ['notes restore denied: not_owner']);
});

test('같은 ID의 현재 메모 주인이 사본 소유자와 다르면 덮어쓰지 않는다', async () => {
  const { tables, writes, call, hash } = setup();
  tables.notes.push(note(B_NOTE, A, '다른 주인', '다른 내용'));
  const before = snapshot(tables.notes);
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [404, { error: 'NOT_FOUND' }]);
  assert.deepEqual(writes, []);
  assert.equal(snapshot(tables.notes), before);
});

test('복원 뒤 다시 읽은 값이 사본과 다르면 502로 알린다', async () => {
  const { call, hash } = setup({ dropWrites: true });
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
});

test('로그인 없음 401, 사본 없음 404, 잘못된 본문·ID 400, POST 아닌 메서드 405', async () => {
  const { writes, call, hash } = setup();
  const b = { auth: 'Bearer token-b' };
  const [codes] = await quiet(async () => [
    (await call('POST', { id: B_NOTE, body: { contentSha256: hash } })).code,
    (await call('POST', { ...b, id: '66666666-6666-4666-8666-666666666666', body: { contentSha256: hash } })).code,
    (await call('POST', { ...b, id: B_NOTE, body: {} })).code,
    (await call('POST', { ...b, id: B_NOTE, body: { contentSha256: 'zz' } })).code,
    (await call('POST', { ...b, id: 'not-a-uuid', body: { contentSha256: hash } })).code,
    (await call('POST', { ...b, body: { contentSha256: hash } })).code,
    (await call('GET', { ...b, id: B_NOTE })).code,
    (await call('PUT', { ...b, id: B_NOTE, body: { title: 't', body: 'b' } })).code,
    (await call('DELETE', { ...b, id: B_NOTE })).code,
  ]);
  assert.deepEqual(codes, [401, 404, 400, 400, 400, 400, 405, 405, 405]);
  assert.deepEqual(writes, []);
});

test('기존 메모 경로는 restore 쿼리가 없으면 그대로다', async () => {
  const { call } = setup();
  const [result] = await quiet(() => call('GET', { auth: 'Bearer token-b', restore: '' }));
  assert.equal(result.code, 200);
  assert.deepEqual(result.json.map(item => item.id), [B_OTHER]);
});

test('vercel.json 주소 변환과 허용 경로가 구현과 맞다', () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  const sources = vercel.rewrites.map(item => item.source);
  assert.ok(sources.indexOf('/api/notes/:id/restore') < sources.indexOf('/api/notes/:id'));
  assert.equal(vercel.rewrites.find(item => item.source === '/api/notes/:id/restore').destination, '/api/notes?id=:id&restore=1');
  assert.ok(config.allowedRoutes.includes('POST /api/notes/:id/restore'));
  assert.equal(config.restoreRoute, 'POST /api/notes/:id/restore');
});

test('복원 뒤 검증에 실패하면 쓴 내용을 되돌린다: 새로 만든 행은 지운다', async () => {
  const { tables, call, hash } = setup({ corruptWrites: true });
  const before = snapshot(tables.notes);
  const [result, logged] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
  assert.equal(snapshot(tables.notes), before);
  assert.ok(logged.some(line => line.includes('notes restore unverified')));
  for (const secret of [B_NOTE, A, B, hash, '변조']) assert.equal(logged.join('\n').includes(secret), false);
});

test('복원 뒤 검증에 실패하면 쓴 내용을 되돌린다: 고친 행은 이전 내용으로 돌린다', async () => {
  const { tables, call, hash } = setup({ corruptWrites: true });
  tables.notes.push(note(B_NOTE, B, '고친 제목', '고친 내용'));
  const before = snapshot(tables.notes);
  const [result] = await quiet(() => call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: hash } }));
  assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
  assert.equal(snapshot(tables.notes), before);
});

test('쓰는 사이 사본이 바뀌면 사본을 다시 읽어 알아채고 되돌린다', async () => {
  let tables;
  const state = setup({ onWrite: () => { tables.notes_backup[0].content = '사이에 바뀐 사본'; } });
  tables = state.tables;
  const before = snapshot(tables.notes);
  const [result] = await quiet(() => state.call('POST', { auth: 'Bearer token-b', id: B_NOTE, body: { contentSha256: state.hash } }));
  assert.deepEqual([result.code, result.json], [502, { error: 'RESTORE_UNVERIFIED' }]);
  assert.equal(snapshot(tables.notes), before);
});
