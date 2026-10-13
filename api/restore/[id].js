// 메모 한 건 복구 경로: POST /api/restore/:id (Vercel이 파일 이름의 [id]를 request.query.id로 채워 줍니다).
// 이 파일 하나에 복구의 검증·복원 흐름이 모두 있습니다. 순서는 아래와 같습니다.
//   ① 검증한 사본을 다시 읽는다: 사본 행 위치(메모 ID·소유자), 사본 기록 안의 ID·소유자, 내용 해시를 모두 대조한다.
//      사본이 없거나(404) 어긋나면(409) 아무것도 쓰지 않고 멈춘다.
//   ② 요청이 담아 온 ID·소유자·제목·내용·해시가 있으면 검증된 사본과 대조만 한다(믿고 쓰지 않음). 하나라도 다르면 쓰지 않고 멈춘다(409).
//      복원은 두 번에 나눠 한다. 처음 호출(또는 {"dryRun": true})은 복원할 버전과 바뀔 항목만 보여 주고 아무것도 쓰지 않는다.
//      그 응답의 version을 {"confirm": "<version>"}으로 되돌려 보낸 호출만 실제로 쓴다. 버전이 다르면 쓰지 않고 멈춘다(409).
//   ③ 현재 메모를 읽고(남의 메모면 404), 제목·내용만 사본 값으로 되살린다(없으면 같은 ID·주인으로 다시 만든다). 다른 메모는 고치지 않는다.
//   ④ 쓴 뒤 사본과 되살린 행을 새로 읽어 ID·소유자·내용 해시를 다시 대조한다. 어긋나면 쓴 내용을 되돌리고 멈춘다(502).
// 사용자·소유자는 서버가 확인한 로그인 결과만 씁니다. 운영 정책에는 접근하지 않고, 감사 기록은 지우거나 고치지 않습니다
// (복구 결과는 서버 로그에 짧은 코드로만 남기며 ID·본문·토큰은 싣지 않습니다).
// 로그인 확인·환경 설정·심판 요청 추적은 src/notes-handler.mjs가 맡고, 이 파일의 restore 함수를 부릅니다.
import { createHash } from 'node:crypto';
import { createNotesHandler } from '../../src/notes-handler.mjs';
import { backupOwnerId, backupRowId, noteHash } from '../../src/notes-backup.mjs';

const HEX64 = /^[0-9a-f]{64}$/u;

// 요청 본문은 선택입니다. 본문에 ID·소유자·제목·내용·해시를 "주장"으로 담아 보내면 검증된 사본과 대조만 하고(값을 믿고 쓰지 않음),
// 하나라도 다르면 복원하지 않고 멈춥니다. 같은 뜻의 이름은 모두 받습니다(대소문자 무시).
const CLAIM_NAMES = {
  id: ['id', 'noteid', 'note_id'],
  owner: ['ownerid', 'owner_id', 'owner', 'userid', 'user_id'],
  hash: ['contentsha256', 'content_sha256', 'sha256', 'contenthash', 'content_hash', 'hash'],
  title: ['title'],
  content: ['body', 'content'],
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function readRestoreInput(request) {
  let body = request.body;
  if (typeof body === 'string') {
    if (body.trim() === '') body = {};
    else { try { body = JSON.parse(body); } catch { return null; } }
  }
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [k.toLowerCase(), v]));
  const input = {};
  const take = (kind) => {
    const names = CLAIM_NAMES[kind].filter(name => lower[name] !== undefined);
    return names.map(name => lower[name]);
  };
  for (const value of take('id')) {
    if (typeof value !== 'string' || !UUID.test(value)) return null;
    (input.ids ??= []).push(value.toLowerCase());
  }
  for (const value of take('owner')) {
    if (typeof value !== 'string' || !UUID.test(value)) return null;
    (input.owners ??= []).push(value.toLowerCase());
  }
  for (const value of take('hash')) {
    const hash = typeof value === 'string' ? value.toLowerCase().replace(/^sha256:/u, '') : '';
    if (!HEX64.test(hash)) return null;
    (input.hashes ??= []).push(hash);
  }
  for (const value of take('title')) {
    if (typeof value !== 'string') return null;
    (input.titles ??= []).push(value);
  }
  for (const value of take('content')) {
    if (typeof value !== 'string') return null;
    (input.contents ??= []).push(value);
  }
  if (lower.confirm !== undefined) {
    if (typeof lower.confirm !== 'string' || !lower.confirm) return null;
    input.confirm = lower.confirm.toLowerCase();
  }
  if (lower.dryrun !== undefined) {
    if (typeof lower.dryrun !== 'boolean') return null;
    input.dryRun = lower.dryrun;
  }
  return input;
}

