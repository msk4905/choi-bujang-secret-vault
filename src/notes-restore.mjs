// 메모를 만들 때 서버가 검증용 사본을 남기고, 메모 한 건만 그 사본으로 되살립니다. POST /api/notes/:id/restore
// 사본은 notes 표 안의 예약 행입니다: 행 ID와 owner_id를 (메모 ID, 확인된 사용자 ID)에서 계산한 값으로 두어, 목록·조회·수정·삭제 경로가
// 다루는 owner_id(진짜 사용자)와 절대 같지 않습니다. 그래서 API로는 보이지도 고쳐지지도 않고, 서버 전용 키로만 읽습니다.
// 사본은 메모를 만든 직후 한 번만 남기며 이후 수정으로 덮어쓰지 않습니다(침해 전에 검증한 사본). 이미 있으면 그대로 둡니다.
// 사용자·소유자는 서버가 확인한 로그인 결과만 쓰고 본문·헤더·쿼리의 값은 읽지 않습니다.
// 복원 요청은 본문 없이 한 번 보내도 됩니다. 사본을 다시 읽어 검증하고(사본의 id·소유자·내용 해시), 하나라도 어긋나면 쓰지 않고 멈춥니다.
// 실행 전 확인이 필요하면 본문에 {"dryRun": true}를 보냅니다: 복원할 버전과 바뀔 항목만 돌려주고 아무것도 쓰지 않습니다.
// 쓴 뒤에는 사본과 되살린 행을 새로 읽어 다시 대조하고, 어긋나면 쓴 내용을 되돌립니다. 다른 메모는 고치지 않습니다.
// 감사 기록은 따로 만들지 않고 서버 로그에 짧은 코드만 남깁니다(ID·본문·토큰 없음).
import { createHash } from 'node:crypto';

const HEX64 = /^[0-9a-f]{64}$/u;

// 내용 해시: sha256(제목 UTF-8 바이트 + 0x00 + 본문 UTF-8 바이트). 글자에 NUL이 들어갈 수 없어 제목과 본문 경계가 모호하지 않습니다.
export function noteHash(title, content) {
  return createHash('sha256').update(title, 'utf8').update(Buffer.from([0])).update(content, 'utf8').digest('hex');
}

// 예약 ID: 버전 칸을 5로 두어, v4 UUID만 받는 로그인 검사(심판·Supabase 사용자)의 사용자 ID와 같아질 수 없습니다.
function reservedUuid(label) {
  const h = createHash('sha256').update(label, 'utf8').digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const backupRowId = (noteId) => reservedUuid(`aleph-backup-row:${noteId}`);
export const backupOwnerId = (userId) => reservedUuid(`aleph-backup-owner:${userId}`);

export function backupRow({ noteId, userId, title, content }) {
  const record = { v: 1, id: noteId, owner: userId, title, content, sha256: noteHash(title, content) };
  return { id: backupRowId(noteId), title: 'backup', content: JSON.stringify(record), owner_id: backupOwnerId(userId) };
}

// 메모를 만든 직후 호출합니다. 사본을 못 남겨도 메모 만들기는 실패시키지 않고 서버 로그에만 남깁니다(그 메모는 복원할 수 없음).
export async function saveBackup({ db, principal, noteId, title, content }) {
  try {
    const { error } = await db.from('notes').insert(backupRow({ noteId, userId: principal.userId, title, content }));
    if (error && error.code !== '23505') throw error; // 23505: 이미 사본이 있으면 그대로 둠
  } catch {
    console.error('notes backup not saved');
  }
}

export function readRestoreInput(request) {
  let body = request.body;
  if (typeof body === 'string') {
    if (body.trim() === '') body = {};
    else { try { body = JSON.parse(body); } catch { return null; } }
  }
  if (body === undefined || body === null) body = {};
  if (typeof body !== 'object' || Array.isArray(body)) return null;
  const input = {};
  if (body.contentSha256 !== undefined) {
    const hash = typeof body.contentSha256 === 'string' ? body.contentSha256.toLowerCase() : '';
    if (!HEX64.test(hash)) return null;
    input.contentSha256 = hash;
  }
  if (body.dryRun !== undefined) {
    if (typeof body.dryRun !== 'boolean') return null;
    input.dryRun = body.dryRun;
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
  const found = await readBackup(db, principal, id);
  if (found.error === 'no_backup') {
    logDenied('no_backup');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  if (found.error) {
    logDenied('backup_corrupt');
    return { code: 409, json: { error: 'BACKUP_HASH_MISMATCH' } };
  }
  const { record } = found;
  const hash = record.sha256;
  if (input.contentSha256 !== undefined && hash !== input.contentSha256) {
    logDenied('request_hash_differs');
    return { code: 409, json: { error: 'HASH_MISMATCH' } };
  }

  const { data: live, error: liveError } = await db.from('notes')
    .select('id, title, content, owner_id').eq('id', id).maybeSingle();
  if (liveError) throw liveError;
  if (live && live.owner_id !== principal.userId) {
    logDenied('live_owner_differs');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  const version = `sha256:${hash.slice(0, 12)}`;
  if (live && noteHash(live.title, live.content) === hash) {
    return { code: 200, json: { id, restored: 'unchanged', version, willChange: [], verified: true } };
  }
  const action = live ? 'update' : 'create';
  const willChange = live ? ['title', 'content'].filter((field) => live[field] !== record[field]) : ['title', 'content'];
  if (input.dryRun) {
    console.info('notes restore preview');
    return { code: 200, json: { id, preview: true, version, action, willChange } };
  }

  // 쓰기 전 상태를 기억해 둡니다. 복원 뒤 검증에 실패하면 이 상태로 되돌립니다.
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

  if (!await verifiedAfterWrite(db, principal, id, hash)) {
    await rollback(db, principal, id, previous);
    console.error('notes restore unverified');
    return { code: 502, json: { error: 'RESTORE_UNVERIFIED' } };
  }
  const restored = live ? 'updated' : 'created';
  console.info(`notes restored: ${restored}`);
  return { code: live ? 200 : 201, json: { id, restored, version, willChange, verified: true } };
}

// 쓴 뒤에는 사본과 되살린 행을 둘 다 새로 읽어 ID·소유자·내용 해시를 확인합니다. 읽기 오류도 검증 실패로 봅니다.
async function verifiedAfterWrite(db, principal, id, hash) {
  try {
    const fresh = await readBackup(db, principal, id);
    const { data: after, error } = await db.from('notes')
      .select('id, title, content, owner_id').eq('id', id).maybeSingle();
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
