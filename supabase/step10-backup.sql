-- 10단계: 비공개 메모 사본 표와 감사 표를 만들고, 이미 있는 메모의 사본을 남깁니다.
-- Supabase SQL Editor에서 [가] → [나] → [다] → [라] → [마] 순서로 실행합니다(여러 번 실행해도 같은 결과).
-- 비밀값·메모 본문은 이 파일에 없습니다. 메모 표(notes)의 기존 메모는 지우거나 고치지 않습니다.

-- [가] 표 만들기와 권한 정리: 사본·감사 표는 덧붙이기(INSERT)와 읽기만 됩니다. anon·authenticated는 아무 권한도 없습니다.
create table if not exists public.vault_notes_backup (
  id bigint generated always as identity primary key,
  note_id uuid not null unique,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_hash text not null,
  source text not null check (source in ('create', 'before_change', 'seed', 'migrated')),
  created_at timestamptz not null default now()
);
create table if not exists public.vault_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  resource text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb
);
alter table public.vault_notes_backup enable row level security;
alter table public.vault_audit enable row level security;
revoke all on public.vault_notes_backup from anon, authenticated;
revoke all on public.vault_audit from anon, authenticated;
revoke all on public.vault_notes_backup from service_role;
revoke all on public.vault_audit from service_role;
grant select, insert on public.vault_notes_backup to service_role;
grant select, insert on public.vault_audit to service_role;
grant usage, select on sequence public.vault_notes_backup_id_seq to service_role;
grant usage, select on sequence public.vault_audit_id_seq to service_role;

-- [나] 예전 방식으로 notes 표 안에 남겨 둔 사본 행(제목 backup, 소유자 예약 ID)을 새 표로 옮깁니다(원래 행은 그대로 둠).
insert into public.vault_notes_backup (note_id, owner_id, title, content, content_hash, source)
select (n.content::jsonb ->> 'id')::uuid, (n.content::jsonb ->> 'owner')::uuid,
       n.content::jsonb ->> 'title', n.content::jsonb ->> 'content', n.content::jsonb ->> 'sha256', 'migrated'
from public.notes n
where n.title = 'backup' and substr(n.owner_id::text, 15, 1) = '5' and n.content like '{%'
on conflict (note_id) do nothing;

-- [다] 사본이 없는 기존 메모의 사본을 남깁니다. 해시는 서버 코드와 같은 sha256(제목 + 줄바꿈 + 내용)입니다.
insert into public.vault_notes_backup (note_id, owner_id, title, content, content_hash, source)
select n.id, n.owner_id, n.title, n.content,
       encode(sha256(convert_to(n.title || E'\n' || n.content, 'UTF8')), 'hex'), 'seed'
from public.notes n
where n.owner_id is not null and n.title is not null and n.content is not null
  and not (n.title = 'backup' and substr(n.owner_id::text, 15, 1) = '5')
on conflict (note_id) do nothing;

-- [라] 이미 있는 사본의 해시를 현재 계산식(제목 + 줄바꿈 + 내용)으로 다시 계산합니다.
-- 해시 계산식을 0x00 방식에서 줄바꿈 방식으로 바꾼 뒤 한 번 실행합니다(여러 번 실행해도 같은 결과). 제목·내용·소유자는 바꾸지 않습니다.
update public.vault_notes_backup
set content_hash = encode(sha256(convert_to(title || E'\n' || content, 'UTF8')), 'hex');

-- [마] 확인: notes_without_backup은 0이어야 하고, 권한 두 칸(update_or_delete_*)은 모두 false여야 합니다.
select
  (select count(*) from public.notes n
    where n.owner_id is not null and n.title is not null and n.content is not null
      and not (n.title = 'backup' and substr(n.owner_id::text, 15, 1) = '5')
      and not exists (select 1 from public.vault_notes_backup b where b.note_id = n.id)) as notes_without_backup,
  (select count(*) from public.vault_notes_backup) as backups_total,
  has_table_privilege('service_role', 'public.vault_notes_backup', 'UPDATE')
    or has_table_privilege('service_role', 'public.vault_notes_backup', 'DELETE') as update_or_delete_backup,
  has_table_privilege('service_role', 'public.vault_audit', 'UPDATE')
    or has_table_privilege('service_role', 'public.vault_audit', 'DELETE') as update_or_delete_audit;