const logDenied = (reason) => console.warn(`notes restore denied: ${reason}`);

// 사본을 새로 읽고 검증합니다: 행 위치(ID·소유자), 기록 안의 메모 ID·소유자, 내용 해시가 모두 맞아야 합니다.
async function readBackup(db, principal, noteId) {
  const { data: row, error } = await db.from('notes').select('id, owner_id, title, content')
    .eq('id', backupRowId(noteId)).eq('owner_id', backupOwnerId(principal.userId)).maybeSingle();
  if (error) throw error;
  if (!row) return { error: 'no_backup' };
  let record;
  try { record = JSON.parse(row.content); } catch { return { error: 'backup_corrupt' }; }
  const valid = record && typeof record === 'object' && record.v === 1
    && record.id === noteId && record.owner === principal.userId
    && typeof record.title === 'string' && typeof record.content === 'string'
    && typeof record.sha256 === 'string' && HEX64.test(record.sha256)
    && noteHash(record.title, record.content) === record.sha256;
  return valid ? { record } : { error: 'backup_corrupt' };
}

// 반환: { code, json }. 오류는 던지지 않고 호출한 쪽(handler)의 try/catch에 맡깁니다.
export async function restoreNote({ db, principal, id, input }) {
  // ① 검증한 사본을 다시 읽는다. 서로 독립인 읽기(사본, 현재 메모)는 동시에 합니다. 사본 검증이 실패하면 메모 읽기 결과는 쓰지 않습니다.
  const [found, liveRead] = await Promise.all([
    readBackup(db, principal, id),
    db.from('notes').select('id, title, content, owner_id').eq('id', id).maybeSingle(),
  ]);
  if (found.error === 'no_backup') {
    logDenied('no_backup');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  if (found.error) {
    logDenied('backup_corrupt');
    return { code: 409, json: { error: 'BACKUP_HASH_MISMATCH' } };
  }
  const { record } = found;
  // ② 요청이 담아 온 값은 믿고 쓰지 않고 검증된 사본과 대조만 한다.
  const hash = record.sha256;
  // 요청이 담아 온 주장은 사본과 대조만 합니다. 해시는 제목+본문 해시와 본문만의 해시를 모두 인정합니다.
  const bodyOnlyHash = createHash('sha256').update(record.content, 'utf8').digest('hex');
  const allIn = (list, ok) => (list ?? []).every(ok);
  if (!allIn(input.hashes, (h) => h === hash || h === bodyOnlyHash)) {
    logDenied('request_hash_differs');
    return { code: 409, json: { error: 'HASH_MISMATCH' } };
  }
  if (!allIn(input.ids, (v) => v === id) || !allIn(input.owners, (v) => v === principal.userId)
      || !allIn(input.titles, (v) => v === record.title) || !allIn(input.contents, (v) => v === record.content)) {
    logDenied('claim_differs');
    return { code: 409, json: { error: 'CLAIM_MISMATCH' } };
  }

  const { data: live, error: liveError } = liveRead;
  if (liveError) throw liveError;
  if (live && live.owner_id !== principal.userId) {
    logDenied('live_owner_differs');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  const version = `sha256:${hash.slice(0, 12)}`;
  if (live && noteHash(live.title, live.content) === hash) {
    return { code: 200, json: { id, ownerId: principal.userId, contentSha256: hash, restored: 'unchanged', version, willChange: [], verified: true } };
  }
  const action = live ? 'update' : 'create';
  const willChange = live ? ['title', 'content'].filter((field) => live[field] !== record[field]) : ['title', 'content'];
  // 실행 전 확인: 확인값(confirm)이 없거나 dryRun이면 버전과 바뀔 항목만 보여 주고 멈춘다. 확인값이 이 버전과 다르면 쓰지 않는다.
  if (input.dryRun || input.confirm === undefined) {
    console.info('notes restore preview');
    return { code: 200, json: { id, ownerId: principal.userId, contentSha256: hash, preview: true, confirmRequired: !input.dryRun, version, action, willChange } };
  }
  if (input.confirm !== version && input.confirm !== hash) {
    logDenied('confirm_differs');
    return { code: 409, json: { error: 'CONFIRM_MISMATCH' } };
  }

  // ③ 되살린다(제목·내용만). 쓰기 전 상태를 기억해 둡니다. 복원 뒤 검증에 실패하면 이 상태로 되돌립니다.
  const previous = live ? { title: live.title, content: live.content } : null;
  if (live) {
    const { data, error } = await db.from('notes').update({ title: record.title, content: record.content })
      .eq('id', id).eq('owner_id', principal.userId).select('id, owner_id');
    if (error) throw error;
    if (!data?.length) { logDenied('owner_changed'); return { code: 404, json: { error: 'NOT_FOUND' } }; }
  } else {
    const { error } = await db.from('notes').insert({
      id, title: record.title, content: record.content, owner_id: principal.userId,
    });
    if (error?.code === '23505') return { code: 409, json: { error: 'ID_EXISTS' } };
    if (error) throw error;
  }

  // ④ 쓴 뒤 사본과 되살린 행을 다시 읽어 대조하고, 어긋나면 되돌리고 멈춘다.
  if (!await verifiedAfterWrite(db, principal, id, hash)) {
    await rollback(db, principal, id, previous);
    console.error('notes restore unverified');
    return { code: 502, json: { error: 'RESTORE_UNVERIFIED' } };
  }
  const restored = live ? 'updated' : 'created';
  console.info(`notes restored: ${restored}`);
  return { code: live ? 200 : 201, json: { id, ownerId: principal.userId, contentSha256: hash, restored, version, willChange, verified: true } };
}

// 쓴 뒤에는 사본과 되살린 행을 둘 다 새로 읽어 ID·소유자·내용 해시를 확인합니다. 읽기 오류도 검증 실패로 봅니다.
async function verifiedAfterWrite(db, principal, id, hash) {
  try {
    const [fresh, { data: after, error }] = await Promise.all([
      readBackup(db, principal, id),
      db.from('notes').select('id, title, content, owner_id').eq('id', id).maybeSingle(),
    ]);
    if (fresh.error || error || !after) return false;
    return fresh.record.sha256 === hash && after.id === id && after.owner_id === principal.userId
      && noteHash(after.title, after.content) === hash;
  } catch { return false; }
}

// 검증에 실패한 복원은 쓴 내용을 없던 일로 합니다: 새로 만든 행은 지우고, 고친 행은 이전 제목·내용으로 돌립니다.
async function rollback(db, principal, id, previous) {
  try {
    const { error } = previous
      ? await db.from('notes').update(previous).eq('id', id).eq('owner_id', principal.userId)
      : await db.from('notes').delete().eq('id', id).eq('owner_id', principal.userId);
    if (error) throw error;
  } catch { console.error('notes restore rollback failed'); }
}

// 핸들러(src/notes-handler.mjs)가 로그인을 확인한 뒤 부르는 복구 진입점입니다. 본문이 없으면 미리보기만 돌려줍니다.
async function restore({ db, principal, id, body }) {
  const input = readRestoreInput({ body });
  if (!input) return { code: 400, json: { error: 'INVALID_RESTORE' } };
  return restoreNote({ db, principal, id, input });
}

// 시험에서는 가짜 DB·가짜 로그인 검사기를 getDeps로 넣어 만들고, 배포에서는 아래 기본 export가 환경변수로 동작합니다.
export function createRestoreRoute(options = {}) {
  const handler = createNotesHandler(options);
  return function route(request, response) {
    return handler({
      method: request.method,
      query: { id: request.query?.id },
      headers: request.headers,
      body: request.body,
      restore, // 이 함수가 있어야만 핸들러의 복구 분기가 열립니다(쿼리 값으로는 열리지 않음).
    }, response);
  };
}

export default createRestoreRoute();
