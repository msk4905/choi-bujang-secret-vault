// 검증용 사본(백업) 남기기: 메모를 만들 때, 그리고 사본이 없던 메모는 처음 수정·삭제하기 직전에 서버가 사본을 한 번 남깁니다.
// 사본은 메모 표(notes)와 따로 있는 전용 표 vault_notes_backup에 저장합니다: 제목·내용·소유자·내용 해시·생긴 시각.
// 메모 표의 목록·조회·수정·삭제 경로는 이 표를 다루지 않고, 서버 전용 키로만 읽고 덧붙입니다(supabase/step10-backup.sql이 수정·삭제 권한을 막음).
// 메모 하나에 사본은 하나이고(note_id 유일) 이미 있으면 덮어쓰지 않습니다(침해 전에 검증한 사본).
// 사본을 다시 읽어 검증하고 되살리는 일은 api/restore/[id].js가 합니다.
import { createHash } from 'node:crypto';

export const BACKUP_TABLE = 'vault_notes_backup';
export const AUDIT_TABLE = 'vault_audit';

// 내용 해시: sha256(제목 + 줄바꿈 + 본문)을 UTF-8로 계산한 16진수입니다. SQL(supabase/step10-backup.sql)에서도 같은 식으로 계산합니다.
export function noteHash(title, content) {
  return createHash('sha256').update(`${title}\n${content}`, 'utf8').digest('hex');
}

export function backupRecord({ noteId, userId, title, content, source }) {
  return { note_id: noteId, owner_id: userId, title, content, content_hash: noteHash(title, content), source };
}

// 사본을 못 남겨도 메모 만들기·수정·삭제는 실패시키지 않고 서버 로그에만 남깁니다(그 메모는 복원할 수 없음).
// source: 'create'(만들 때) 또는 'before_change'(사본 없던 메모의 처음 수정·삭제 직전).
export async function saveBackup({ db, principal, noteId, title, content, source = 'create' }) {
  try {
    const record = backupRecord({ noteId, userId: principal.userId, title, content, source });
    const { error } = await db.from(BACKUP_TABLE).insert(record);
    if (error?.code === '23505') return; // 이미 사본이 있으면 그대로 둠(덮어쓰지 않음)
    if (error) throw error;
    // 방금 남긴 사본을 바로 다시 읽어 검증합니다: 같은 메모·소유자·내용 해시로 저장됐는지 확인하고, 다르면 서버 로그에만 남깁니다.
    const { data: saved, error: readError } = await db.from(BACKUP_TABLE).select('note_id, owner_id, content_hash')
      .eq('note_id', noteId).maybeSingle();
    if (readError) throw readError;
    if (!saved || saved.owner_id !== principal.userId || saved.content_hash !== record.content_hash) console.error('notes backup verify failed');
  } catch {
    console.error('notes backup not saved');
  }
}

// 감사 기록은 덧붙이기만 합니다(지우거나 고치지 않음). 남기지 못해도 복구 결과는 바꾸지 않고 서버 로그에만 남깁니다.
// 담는 값: 행동 이름, 자원 ID(note:<id>), 요청자 ID 앞 8자리, 짧은 사유. 메모 제목·본문·토큰은 싣지 않습니다.
export async function writeAudit(db, { action, resource, actor, detail = {} }) {
  try {
    const { error } = await db.from(AUDIT_TABLE).insert({ action, resource, actor: String(actor ?? '-').slice(0, 8), detail });
    if (error) throw error;
  } catch {
    console.error(`audit not saved (${action})`);
  }
}
