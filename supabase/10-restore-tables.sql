-- 10단계 학습용 SQL입니다. Supabase SQL Editor에서 학생이 직접 실행합니다(이 저장소의 코드는 실행하지 않음).
-- 새 표 이름 notes_backup_copy_v10, notes_restore_audit_v10은 기존 표와 겹치지 않습니다. 이 파일에는 메모 내용·키·사용자 값이 없습니다.

-- 1) 비공개 가상 메모 사본. 서버 전용 키로만 읽습니다.
create table if not exists public.notes_backup_copy_v10 (
  id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  backed_up_at timestamptz not null default now()
);

-- 2) 복원 감사 기록. 추가만 가능하게 둡니다.
create table if not exists public.notes_restore_audit_v10 (
  id uuid primary key,
  note_id uuid not null,
  owner_id uuid not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  action text not null check (action = 'restore'),
  created_at timestamptz not null default now()
);

alter table public.notes_backup_copy_v10 enable row level security;
alter table public.notes_restore_audit_v10 enable row level security;

-- 로그인한 사용자·익명 사용자는 두 표에 직접 접근하지 못합니다(정책을 만들지 않음).
revoke all on public.notes_backup_copy_v10 from public, anon, authenticated, service_role;
revoke all on public.notes_restore_audit_v10 from public, anon, authenticated, service_role;
-- 서버 함수(서버 전용 키 = service_role)에는 필요한 권한만 줍니다: 사본은 읽기, 감사 기록은 추가.
grant select on public.notes_backup_copy_v10 to service_role;
grant insert on public.notes_restore_audit_v10 to service_role;

-- 감사 기록의 수정·삭제를 막는 장치(표 소유자가 장치를 끄면 우회할 수 있음).
create or replace function public.notes_restore_audit_v10_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'notes_restore_audit_v10 is append-only';
end;
$$;
drop trigger if exists notes_restore_audit_v10_no_change on public.notes_restore_audit_v10;
create trigger notes_restore_audit_v10_no_change
  before update or delete on public.notes_restore_audit_v10
  for each row execute function public.notes_restore_audit_v10_append_only();

-- 3) 사본 만들기(침해 전에, 시험 계정 B의 가상 메모 한 건만). 아래 문장은 주석입니다.
--    <NOTE_UUID>와 <B_USER_UUID>를 학생이 직접 바꿔 실행하고, 실제 값은 파일·Git에 남기지 마세요.
-- insert into public.notes_backup_copy_v10 (id, owner_id, title, content, content_sha256)
-- select id, owner_id, title, content, encode(sha256(convert_to(content, 'UTF8')), 'hex')
-- from public.notes
-- where id = '<NOTE_UUID>' and owner_id = '<B_USER_UUID>';
