import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createNotesHandler } from '../src/notes-handler.mjs';
import { createRestoreRoute } from '../api/restore/[id].js';
import { runSelfCheck } from '../scripts/restore-selfcheck.mjs';

// 실제 핸들러(메모 API + 복구 경로)를 가짜 DB 위에 올린 로컬 서버로 확인 스크립트를 시험합니다. 실제 Supabase·실제 토큰은 쓰지 않습니다.
const USER = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'test-token-for-selfcheck-0123456789';

function fakeDb(rows) {
  const others = (rows.others ??= {}); // 사본·감사 전용 표(메모 표와 따로, 호출마다 새로 만들어도 같은 표를 씀)
  return {
    from(table = 'notes') {
      const target = table === 'notes' ? rows : (others[table] ??= []);
    const filters = [];
      let action = 'select';
      let patch = null;
      const run = () => {
        const hit = target.filter(row => filters.every(([k, v]) => row[k] === v));
        if (action === 'select') return hit.map(row => ({ ...row }));
        if (action === 'update') { hit.forEach(row => Object.assign(row, patch)); return hit.map(row => ({ id: row.id, owner_id: row.owner_id })); }
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
        insert(row) {
          const key = table === 'vault_notes_backup' ? 'note_id' : 'id';
          if (table !== 'vault_audit' && target.some(item => item[key] === row[key])) return Promise.resolve({ error: { code: '23505' } });
          target.push({ ...row, ...(table === 'vault_notes_backup' ? { id: target.length + 1 } : {}) });
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
        then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

async function withServer(options, fn) {
  const rows = [];
  const getDeps = () => ({
    verify: async auth => (auth === `Bearer ${TOKEN}` ? { userId: USER } : null), db: fakeDb(rows),
  });
  const handler = createNotesHandler({ getDeps, ...options });
  const restoreRoute = createRestoreRoute({ getDeps, ...options });
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const restore = /^\/api\/restore\/([^/]+)$/u.exec(url.pathname);
      const item = /^\/api\/notes\/([^/]+)$/u.exec(url.pathname);
      const query = restore ? { id: restore[1] } : item ? { id: item[1] } : {};
      let body;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) { try { body = JSON.parse(text); } catch { body = text; } }
      const headers = {};
      (restore ? restoreRoute : handler)({ method: req.method, query, headers: { authorization: req.headers.authorization }, body }, {
        setHeader: (k, v) => { headers[k] = v; },
        status: code => ({
          json: json => { res.writeHead(code, { ...headers, 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); },
          end: () => { res.writeHead(code, headers); res.end(); },
        }),
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`, rows); } finally { await new Promise(resolve => server.close(resolve)); }
}

const quiet = async fn => {
  const saved = { warn: console.warn, info: console.info, error: console.error };
  for (const k of ['warn', 'info', 'error']) console[k] = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};

test('복구가 되는 서버에서는 13단계가 모두 통과하고 시험용 메모는 정리된다', async () => {
  await withServer({}, async (baseUrl, rows) => {
    const lines = [];
    const outcome = await quiet(() => runSelfCheck({ baseUrl, token: TOKEN, log: line => lines.push(line) }));
    assert.equal(outcome.ok, true, lines.join('\n'));
    assert.equal(outcome.results.length, 13);
    assert.equal(rows.length, 0); // 시험용 메모는 지워짐
    assert.equal(rows.others.vault_notes_backup.length, 1); // 사본은 전용 표에 남음(API로 못 지움)
    assert.ok(rows.others.vault_audit.length >= 2); // 복구 결과는 감사 표에 덧붙음
    const output = lines.join('\n');
    assert.match(output, /요약: 13\/13 통과/u);
    for (const secret of [TOKEN, USER]) assert.equal(output.includes(secret), false, secret);
    assert.doesNotMatch(output, /(원본|변조) [0-9a-f]{12}/u); // 시험용 메모 내용은 출력하지 않음
  });
});

test('사본이 저장되지 않는 서버에서는 복구 단계에서 실패를 잡고 첫 실패를 알려 준다', async () => {
  await withServer({ saveBackup: async () => {} }, async (baseUrl) => {
    const lines = [];
    const outcome = await quiet(() => runSelfCheck({ baseUrl, token: TOKEN, log: line => lines.push(line) }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.firstFailure, /^4 /u); // 사본이 없으면 미리보기부터 실패
    assert.match(lines.join('\n'), /첫 실패: 4 /u);
  });
});

test('복구 경로가 없는 서버(404)와 응답 없는 서버는 실패로 보고한다', async () => {
  const dead = createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise(resolve => dead.listen(0, '127.0.0.1', resolve));
  try {
    const outcome = await quiet(() => runSelfCheck({ baseUrl: `http://127.0.0.1:${dead.address().port}`, token: TOKEN, log: () => {} }));
    assert.equal(outcome.ok, false);
    assert.match(outcome.firstFailure, /^1 /u);
  } finally { await new Promise(resolve => dead.close(resolve)); }
  const refused = await quiet(() => runSelfCheck({ baseUrl: 'http://127.0.0.1:1', token: TOKEN, log: () => {}, timeoutMs: 2000 }));
  assert.equal(refused.ok, false);
});

test('https가 아닌 원격 주소와 토큰 없음은 요청을 보내기 전에 거부한다', async () => {
  await assert.rejects(runSelfCheck({ baseUrl: 'http://example.com', token: TOKEN, log: () => {} }), /https/u);
  const withUserInfo = new URL('https://example.com');
  withUserInfo.username = 'someone';
  withUserInfo.password = 'dummy';
  await assert.rejects(runSelfCheck({ baseUrl: withUserInfo.href, token: TOKEN, log: () => {} }), /https/u);
  await assert.rejects(runSelfCheck({ baseUrl: 'https://example.com', token: '', log: () => {} }), /토큰/u);
});
