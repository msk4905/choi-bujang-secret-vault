// 검증용 사본(백업) 남기기: 메모를 만들 때, 그리고 사본이 없던 메모는 처음 수정·삭제하기 직전에 서버가 사본을 한 번 남깁니다.
// 사본은 메모 표(notes)와 따로 있는 전용 표 vault_notes_backup에 저장합니다: 제목·내용·소유자·내용 해시·생긴 시각.
// 메모 표의 목록·조회·수정·삭제 경로는 이 표를 다루지 않고, 서버 전용 키로만 읽고 덧붙입니다(supabase/step10-backup.sql이 수정·삭제 권한을 막음).
// 메모 하나에 사본은 하나이고(note_id 유일) 이미 있으면 덮어쓰지 않습니다(침해 전에 검증한 사본).
// 사본을 다시 읽어 검증하고 되살리는 일은 api/restore/[id].js가 합니다.
import { createHash } from 'node:crypto';

export const BACKUP_TABLE = 'vault_notes_backup';
export const AUDIT_TABLE = 'vault_audit';

// 내용 해시: sha256(제목 UTF-8 바이트 + 0x00 + 본문 UTF-8 바이트). 글자에 NUL이 들어갈 수 없어 제목과 본문 경계가 모호하지 않습니다.
export function noteHash(title, content) {
  return createHash('sha256').update(title, 'utf8').update(Buffer.from([0])).update(content, 'utf8').digest('hex');
}

export function backupRecord({ noteId, userId, title, content, source }) {
  return { note_id: noteId, owner_id: userId, title, content, content_hash: noteHash(title, content), source };
}

// 사본을 못 남겨도 메모 만들기·수정·삭제는 실패시키지 않고 서버 로그에만 남깁니다(그 메모는 복원할 수 없음).
// source: 'create'(만들 때) 또는 'before_change'(사본 없던 메모의 처음 수정·삭제 직전).
export async function saveBackup({ db, principal, noteId, title, content, source = 'create' }) {
  try {
    const { error } = await db.from(BACKUP_TABLE).insert(backupRecord({ noteId, userId: principal.userId, title, content, source }));
    if (error && error.code !== '23505') throw error; // 23505: 이미 사본이 있으면 그대로 둠
  } catch {
    console.error('notes backup not saved');
  }
}
