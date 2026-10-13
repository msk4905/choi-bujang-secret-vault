import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { shapeOf } from '../src/judge-trace.mjs';
import { noteHash } from '../src/notes-backup.mjs';
import { createRestoreRoute } from '../api/restore/[id].js';

// 심판 요청의 "모양"만 로그에 남고 값(메모 내용·ID·해시·토큰)은 남지 않는지 가짜 DB로 확인합니다.
const JUDGE_B = { kind: 'judge', userId: '22222222-2222-4222-8222-222222222222', identity: 'b', runId: '99999999-9999-4999-8999-999999999999' };
const STUDENT = { kind: 'student', userId: '33333333-3333-4333-8333-333333333333' };
const NOTE = '44444444-4444-4444-8444-444444444441';
const SECRET_BODY = '아주 비밀스러운 메모 내용 qwerty-12345';
const HASH = 'a'.repeat(64);
const tokens = { 'Bearer judge-token-xyz': JUDGE_B, 'Bearer student-token-xyz': STUDENT };

function fakeDb(rows) {
  const others = (rows.others ??= {}); // 사본·감사 전용 표(메모 표와 따로, 호출마다 새로 만들어도 같은 표를 씀)
  return { from(table = 'notes') {
    const target = table === 'notes' ? rows : (others[table] ??= []);
    const filters = []; let action = 'select'; let patch = null;
    const run = () => {
      const hit = target.filter(row => filters.every(([k, v]) => row[k] === v));
      if (action === 'select') return hit.map(row => ({ ...row }));
      if (action === 'update') { hit.forEach(row => Object.assign(row, patch)); return hit.map(row => ({ id: row.id, owner_id: row.owner_id })); }
      for (const row of hit) target.splice(target.indexOf(row), 1);
      return hit.map(row => ({ id: row.id }));
    };
    const b = {
      select() { return b; }, eq(k, v) { filters.push([k, v]); return b; }, order() { return b; }, limit() { return b; },
      update(v) { action = 'update'; patch = v; return b; }, delete() { action = 'delete'; return b; },
      insert(row) { const key = table === 'vault_notes_backup' ? 'note_id' : 'id'; if (table !== 'vault_audit' && target.some(i => i[key] === row[key])) return Promise.resolve({ error: { code: '23505' } }); target.push({ ...row, ...(table === 'vault_notes_backup' ? { id: target.length + 1 } : {}) }); return Promise.resolve({ error: null }); },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
    }; return b; } };
}

function setup() {
  const rows = [];
  const getDeps = () => ({ verify: async auth => tokens[auth] ?? null, db: fakeDb(rows) });
  const handler = createNotesHandler({ getDeps });
  const restoreRoute = createRestoreRoute({ getDeps });
  const call = (method, { id, auth, body, restore, headers = {} } = {}) => new Promise(resolve => {
    const response = { setHeader() {}, status: code => ({ json: json => resolve({ code, json }), end: () => resolve({ code }) }) };
    (restore ? restoreRoute : handler)({ method, query: id ? { id } : {}, headers: { authorization: auth, ...headers }, body }, response);
  });
  return { rows, call };
}

async function capture(fn) {
  const saved = { warn: console.warn, info: console.info, error: console.error };
  const lines = [];
  for (const k of ['warn', 'info', 'error']) console[k] = line => lines.push({ level: k, line: String(line) });
  try { await fn(); } finally { Object.assign(console, saved); }
  return lines.filter(item => item.line.startsWith('trace:')).map(item => item.line);
}

