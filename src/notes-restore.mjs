// 비공개 가상 메모 사본(notes_backup)에서 지정한 메모 한 건만 notes로 되살립니다. POST /api/notes/:id/restore
// 사본은 서버 전용 키로만 읽습니다. 사용자·소유자는 서버가 확인한 로그인 결과만 쓰고 본문·헤더·쿼리의 값은 읽지 않습니다.
// 복원 전: 사본의 id·owner_id가 요청한 id·확인된 사용자와 같은지, 사본 내용의 해시가 사본에 적힌 해시와 요청이 말한 해시와 같은지 대조합니다.
// 복원 후: 되살린 행을 다시 읽어 id·owner_id·내용 해시가 사본과 같은지 확인합니다.
// 다른 메모와 사본 표는 고치지 않습니다. 감사 기록은 따로 만들지 않고 서버 로그에 짧은 코드만 남깁니다(ID·본문·토큰 없음).
import { createHash } from 'node:crypto';

const HEX64 = /^[0-9a-f]{64}$/u;

// 내용 해시: sha256(제목 UTF-8 바이트 + 0x00 + 본문 UTF-8 바이트). 글자에 NUL이 들어갈 수 없어 제목과 본문 경계가 모호하지 않습니다.
export function noteHash(title, content) {
  return createHash('sha256').update(title, 'utf8').update(Buffer.from([0])).update(content, 'utf8').digest('hex');
}

export function readRestoreInput(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const hash = typeof body.contentSha256 === 'string' ? body.contentSha256.toLowerCase() : '';
  return HEX64.test(hash) ? { contentSha256: hash } : null;
}

const logDenied = (reason) => console.warn(`notes restore denied: ${reason}`);

// 반환: { code, json }. 오류는 던지지 않고 호출한 쪽(handler)의 try/catch에 맡깁니다.
export async function restoreNote({ db, principal, id, input }) {
  const { data: backup, error: backupError } = await db.from('notes_backup')
    .select('id, owner_id, title, content, content_sha256').eq('id', id).maybeSingle();
  if (backupError) throw backupError;
  if (!backup || backup.id !== id || backup.owner_id !== principal.userId) {
    logDenied(!backup ? 'no_backup' : 'not_owner');
    return { code: 404, json: { error: 'NOT_FOUND' } };
  }
  const hash = noteHash(backup.title, backup.content);
  if (hash !== backup.content_sha256) {
    logDenied('backup_corrupt');
    return { code: 409, json: { error: 'BACKUP_HASH_MISMATCH' } };
  }
  if (hash !== input.contentSha256) {
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
  if (live && noteHash(live.title, live.content) === hash) {
    return { code: 200, json: { id, restored: 'unchanged', verified: true } };
  }

  let mode;
  if (live) {
    const { data, error } = await db.from('notes').update({ title: backup.title, content: backup.content })
      .eq('id', id).eq('owner_id', principal.userId).select('id, owner_id');
    if (error) throw error;
    if (!data?.length) { logDenied('owner_changed'); return { code: 404, json: { error: 'NOT_FOUND' } }; }
    mode = 'updated';
  } else {
    const { error } = await db.from('notes').insert({
      id, title: backup.title, content: backup.content, owner_id: principal.userId,
    });
    if (error?.code === '23505') return { code: 409, json: { error: 'ID_EXISTS' } };
    if (error) throw error;
    mode = 'created';
  }

  const { data: after, error: afterError } = await db.from('notes')
    .select('id, title, content, owner_id').eq('id', id).maybeSingle();
  if (afterError) throw afterError;
  if (!after || after.id !== backup.id || after.owner_id !== backup.owner_id || noteHash(after.title, after.content) !== hash) {
    console.error('notes restore unverified');
    return { code: 502, json: { error: 'RESTORE_UNVERIFIED' } };
  }
  console.info(`notes restored: ${mode}`);
  return { code: mode === 'created' ? 201 : 200, json: { id, restored: mode, verified: true } };
}
