// 검증용 사본(백업) 만들기: 메모를 만들 때, 그리고 사본이 없던 메모는 처음 수정·삭제하기 직전에 서버가 사본을 한 번 남깁니다.
// 사본은 notes 표 안의 예약 행입니다: 행 ID와 owner_id를 (메모 ID, 확인된 사용자 ID)에서 계산한 값으로 두어, 목록·조회·수정·삭제 경로가
// 다루는 owner_id(진짜 사용자)와 절대 같지 않습니다. 그래서 API로는 보이지도 고쳐지지도 않고, 서버 전용 키로만 읽습니다.
// 사본이 이미 있으면 덮어쓰지 않습니다(침해 전에 검증한 사본). 사본을 다시 읽어 검증하고 되살리는 일은 api/restore/[id].js가 합니다.
import { createHash } from 'node:crypto';

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

