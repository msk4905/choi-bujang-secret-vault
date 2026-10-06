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
        if (action === 'select') return hit.map(row => ({ ...row }));
        if (action === 'update') { hit.forEach(row => Object.assign(row, patch)); return hit.map(row => ({ id: row.id, owner_id: row.owner_id })); }
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

test('B는 A의 메모를 읽거나 고치거나 지울 수 없고 A의 메모는 그대로다', async () => {
  const { call, rows } = setup();
  const { json: { id } } = await call('POST', { auth: 'Bearer token-a', body: { title: 'A', body: 'a' } });
  const before = JSON.stringify(rows);
  assert.deepEqual((await call('GET', { auth: 'Bearer token-b' })).json, []);
  for (const [method, body] of [['GET'], ['PUT', { title: 'B', body: 'b' }], ['DELETE']]) {
    const result = await call(method, { auth: 'Bearer token-b', id, body });
    assert.equal(result.code, 404);
    assert.deepEqual(result.json, { error: 'NOT_FOUND' });
  }
  assert.equal(JSON.stringify(rows), before);
  // 같은 요청이 없는 id와 구별되지 않아 남의 메모의 존재를 알려 주지 않는다.
  assert.deepEqual((await call('GET', { auth: 'Bearer token-b', id: '55555555-5555-4555-8555-555555555555' })).json,
    (await call('GET', { auth: 'Bearer token-b', id })).json);
});

test('A와 B는 각자 자기 메모를 읽고 추가하고 고치고 지운다', async () => {
  const { call, rows } = setup();
  const a = (await call('POST', { auth: 'Bearer token-a', body: { id: '66666666-6666-4666-8666-666666666666', title: 'A', body: 'a' } })).json.id;
  const b = (await call('POST', { auth: 'Bearer token-b', body: { id: '77777777-7777-4777-8777-777777777777', title: 'B', body: 'b' } })).json.id;
  assert.deepEqual(rows.map(row => row.owner_id), [A, B]);
  assert.deepEqual((await call('GET', { auth: 'Bearer token-a', id: a })).json, { id: a, title: 'A', body: 'a' });
  assert.deepEqual((await call('GET', { auth: 'Bearer token-b', id: b })).json, { id: b, title: 'B', body: 'b' });
  assert.equal((await call('PUT', { auth: 'Bearer token-b', id: b, body: { title: 'B2', body: 'b2' } })).code, 200);
  assert.deepEqual((await call('GET', { auth: 'Bearer token-b' })).json, [{ id: b, title: 'B2', body: 'b2' }]);
  assert.equal((await call('DELETE', { auth: 'Bearer token-a', id: a })).code, 204);
  assert.equal((await call('DELETE', { auth: 'Bearer token-b', id: b })).code, 204);
  assert.equal(rows.length, 0);
});

test('수정으로 소유자를 바꿀 수 없다: 본문의 owner_id·userId는 무시된다', async () => {
  const { call, rows } = setup();
  const { json: { id } } = await call('POST', { auth: 'Bearer token-a', body: { title: 'A', body: 'a' } });
  const sent = { title: 'A2', body: 'a2', owner_id: B, userId: B };
  assert.equal((await call('PUT', { auth: 'Bearer token-a', id, body: sent })).code, 200);
  assert.equal(rows[0].owner_id, A);
  assert.equal(rows[0].title, 'A2');
  // 소유자가 바뀐 뒤에는 A도 접근할 수 없다(B가 자기 메모를 A 명의로 되돌릴 방법도 없다).
  rows[0].owner_id = B;
  assert.equal((await call('PUT', { auth: 'Bearer token-a', id, body: { title: 'x', body: 'y' } })).code, 404);
  assert.equal(rows[0].title, 'A2');
});

test('주인이 없는 메모는 누구도 읽거나 고치거나 지울 수 없다', async () => {
  const { call, rows } = setup();
  const id = '88888888-8888-4888-8888-888888888888';
  rows.push({ id, title: '주인 없음', content: 'c', owner_id: null });
  for (const [method, body] of [['GET'], ['PUT', { title: 't', body: 'b' }], ['DELETE']]) {
    assert.equal((await call(method, { auth: 'Bearer token-a', id, body })).code, 404);
  }
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_id, null);
});

test('확인과 쓰기 사이에 소유자가 바뀌어도 남의 행은 고치거나 지우지 않는다', async () => {
  const rows = [{ id: '99999999-9999-4999-8999-999999999999', title: 'A', content: 'a', owner_id: A }];
  const db = fakeDb(rows);
  // 읽기 확인은 A 소유로 보이게 하고, 쓰기 직전에 B 소유로 바꾼다.
  const racing = { from: () => { const builder = db.from(); const originalUpdate = builder.update; const originalDelete = builder.delete;
    builder.update = value => { rows[0].owner_id = B; return originalUpdate(value); };
    builder.delete = () => { rows[0].owner_id = B; return originalDelete(); };
    return builder; } };
  let first = true;
  const handler = createNotesHandler({ getDeps: () => ({ verify: async auth => people[auth] ?? null, db: { from: () => (first ? (first = false, db.from()) : racing.from()) } }) });
  const send = method => new Promise(resolve => handler({ method, query: { id: rows[0].id }, headers: { authorization: 'Bearer token-a' }, body: { title: 'x', body: 'y' } },
    { setHeader() {}, status: code => ({ json: () => resolve(code), end: () => resolve(code) }) }));
  assert.equal(await send('PUT'), 404);
  assert.equal(rows[0].title, 'A');
  rows[0].owner_id = A;
  first = true;
  assert.equal(await send('DELETE'), 404);
  assert.equal(rows.length, 1);
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
