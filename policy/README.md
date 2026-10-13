# policy/ 파일 안내

- `safe-policy.snapshot.json`: 침해 전에 검증해 둔 판정기 정책 사본(`safe-v9`). 버전·커밋·`POLICY` 전체·`sha256`을 담습니다. 손으로 고치지 않습니다(고치면 해시가 달라져 `policy:diff`가 중단합니다).
- `audit.jsonl`: 사본 만들기와 복원 기록입니다. 한 줄씩 덧붙이기만 하고 지우거나 고치지 않습니다.
- 사본 재검증·기록: `npm run policy:verify`(사본의 `lastVerified`와 `audit.jsonl`의 `verify` 줄만 더함, 정책과 `sha256`은 그대로)
- 비교: `npm run policy:diff` · 미리보기: `npm run policy:restore` · 복원: `npm run policy:restore -- --confirm <확인 코드>`
- 이 도구는 `src/decider.mjs`의 `POLICY` 블록만 다룹니다. 배포 환경의 설정이나 Supabase는 건드리지 않습니다.
