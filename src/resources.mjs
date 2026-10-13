// 8단계: 자료마다 서버가 구별하는 자원 ID입니다.
// 자원 ID는 서버가 확인한 경로에서만 만들고, 브라우저가 보낸 본문·헤더·쿼리의 값은 읽지 않습니다.
// 형식: "<종류>:<항목 ID>" 또는 목록·새 항목 요청이면 "<종류>:collection".
// 메모(note)와 강사 공지(announcement)는 종류 이름이 달라 ID가 겹치지 않습니다.
// 강사 공지는 아직 이 저장소에 자료·주소가 없어서 이름만 정해 두었고, 공지를 읽는 경로는 만들지 않았습니다.
export const RESOURCE_TYPES = Object.freeze({ note: 'note', announcement: 'announcement' });

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function resourceId(type, itemId) {
  if (!Object.values(RESOURCE_TYPES).includes(type)) return null;
  if (itemId === undefined) return `${type}:collection`;
  if (typeof itemId !== 'string' || !ITEM_ID.test(itemId)) return null;
  return `${type}:${itemId.toLowerCase()}`;
}

// /api/notes 와 /api/notes/:id 는 모두 메모 자료입니다.
export function noteResourceId(itemId) {
  return resourceId(RESOURCE_TYPES.note, itemId);
}
