# 검문소·탐지 규칙

실제로 구현한 규칙만 아래 표에 추가하세요. 규칙 이름, 단계, 어떤 요청을 막는지, 확인한 방법을 함께 적으세요.

| 규칙 | 단계 | 막는 공격 | 확인 방법 |
|---|---|---|---|
| `device_registered` | 6 | 등록하지 않은 기기의 요청. `request.deviceRegistered`가 `true`가 아니면 `deny`·`device_not_registered` | `npm run decider:test` 「통과 · 미등록 기기의 가상 요청」과 「통과 · 등록 기기의 정상 요청」. 가상 요청 연습이며 심판 판정이 아님. 실제 미등록 기기 공격은 미실행 |
| `step_up_required` | 7 | 등록 기기라도 새벽 0~5시 + `signals.network`가 `unusual` + 최근 10분 `risk_signal` 10건 이상이 함께인 접속. `step_up`을 요구하고, `stepUp.verified`가 true이며 `authAgeSeconds`가 0~900이면 `allow` | `npm run decider:test` 「복합 이상 접속」·「다시 확인한 복합 이상 접속」, `npm run fixture:7`, `node --test test/decider-input.test.mjs`. 시각·네트워크 기준값은 연습 자료에 맞춘 가정이며 실제 재로그인 뒤 허용은 미실행 |
| `zone_notes_own_route` | 8 | 자기 메모 한 건 경로 `GET·PUT /notes/:id`(앱 경로 `/api/notes/:id` 포함, `queryLength` 0)만 통과시킴. 전체 목록과 다른 경로는 아래 규칙에서 거부 | `npm run decider:test` 「메모 한 건 수정」, `node --test test/zones.test.mjs`. 누구의 메모인지는 판정기가 모르며 서버 함수의 소유자 검사가 맡음 |
| `zone_announcement_edit` | 8 | `PUT /announcements/:id`·`PUT /api/announcements/:id`처럼 일반 학생이 강사 공지를 고치려는 요청. `deny`·`zone_not_allowed` | `npm run decider:test` 「강사 공지 수정(강사 확인 불가)」. 강사를 확인할 값이 계약에 없어 누구에게도 허용하지 않음 |
| `zone_unknown_route` | 8 | 표에 없는 메서드·경로·깊이(`/notes/export` 포함)·쿼리가 붙은 요청. `deny`·`zone_not_allowed` | `npm run decider:test` 「같은 깊이의 export 경로」·「쿼리가 붙은 요청」 |
| 소유자 검사 (서버 함수, `RULE_IDS` 아님) | 4 | 다른 사용자의 메모 id로 `GET·PUT·DELETE /api/notes/:id`를 요청. 남의 메모·주인 없는 메모·없는 메모는 모두 같은 `404` | `node --test test/notes-api.test.mjs`(가짜 DB). 실제 배포에서 A·B 두 계정으로 확인한 기록은 없음(미실행) |
| 메모 복원 대조 (서버 함수, `RULE_IDS` 아님) | 10 | `POST /api/notes/:id/restore`에서 사본(메모를 만들 때, 또는 사본이 없던 메모를 처음 수정·삭제하기 직전에 서버가 남긴 예약 행)의 ID·소유자·내용 해시가 로그인 결과와 다른 복원. 사본이 없거나 변조되면 쓰지 않고 멈추고(`404`·`409`), `dryRun`은 쓰지 않고 버전과 바뀔 항목만 보여 주며, 복원 뒤 재확인 실패는 쓴 내용을 되돌리고 `502` | `node --test test/notes-restore.test.mjs`(가짜 DB). 실제 DB 복원은 미실행 |
| `xdr.brute-force.deny.<주소>` (연습 거부 규칙, `RULE_IDS` 아님) | 보너스 1 | 같은 주소의 로그인 실패 연속·여러 계정에 같은 비밀번호를 대입하는 경보(MITRE T1110) | `npm run xdr:run -- brute-force`, `node --test test/xdr-respond-merge.test.mjs`. 판정기에는 연결하지 않았음 |
| `xdr.web-injection.deny.<주소>` (연습 거부 규칙, `RULE_IDS` 아님) | 보너스 2 | 요청 인자에 SQL 구문·스크립트 태그·`../` 반복이 섞인 경보(MITRE T1190) | `npm run xdr:run -- web-injection`, `node --test test/xdr-respond-merge.test.mjs`. 판정기에는 연결하지 않았음 |

이 표의 확인은 로컬 가상 요청과 가짜 DB 시험입니다. 배포 주소에서 실제로 보낸 요청의 결과와 심판의 판정은 아닙니다. `src/detect.mjs`(9단계)는 회수를 제안만 하는 탐지 함수로 판정 규칙이 아니라서 이 표에 넣지 않았습니다.

브라우저에서 버튼을 숨기는 것만으로 서버 접근이 차단됐다고 적지 마세요.
