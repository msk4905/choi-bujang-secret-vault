-- 12단계 학습용 SQL입니다. Supabase SQL Editor에서 학생이 직접 실행합니다(이 저장소의 코드는 실행하지 않음).
-- 작전실이 복원 기록의 개수를 읽을 수 있게, 서버 전용 키(service_role)에 복원 감사 표 읽기 권한만 더합니다.
-- 추가만 가능한 장치(트리거)와 다른 권한은 그대로이고, 이 파일에는 메모 내용·키·사용자 값이 없습니다.
-- 실행하지 않으면 작전실의 복구 항목은 「읽지 못함」으로 표시됩니다(값을 만들어 채우지 않음).
grant select on public.notes_restore_audit_v10 to service_role;
