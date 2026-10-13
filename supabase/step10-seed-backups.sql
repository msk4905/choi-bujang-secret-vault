-- 10단계: 이미 있는 메모의 검증용 사본을 한 번에 남깁니다(Supabase SQL Editor에서 [가] → [나] → [다] 순서로 실행).
-- 사본 행은 서버 코드(src/notes-backup.mjs)와 같은 규칙으로 계산한 예약 행입니다: 행 ID·소유자 ID는 sha256 기반 UUID(버전 칸 5)라
-- 진짜 사용자 ID와 같아질 수 없고, 내용 해시는 sha256(제목 + 0x00 + 내용)입니다. 이미 사본이 있는 메모는 그대로 둡니다(덮어쓰지 않음).
-- 비밀값·메모 본문은 이 파일에 없습니다. 메모 표의 기존 메모는 지우거나 고치지 않고 행만 덧붙입니다.

-- [가] 미리보기: 사본이 없는 기존 메모 수 (쓰지 않음)
select count(*) as notes_without_backup
from notes n
where n.owner_id is not null and n.title is not null and n.content is not null
  and substr(n.owner_id::text, 15, 1) <> '5'
  and not exists (
    select 1 from notes b where b.id::text = (
      select substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12)
      from (select encode(sha256(convert_to('aleph-backup-row:'||n.id::text,'UTF8')),'hex') as h) x));

-- [나] 사본 만들기(덧붙이기만 함)
insert into notes (id, title, content, owner_id)
select
  (select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
   from (select encode(sha256(convert_to('aleph-backup-row:'||n.id::text,'UTF8')),'hex') as h) x),
  'backup',
  jsonb_build_object(
    'v', 1, 'id', n.id::text, 'owner', n.owner_id::text, 'title', n.title, 'content', n.content,
    'sha256', encode(sha256(convert_to(n.title,'UTF8') || '\x00'::bytea || convert_to(n.content,'UTF8')),'hex')
  )::text,
  (select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
   from (select encode(sha256(convert_to('aleph-backup-owner:'||n.owner_id::text,'UTF8')),'hex') as h) y)
from notes n
where n.owner_id is not null and n.title is not null and n.content is not null
  and substr(n.owner_id::text, 15, 1) <> '5'
on conflict (id) do nothing;

-- [다] 확인: 위 미리보기를 다시 실행하면 notes_without_backup이 0이어야 합니다.
select count(*) as backups_total from notes where title = 'backup' and substr(owner_id::text, 15, 1) = '5';
