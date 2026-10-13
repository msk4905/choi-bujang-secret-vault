// 비공개 가상 메모 사본(notes_backup)에서 지정한 메모 한 건만 notes로 되살립니다. POST /api/notes/:id/restore
// 사본은 서버 전용 키로만 읽습니다. 사용자·소유자는 서버가 확인한 로그인 결과만 쓰고 본문·헤더·쿼리의 값은 읽지 않습니다.
// 요청은 두 단계입니다. ① 확인 코드 없이 보내면 복원할 버전과 바뀔 항목만 보여 주고 아무것도 쓰지 않습니다(응답의 confirm 코드).
// ② {contentSha256, confirm}을 보내면 사본·현재 메모를 다시 읽어 코드가 같을 때만 씁니다.
// 복원 전: 사본의 id·owner_id가 요청한 id·확인된 사용자와 같은지, 사본 내용의 해시가 사본에 적힌 해시와 요청이 말한 해시와 같은지 대조합니다.
// 복원 후: 사본과 되살린 행을 새로 읽어 id·owner_id·내용 해시가 같은지 확인하고, 다르면 쓴 내용을 되돌립니다.
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
  if (body.confirm !== undefined) {
    if (typeof body.confirm !== 'string' || !/^[0-9a-f]{12}$/u.test(body.confirm)) return null;
    if (input.contentSha256 === undefined) return null;
    input.confirm = body.confirm;
  }
  return input;
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

  // 실행 전 단계: 복원할 버전과 바뀔 항목을 보여 주고 아무것도 쓰지 않습니다. 확인 코드는 방금 새로 읽은 사본·현재 메모·사용자에서 계산하므로,
  // 확인 코드를 붙여 다시 보냈을 때 그 사이 사본이나 메모가 바뀌었으면 코드가 달라져 멈춥니다.
  const action = live ? 'update' : 'create';
  const willChange = live
    ? ['title', 'content'].filter((field) => live[field] !== backup[field])
    : ['title', 'content'];
  const code = createHash('sha256')
    .update(JSON.stringify([id, principal.userId, hash, live ? noteHash(live.title, live.content) : null]))
    .digest('hex').slice(0, 12);
  if (input.confirm === undefined) {
    console.info('notes restore preview');
    return { code: 200, json: { id, preview: true, version, action, willChange, confirm: code } };
  }
  if (input.confirm !== code) {
    logDenied('confirm_mismatch');
    return { code: 409, json: { error: 'CONFIRM_MISMATCH' } };
  }

  // 쓰기 전 상태를 기억해 둡니다. 복원 뒤 검증에 실패하면 이 상태로 되돌립니다.
  const previous = live ? { title: live.title, content: live.content } : null;
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

  if (!await verifiedAfterWrite(db, principal, id, hash)) {
    await rollback(db, principal, id, previous);
    console.error('notes restore unverified');
    return { code: 502, json: { error: 'RESTORE_UNVERIFIED' } };
  }
  console.info(`notes restored: ${mode}`);
  return { code: mode === 'created' ? 201 : 200, json: { id, restored: mode, version, willChange, verified: true } };
}

// 쓴 뒤에는 사본과 되살린 행을 둘 다 새로 읽어 ID·소유자·내용 해시를 확인합니다. 읽기 오류도 검증 실패로 봅니다.
async function verifiedAfterWrite(db, principal, id, hash) {
  try {
    const { data: fresh, error: freshError } = await db.from('notes_backup')
      .select('id, owner_id, title, content, content_sha256').eq('id', id).maybeSingle();
    const { data: after, error: afterError } = await db.from('notes')
      .select('id, title, content, owner_id').eq('id', id).maybeSingle();
    if (freshError || afterError || !fresh || !after) return false;
    return fresh.id === id && fresh.owner_id === principal.userId
      && fresh.content_sha256 === hash && noteHash(fresh.title, fresh.content) === hash
      && after.id === fresh.id && after.owner_id === fresh.owner_id && noteHash(after.title, after.content) === hash;
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
