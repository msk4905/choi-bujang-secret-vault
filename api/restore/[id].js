// 메모 한 건 복구 경로: POST /api/restore/:id (Vercel이 파일 이름의 [id]를 request.query.id로 채워 줍니다).
// 이 파일 하나에 복구의 검증·복원 흐름이 모두 있습니다. 순서는 아래와 같습니다.
//   ① 검증한 사본을 다시 읽는다: 전용 표 vault_notes_backup에서 그 메모의 사본(메모 ID·소유자)을 읽고 내용 해시를 다시 계산해 대조한다. 이것이 가장 먼저이고, 실패하면 다른 것은 읽지도 쓰지도 않는다.
//      사본이 없거나(404) 어긋나면(409) 아무것도 쓰지 않고 멈춘다.
//   ② 현재 메모를 읽고(남의 메모면 404), 제목·내용만 사본 값으로 되살린다(없으면 같은 ID·주인으로 다시 만든다). 다른 메모는 고치지 않는다.
//      요청 본문은 읽지 않는다(예외: {"dryRun": true}이면 복원할 버전과 바뀔 항목만 보여 주고 쓰지 않는다 = 실행 전 확인).
//   ③ 쓴 뒤 사본과 되살린 행을 새로 읽어 ID·소유자·내용 해시를 다시 대조한다. 어긋나면 쓴 내용을 되돌리고 멈춘다(502).
// 사용자·소유자는 서버가 확인한 로그인 결과만 씁니다. 운영 정책에는 접근하지 않고, 감사 기록은 지우거나 고치지 않습니다
// (복구 결과는 서버 로그에 짧은 코드로만 남기며 ID·본문·토큰은 싣지 않습니다).
// 로그인 확인·환경 설정·심판 요청 추적은 src/notes-handler.mjs가 맡고, 이 파일의 restore 함수를 부릅니다.
import { createNotesHandler } from '../../src/notes-handler.mjs';
import { BACKUP_TABLE, noteHash, writeAudit } from '../../src/notes-backup.mjs';

const HEX64 = /^[0-9a-f]{64}$/u;

// 요청 본문은 읽지 않습니다. 복구 대상은 경로의 ID 하나와 로그인 결과(소유자)로만 정해지고, 본문에 무엇이 담겨 있든(ID·소유자·해시·제목·내용 등) 값을 믿거나 대조하지 않으며
// 형식이 이상해도 거절하지 않습니다. 예외는 미리보기뿐입니다: 본문이 {"dryRun": true}이면 복원할 버전과 바뀔 항목만 보여 주고 쓰지 않습니다.
// 메모 ID·소유자·내용 해시의 대조는 요청이 아니라 서버가 사본 표에서 직접 합니다(readBackup).
export function readRestoreInput(request) {
  let body = request.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const dryRun = body !== null && typeof body === 'object' && !Array.isArray(body) && body.dryRun === true;
  return { dryRun };
}

const logDenied = (reason) => console.warn(`notes restore denied: ${reason}`);