test('심판의 요청마다 신분·메서드·경로 종류·본문 모양·상태가 한 줄로 남고 값은 남지 않는다', async () => {
  const { call } = setup();
  const lines = await capture(async () => {
    const auth = 'Bearer judge-token-xyz';
    await call('POST', { auth, body: { id: NOTE, title: '비밀 제목', body: SECRET_BODY } });
    await call('PUT', { auth, id: NOTE, body: { title: '변조 제목', body: '변조 내용 ZZZ' } });
    await call('POST', { auth, id: NOTE, restore: true, body: { id: NOTE, ownerId: JUDGE_B.userId, contentSha256: noteHash('비밀 제목', SECRET_BODY), backup: { title: '사본 제목', body: SECRET_BODY } },
      headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'judge-bot/1.0' } });
  });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^trace: judge\/b POST collection q=\{\} body=\{body:str<=100,id:uuid,title:str<=10\} .* -> 201 \d+ms$/u);
  assert.match(lines[1], /^trace: judge\/b PUT item .* -> 200 \d+ms$/u);
  assert.match(lines[2], /^trace: judge\/b POST restore q=\{\} body=\{backup:\{body:str<=100,title:str<=10\},contentSha256:hex64,id:uuid,ownerId:uuid\} ct=application\/json ua=judge-bot\/1\.0 -> 200 restored=updated verified \d+ms$/u);
  const all = lines.join('\n');
  for (const secret of [SECRET_BODY, '비밀 제목', '변조 제목', '변조 내용', '사본 제목', NOTE, JUDGE_B.userId, JUDGE_B.runId, HASH, noteHash('비밀 제목', SECRET_BODY), 'judge-token-xyz']) {
    assert.equal(all.includes(secret), false, `로그에 값이 남음: ${secret}`);
  }
});

test('실패 응답은 상수 오류 이름만 남는다(미리보기·사본 없음·형식 오류)', async () => {
  const { call } = setup();
  const lines = await capture(async () => {
    const auth = 'Bearer judge-token-xyz';
    await call('POST', { auth, body: { id: NOTE, title: 't', body: 'b' } });
    await call('PUT', { auth, id: NOTE, body: { title: '다른 제목', body: '다른 내용' } });
    await call('POST', { auth, id: NOTE, restore: true, body: { dryRun: true } });
    await call('POST', { auth, id: NOTE, restore: true, body: { contentSha256: 'zz' } });
    await call('POST', { auth, id: '66666666-6666-4666-8666-666666666666', restore: true });
  });
  assert.match(lines[2], /-> 200 preview \d+ms$/u);
  assert.match(lines[3], /-> 400 error=INVALID_RESTORE \d+ms$/u);
  assert.match(lines[4], /body=none .* -> 404 error=NOT_FOUND \d+ms$/u);
});

test('학생 본인의 요청은 기록하지 않고, 로그인 실패는 본문 없이 최소한만 남긴다', async () => {
  const { call } = setup();
  const lines = await capture(async () => {
    await call('POST', { auth: 'Bearer student-token-xyz', body: { id: NOTE, title: '학생 제목', body: SECRET_BODY } });
    await call('GET', { auth: 'Bearer student-token-xyz' });
    await call('POST', { id: NOTE, restore: true, body: { contentSha256: HASH }, headers: { 'user-agent': 'curl/8' } });
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0], 'trace: anon POST restore ua=curl/8 -> 401');
});

test('shapeOf는 값 대신 종류만 보여 주고, 깊이와 키 개수를 제한하며 이상한 키 이름은 가린다', () => {
  assert.equal(shapeOf('x'.repeat(2000)), 'str>1000');
  assert.equal(shapeOf('sha256:' + 'b'.repeat(64)), 'sha256:hex64');
  assert.equal(shapeOf('A'.repeat(43) + '='), 'base64-32B');
  assert.equal(shapeOf({ a: { b: { c: { d: 1 } } } }), '{a:{b:{c:obj...}}}');
  assert.equal(shapeOf([1, 2, 3]), 'array[3]');
  assert.equal(shapeOf({ ['메모 내용 비밀']: 'x' }), '{?:str<=10}');
  assert.equal(shapeOf(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, '0')}`, 1]))).split(',').length, 12);
  assert.equal(shapeOf({ dryRun: true, n: 5, z: null }), '{dryRun:true,n:num,z:null}');
});
