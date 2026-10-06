import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';

// 가짜 로그인 검사기와 메모리 DB만 씁니다. 실제 Supabase·실제 토큰은 쓰지 않습니다.
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const people = { 'Bearer token-a': { userId: A }, 'Bearer token-b': { userId: B } };

function fakeDb(rows) {
  return {
    from() {
      const filters = [];
      let action = 'select';
      let patch = null;
      let wantRows = false;
      const run = () => {
        const hit = rows.filter(row => filters.every(([k, v]) => row[k] === v));
        if (action === 'select') return hit.map(({ id, title, content }) => ({ id, title, content }));
        if (action === 'update') { hit.forEach(row => Object.assign(row, patch)); return hit.map(row => ({ id: row.id })); }
        for (const row of hit) rows.splice(rows.indexOf(row), 1);
        return hit.map(row => ({ id: row.id }));
      };
      const builder = {
        select() { if (action !== 'select') wantRows = true; return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        order() { return builder; },
        update(value) { action = 'update'; patch = value; return builder; },
        delete() { action = 'delete'; return builder; },
        insert(row) {
          if (rows.some(item => item.id === row.id)) return Promise.resolve({ error: { code: '23505' } });
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null, wantRows }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

function setup() {
  const rows = [];
  const handler = createNotesHandler({
    getDeps: () => ({ verify: async auth => people[auth] ?? null, db: fakeDb(rows) }),
    newId: () => '33333333-3333-4333-8333-333333333333',
  });
  return { rows, call: (method, { id, auth, body } = {}) => new Promise(resolve => {
    const headers = {};
    const response = {
      setHeader: (k, v) => { headers[k] = v; },
      status(code) {
        return {
          json: json => resolve({ code, json, headers }),
          end: () => resolve({ code, json: undefined, headers }),
        };
      },
    };
    handler({ method, query: id === undefined ? {} : { id }, headers: { authorization: auth }, body }, response);
  }) };
}

test('로그인 없거나 검사에 실패한 요청은 자료 없이 401', async () => {
  const { call, rows } = setup();
  rows.push({ id: 'x', title: 't', content: 'c', owner_id: A });
  for (const [method, opts] of [['GET', {}], ['POST', { body: { title: 't', body: 'b' } }],
    ['GET', { id: A }], ['PUT', { id: A, body: { title: 't', body: 'b' } }], ['DELETE', { id: A }]]) {
    for (const auth of [undefined, 'Bearer nope']) {
      const result = await call(method, { ...opts, auth });
      assert.equal(result.code, 401);
      assert.deepEqual(result.json, { error: 'UNAUTHENTICATED' });
    }
  }
  assert.equal(rows.length, 1);
});

test('A가 추가·조회·수정·삭제하고 지운 뒤 GET은 404', async () => {
  const { call, rows } = setup();
  const created = await call('POST', { auth: 'Bearer token-a', body: { title: '제목', body: '내용' } });
  assert.equal(created.code, 201);
  assert.deepEqual(created.json, { id: '33333333-3333-4333-8333-333333333333' });
  assert.equal(rows[0].owner_id, A);
  const { id } = created.json;
  assert.deepEqual((await call('GET', { auth: 'Bearer token-a', id })).json, { id, title: '제목', body: '내용' });
  assert.deepEqual((await call('GET', { auth: 'Bearer token-a' })).json, [{ id, title: '제목', body: '내용' }]);
  assert.equal((await call('PUT', { auth: 'Bearer token-a', id, body: { title: '새 제목', body: '새 내용' } })).code, 200);
  assert.equal((await call('GET', { auth: 'Bearer token-a', id })).json.title, '새 제목');
  assert.equal((await call('DELETE', { auth: 'Bearer token-a', id })).code, 204);
  assert.equal((await call('GET', { auth: 'Bearer token-a', id })).code, 404);
  assert.equal((await call('DELETE', { auth: 'Bearer token-a', id })).code, 404);
});

test('본문의 owner_id·userId는 무시하고 서버가 확인한 ID를 저장한다', async () => {
  const { call, rows } = setup();
  const sent = { title: 't', body: 'b', owner_id: B, userId: B, role: 'admin' };
  assert.equal((await call('POST', { auth: 'Bearer token-a', body: sent })).code, 201);
  assert.equal(rows[0].owner_id, A);
  assert.equal(Object.hasOwn(rows[0], 'role'), false);
});

test('id를 보내면 그 UUID로 만들고 중복은 409, 잘못된 입력은 400', async () => {
  const { call } = setup();
  const id = '44444444-4444-4444-8444-444444444444';
  assert.deepEqual((await call('POST', { auth: 'Bearer token-a', body: { id, title: 't', body: 'b' } })).json, { id });
  assert.equal((await call('POST', { auth: 'Bearer token-a', body: { id, title: 't', body: 'b' } })).code, 409);
  for (const body of [{ id: 'abc', title: 't', body: 'b' }, { title: '', body: 'b' }, { title: 't' },
    { title: 't', body: 'x'.repeat(5001) }, 'not json', null, []]) {
    assert.equal((await call('POST', { auth: 'Bearer token-a', body })).code, 400);
  }
  assert.equal((await call('GET', { auth: 'Bearer token-a', id: 'not-a-uuid' })).code, 400);
});

test('아직 소유자 검사가 없어 B가 A의 메모를 고칠 수 있다(4단계 과제), 목록은 본인 것만', async () => {
  const { call } = setup();
  const { json: { id } } = await call('POST', { auth: 'Bearer token-a', body: { title: 'A', body: 'a' } });
  assert.deepEqual((await call('GET', { auth: 'Bearer token-b' })).json, []);
  assert.equal((await call('PUT', { auth: 'Bearer token-b', id, body: { title: 'B', body: 'b' } })).code, 200);
});

test('허용하지 않는 메서드는 405, 설정이 없으면 503', async () => {
  const { call } = setup();
  const patch = await call('PATCH', { auth: 'Bearer token-a' });
  assert.equal(patch.code, 405);
  assert.equal(patch.headers.Allow, 'GET, POST');
  assert.equal((await call('POST', { auth: 'Bearer token-a', id: A, body: {} })).code, 405);
  const bare = createNotesHandler({ getDeps: () => null });
  let code;
  await bare({ method: 'GET', query: {}, headers: {} }, { setHeader() {}, status: c => { code = c; return { json() {} }; } });
  assert.equal(code, 503);
});