// 사본을 새로 읽고 검증합니다: 전용 표에서 그 메모의 사본을 읽고, 메모 ID·소유자가 요청과 같은지, 저장된 해시가 제목·내용으로 다시 계산한 해시와 같은지 모두 맞아야 합니다.
async function readBackup(db, principal, noteId) {
  const { data: row, error } = await db.from(BACKUP_TABLE)
    .select('note_id, owner_id, title, content, content_hash, source, created_at')
    .eq('note_id', noteId).order('id', { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (!row) return { error: 'no_backup' };
  if (row.owner_id !== principal.userId) return { error: 'not_owner' }; // 남의 메모 사본은 있는지도 알려 주지 않는다
  const valid = typeof row.title === 'string' && typeof row.content === 'string'
    && typeof row.content_hash === 'string' && HEX64.test(row.content_hash)
    && String(row.note_id).toLowerCase() === noteId
    && noteHash(row.title, row.content) === row.content_hash;
  return valid ? { record: { title: row.title, content: row.content, sha256: row.content_hash, source: row.source, at: row.created_at } } : { error: 'backup_corrupt' };
}

// 성공 응답에 싣는 확인값: 되살린 제목·본문(요청자 본인 메모), 소유자 일치(ownerMatched), 실제로 썼는지(wrote). 모두 검증된 사본에서 온 값입니다.
const proof = (record, wrote) => ({ title: record.title, body: record.content, ownerMatched: true, wrote });

// 메모 한 건만 사본 값으로 씁니다(제목·내용만). 있으면 고치고, 지워졌으면 같은 ID·주인으로 다시 만듭니다. 막히면 { code, json }, 썼으면 null을 돌려줍니다.
async function writeRestored(db, principal, id, record, live) {
  if (live) {
    const { data, error } = await db.from('notes').update({ title: record.title, content: record.content })
      .eq('id', id).eq('owner_id', principal.userId).select('id, owner_id');
    if (error) throw error;
    if (!data?.length) { logDenied('owner_changed'); return { code: 404, json: { error: 'NOT_FOUND' } }; }
    return null;
  }
  const { error } = await db.from('notes').insert({ id, title: record.title, content: record.content, owner_id: principal.userId });
  if (error?.code === '23505') return { code: 409, json: { error: 'ID_EXISTS' } };
  if (error) throw error;
  return null;
}

// 반환: { code, json }. 오류는 던지지 않고 호출한 쪽(handler)의 try/catch에 맡깁니다.
// 순서는 위 ①~④와 같고, 앞 단계가 멈추면 뒤 단계는 하지 않습니다(읽기도 하지 않음).
export async function restoreNote({ db, principal, id, input }) {
  const audit = (action, detail) => writeAudit(db, { action, resource: `note:${id}`, actor: principal.userId, detail });

  // ① 검증한 사본을 읽는다. 다른 것은 아직 읽지도 쓰지도 않는다.
  const found = await readBackup(db, principal, id);
  if (found.error === 'no_backup') {
    logDenied('no_backup');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  if (found.error === 'not_owner') {
    logDenied('not_owner');
    await audit('restore_denied', { reason: 'not_owner' });
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  if (found.error) { // 사본의 내용이 해시와 다르다: 아무것도 쓰지 않고 멈춘다.
    logDenied('backup_corrupt');
    await audit('restore_stopped', { reason: 'backup_hash_mismatch' });
    return { code: 409, json: { error: 'BACKUP_HASH_MISMATCH' } };
  }
  const { record } = found;
  const hash = record.sha256;
  const version = `sha256:${hash.slice(0, 12)}`;

  // ② 현재 메모를 읽는다. 남의 메모면 멈춘다.
  const { data: live, error: liveError } = await db.from('notes').select('id, title, content, owner_id').eq('id', id).maybeSingle();
  if (liveError) throw liveError;
  if (live && live.owner_id !== principal.userId) {
    logDenied('live_owner_differs');
    await audit('restore_denied', { reason: 'owner_conflict' });
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  // 현재 메모가 사본과 같은지는 값을 직접 비교합니다(변조로 제목·내용이 비어 있거나 문자열이 아니어도 오류 없이 "다름"으로 보고 되살립니다).
  if (live && live.title === record.title && live.content === record.content) {
    await audit('restore_note', { contentHash: hash, wrote: false });
    return { code: 200, json: { id, ownerId: principal.userId, contentSha256: hash, ...proof(record, false), restored: 'unchanged', version, willChange: [], verified: true } };
  }
  const action = live ? 'update' : 'create';
  const willChange = live ? ['title', 'content'].filter((field) => live[field] !== record[field]) : ['title', 'content'];
  if (input.dryRun) { // 실행 전 확인: 복원할 버전과 바뀔 항목만 보여 주고 쓰지 않는다.
    console.info('notes restore preview');
    return { code: 200, json: { id, ownerId: principal.userId, contentSha256: hash, preview: true, version, action, willChange } };
  }

  // 사본 검증을 통과한 뒤에만 쓴다. 쓰기 전 상태를 기억해 두고, 쓴 뒤 검증에 실패하면 이 상태로 되돌린다.
  const previous = live ? { title: live.title, content: live.content } : null;
  const blocked = await writeRestored(db, principal, id, record, live);
  if (blocked) return blocked;

  // ③ 쓴 뒤 사본과 되살린 행을 다시 읽어 ID·소유자·내용 해시를 대조하고, 어긋나면 되돌리고 멈춘다.
  if (!await verifiedAfterWrite(db, principal, id, hash)) {
    await rollback(db, principal, id, previous);
    await audit('restore_stopped', { reason: 'post_restore_mismatch' });
    console.error('notes restore unverified');
    return { code: 502, json: { error: 'RESTORE_UNVERIFIED' } };
  }
  const restored = live ? 'updated' : 'created';
  await audit('restore_note', { contentHash: hash, wrote: true, source: record.source });
  console.info(`notes restored: ${restored}`);
  return { code: live ? 200 : 201, json: { id, ownerId: principal.userId, contentSha256: hash, ...proof(record, true), restored, backupAt: record.at ?? null, version, willChange, verified: true } };
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

// 핸들러(src/notes-handler.mjs)가 로그인을 확인한 뒤 부르는 복구 진입점입니다. 본문은 없어도 되고, 있어도 dryRun 외에는 읽지 않습니다.
async function restore({ db, principal, id, body }) {
  const input = readRestoreInput({ body });
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
