// 10단계: 비공개 가상 메모 사본(notes_backup_copy_v10)에서 지정한 한 건만 notes로 복원합니다.
// 소유자는 서버가 확인한 userId만 쓰고(요청 본문의 소유자 칸은 읽지 않음), 요청의 id로 사본을 찾습니다.
// contentSha256은 요청에 있을 때만 사본과 대조하며, 사본 자체의 저장된 해시는 요청과 상관없이 항상 다시 계산해 확인합니다.
// 다른 메모 행은 읽거나 쓰지 않고, 감사 표(notes_restore_audit_v10)에는 추가만 합니다(수정·삭제 없음).
// 한계: 복원과 감사 기록은 하나의 DB 트랜잭션이 아닙니다. 감사 기록이 실패하면 502가 되지만 메모는 이미 복원된 상태입니다.
// 초안은 Gemini가 썼고, 복원 뒤 제목 대조를 더해 고쳤습니다.
import { createHash } from 'node:crypto';

// 응답 규약(복원 한 건): 200 {id, restored, contentSha256} 복원됨(이미 같아도 200) · 404 사본 없음/남의 사본/남이 가진 같은 ID(구분 없음)
// · 409 BACKUP_CORRUPT 사본 손상 · 409 HASH_MISMATCH 요청의 해시가 사본과 다름 · 409 ID_EXISTS 동시 추가 충돌 · 던지면 호출한 쪽이 502.
export function contentSha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function restoreOneNote({ db, userId, input, newAuditId }) {
  const { id, contentSha256: inputSha } = input;

  const { data: backup, error: backupErr } = await db
    .from('notes_backup_copy_v10')
    .select('id, owner_id, title, content, content_sha256')
    .eq('id', id)
    .maybeSingle();

  if (backupErr) throw backupErr;
  if (!backup || backup.owner_id !== userId) {
    return { status: 404, json: { error: 'NOT_FOUND' } };
  }

  if (contentSha256(backup.content) !== backup.content_sha256) {
    return { status: 409, json: { error: 'BACKUP_CORRUPT' } };
  }

  if (inputSha !== undefined && backup.content_sha256 !== inputSha) {
    return { status: 409, json: { error: 'HASH_MISMATCH' } };
  }

  const { data: live, error: liveErr } = await db
    .from('notes')
    .select('id, title, content, owner_id')
    .eq('id', id)
    .maybeSingle();

  if (liveErr) throw liveErr;

  if (live) {
    if (live.owner_id !== userId) {
      return { status: 404, json: { error: 'NOT_FOUND' } };
    }
    const { data: updated, error: updateErr } = await db
      .from('notes')
      .update({ title: backup.title, content: backup.content })
      .eq('id', id)
      .eq('owner_id', userId)
      .select('id, title, content, owner_id');

    if (updateErr) throw updateErr;
    if (!updated || updated.length === 0) {
      return { status: 404, json: { error: 'NOT_FOUND' } };
    }
  } else {
    const { error: insertErr } = await db
      .from('notes')
      .insert({
        id,
        title: backup.title,
        content: backup.content,
        owner_id: userId
      });

    if (insertErr) {
      if (insertErr.code === '23505') {
        return { status: 409, json: { error: 'ID_EXISTS' } };
      }
      throw insertErr;
    }
  }

  const { data: verified, error: verifyErr } = await db
    .from('notes')
    .select('id, title, content, owner_id')
    .eq('id', id)
    .maybeSingle();

  if (verifyErr) throw verifyErr;

  if (
    !verified ||
    verified.id !== id ||
    verified.owner_id !== userId ||
    verified.title !== backup.title ||
    contentSha256(verified.content) !== backup.content_sha256
  ) {
    throw new Error('verify_failed');
  }

  const { error: auditErr } = await db
    .from('notes_restore_audit_v10')
    .insert({
      id: newAuditId(),
      note_id: id,
      owner_id: userId,
      content_sha256: backup.content_sha256,
      action: 'restore'
    });

  if (auditErr) throw auditErr;

  return {
    status: 200,
    json: { id, restored: true, contentSha256: backup.content_sha256 }
  };
}
