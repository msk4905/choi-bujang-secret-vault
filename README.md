# BYTE BACK 방어전 시작 틀 R5

## 현재 단계: 12단계 「탈환 작전실을 완성합니다」

12단계 기록은 맨 아래 '12단계 저장점', 11단계는 그 앞, 아래 '10단계' 요약은 10단계 때 모은 증거입니다. 1~9단계 기록은 단계별로 있습니다.

### 10단계 요약 (10단계 때 기록, 그대로 보존)

### 복구 경로와 사본
- **복구 경로** (`aleph.config.json`의 `restoreRoute`): `POST /api/notes/restore` · 서비스 `notes` · 로그인 필요 · 본문 `{ "id": "<메모 UUID>" }` (`contentSha256`은 선택, 보내면 사본과 대조).
- **사본 위치**: 비공개 표 `public.notes_backup_copy_v10` (서버 전용 키로만 읽음). 표를 만드는 SQL은 `supabase/10-restore-tables.sql`. 복원 기록은 `notes_restore_audit_v10`에 추가만 합니다.

### 사본과 같을 때만 그 한 건을 복원합니다 (세 값 대조)
1. **ID**: 요청의 `id`로 사본을 찾습니다. 사본이 없으면 복원하지 않고 `404`.
2. **소유자**: 서버가 확인한 로그인 사용자가 사본의 `owner_id`와 같아야 합니다(요청 본문의 소유자 값은 읽지 않음). 다르면 `404`.
3. **내용 해시**: 사본에 저장된 sha256을 사본 내용으로 다시 계산해 같아야 하고(다르면 `409`, 복원 안 함), 요청에 해시가 있으면 그것도 같아야 합니다(`409`).
- 복원 뒤 그 행을 다시 읽어 **ID·소유자·제목·내용 해시가 사본과 같은지 확인**하고 다르면 오류로 처리합니다. 다른 메모 행은 읽지도 쓰지도 않고, 기존 감사 기록은 그대로입니다.

### 실제로 확인한 복구 결과 (실제 Supabase, 시험 계정 B, 2026-10-13)
| 항목 | 사본 | 복구한 메모 | 일치 |
|---|---|---|---|
| ID | `2398aaaf-8283-4835-8c8d-203a5a97f72d` | 같은 ID (응답 `id`) | 일치 |
| 소유자 | 시험 계정 B | B의 토큰으로 조회 성공(남의 메모면 `404`) | 일치 |
| 내용 해시(sha256) | `164efc7d59cdc7b2d5a73bb58685c250ed918f57086f5986a6a14e764e741fb7` | 복구 뒤 본문의 sha256이 같은 값 | 일치 |
- 응답은 `restored: True`였고, 변조 → 복구를 반복해 감사 표가 2행이 되었습니다(복원 성공 두 번 기록). 이 시험은 학생이 B 계정으로 직접 했고 그 결과를 학생이 알려 준 대로 적었습니다.

### 안전 정책 사본 검증 (제작 1·2, 백업 검증)
- 판정기 정책은 `src/decider.mjs`의 `POLICY` 블록 한 곳에 있고, 검증한 안전 사본은 `policy/safe-policy.snapshot.json`(`safe-v9`, sha256 포함)입니다.
- `npm run policy:verify`: 저장된 사본을 다시 읽어 모양·해시·안전 조건을 검증합니다. 실패하면 중단하고 아무것도 쓰지 않습니다.
- `npm run policy:diff`: 복원할 버전과 해시를 첫 줄에 보이고, 다시 생길 규칙·사라질 규칙·바뀔 규칙을 보여 줍니다(파일을 바꾸지 않음). 사본이 없거나 해시가 다르면 중단합니다.
- `npm run policy:restore`: 먼저 미리보기(버전·바뀔 항목·확인 코드)만 보여 주고, `-- --confirm <확인 코드>`를 줄 때만 되돌립니다. 사본 검증에 실패하면 멈추고 쓰지 않습니다. 다른 서비스 규칙과 감사 이력(`policy/audit.jsonl`)은 보존하고 한 줄만 덧붙입니다. 배포 환경의 설정이나 Supabase는 건드리지 않습니다.

### 복구 뒤 재시험 (제작 4) — 정상 요청과 금지 요청을 다시 실행한 결과
- 실행 시점: 위 '실제로 확인한 복구 결과'(변조 → 복구) **이후**, 2026-10-13 15:54 UTC, 배포 커밋 `3a1571203ba7`. 정상 요청은 허용·성공해야 하고, 금지 요청은 거부되어야 합니다.
- 표에는 **실제로 실행한 것과 그 결과만** 적었습니다. 실행하지 않은 시험은 결과 칸에 쓰지 않고 맨 아래 '실행하지 않은 시험'에 따로 적었습니다.

| 단계 | 구분 | 요청·명령 | 기대 | 실제 결과 |
|---|---|---|---|---|
| 1·2 | 정상 | 배포 `GET /`, `GET /data.json` | `200`, 공개 자료에 메모 없음 | `200`, `200`(메모 0건) |
| 1·2 | 금지 | `/data.json`의 "실습용 가상" 문구 수 / `git grep "실습용 가상"`(README 제외) | `0` / 출력 없음 | `0` / 출력 없음 |
| 3 | 정상 | B 토큰으로 복구한 메모 `GET /api/notes/<id>` | `200`, 내용이 사본과 같음 | `200`, 본문 해시가 사본과 같음(학생 실행) |
| 3 | 금지 | 토큰 없는 `GET`·`POST /api/notes`, `PUT`·`DELETE /api/notes/<id>` | `401` | 네 요청 모두 `401` |
| 3 | 금지 | 위조 토큰의 `GET /api/notes` | `401` | `401` |
| 5 | 정상 | `GET /api/config`(로그인용 공개 설정) | `200` | `200` |
| 5 | 금지 | 공개 키만으로 원본 자료 주소(`originalApiUrl`) 직접 요청 | `401`·`403` | `401` |
| 6 | 정상 | `npm run decider:test` 「등록 기기의 정상 요청」 | `allow` | 통과 |
| 6 | 금지 | 「미등록 기기의 가상 요청」 | `deny`, `device_not_registered` | 통과 |
| 7 | 정상 | `npm run fixture:7` 정상 사건 | `allow` | `allow` |
| 7 | 금지(추가 확인) | `fixture:7` 복합 이상 사건 / `decider:test` 「복합 이상 접속」 | `step_up` | `step_up` / 통과 (「다시 확인한 복합 이상 접속」도 통과) |
| 8 | 정상 | `decider:test` 「메모 한 건 수정」 | `allow` | 통과 |
| 8 | 금지 | 「강사 공지 수정」, 「같은 깊이의 export 경로」, 「쿼리가 붙은 요청」 | `deny` | 세 줄 모두 통과 |
| 9 | 정상 | `npm run detect:test` 「정상 조회 30건」, 「10분 안에 120건」 | 회수 제안 없음(`observe`) | 통과 |
| 9 | 금지 | 「10분 안에 121건」, 「폭주 조회 200건」 | `propose_revocation` | 통과 |
| 9 | 정상 | 「서로 다른 사용자 각 100건」, 「10분 밖으로 흩어진 조회 200건」 | 회수 제안 없음 | 통과 |
| 10 | 정상 | 사본과 같은 한 건 복구(`POST /api/notes/restore`, B 토큰) | `200`, `restored: True` | `restored: True`, 해시 일치(실제 DB, 학생 실행) |
| 10 | 금지 | 토큰 없는 `POST /api/notes/restore` / `GET /api/notes/restore` | `401` / `405` | `401` / `405` |
| 정책 | 정상 | 정책 복원 뒤 `npm run policy:diff` | 바뀔 항목 0개 | 바뀔 항목 0개 |
| 정책 | 금지 | `npm run policy:test`: 변조된 정책이 허용하던 미등록 기기·공지 수정·export·쿼리 요청·표에 없는 메모 삭제 5건이 복원 뒤 모두 거부되고, 정상 요청은 허용 | 5건 `deny`, 정상 `allow` | 20개 통과 |
| 전체 | 정상 | `node --test test/*.test.mjs` | 모두 통과 | 79개 통과, 실패 0 |

- 6~9단계의 판정기·탐지 시험은 가상 요청·가상 사건 연습이며 반 엔진의 사건 전달이나 접속 회수가 연결됐다는 증거가 아닙니다. 심판의 판정이 아닙니다.

### 실행하지 않은 시험 (결과 없음)
- A·B 두 계정의 화면 확인(메모 추가·수정·삭제), B 토큰으로 A의 메모 id를 요청하면 `404`인지의 실제 확인(4단계), 5단계 ①~④ 중 화면에서 하는 부분.
- 실제 DB에서 A 토큰으로 B의 사본 ID를 복원하면 `404`, 틀린 해시를 보내면 `409`인지의 확인(가짜 DB 시험으로만 확인함).
- 같은 로그인으로 다시 로그인한 시각을 확인하는 7단계의 실제 재로그인 확인(계약에 없음).

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. 1단계 시작 틀에서는 `/data.json`에 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점이었고, 2단계부터는 메모를 `/data.json`에서 뺐습니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.

## 2단계: 가상 메모를 코드 밖으로 옮긴 뒤 확인하는 절차

> 이 절부터 '2단계 제작 2', '2단계 보완'까지는 2단계 시점의 기록입니다. 3단계에서 `/api/notes`가 로그인 필요로 바뀌었으니 현재 상태는 맨 아래 '3단계 저장점'을 보세요.

가상 메모는 학습용 Supabase 테이블(`public.notes`, RLS 켬, anon·authenticated 읽기 권한 없음)로 옮깁니다. 테이블을 만드는 `supabase/schema.sql`에는 메모 문장이 들어 있어서 `.gitignore`로 Git에서 제외했고, SQL Editor에 직접 붙여넣어 실행합니다. 공개 `data.json`과 `public/data.json`은 `notes: []`만 남깁니다. 키·비밀번호는 이 저장소에 넣지 않습니다.

### 검색 확인 (둘 다 하고 결과를 각각 기록)

1. **GitHub 최신 파일**: 최신 커밋을 받은 뒤 저장소 루트에서 실행합니다.
   `git grep -n "실습용 가상" -- . ':!README.md'`
   (이 README 자체에 검색어가 적혀 있어서 README는 제외합니다.) 정상: 출력이 없습니다. 거부해야 할 결과: 한 줄이라도 나오면 실패이며, 그 파일을 먼저 고칩니다.
2. **현재 배포 파일**: 배포가 끝난 뒤 `curl -s https://<본인 배포 주소>/data.json | grep -c "실습용 가상"` 을 실행하고, 브라우저에서 `/` 화면에도 메모가 보이지 않는지 봅니다.
   정상: `0`이고 화면에 메모 줄이 없습니다. 거부해야 할 결과: `1` 이상이거나 메모가 보이면 실패입니다. 새 배포가 끝났는지 먼저 확인하세요.

기록할 칸: 실행한 날짜와 시각, 명령, 결과(출력 없음/건수), 미실행 항목은 "미실행"으로 적습니다. 이 검색은 학생의 자기 점검이며 심판의 판정이 아닙니다.

### 과거 노출은 해소되지 않았습니다

이 확인은 **지금의** 최신 파일과 **지금의** 배포만 봅니다. 가상 메모가 들어 있던 옛 공개 커밋은 Git 기록에 그대로 남아 있고, 옛 배포(이전 Vercel 배포 URL)도 지우거나 막기 전에는 접근될 수 있습니다. 따라서 "과거 노출이 해소됐다"고 쓰지 않습니다. 이번 단계의 메모는 가상 자료이므로 허용되는 상태이며, 실제 자료였다면 별도 조치가 필요합니다.

### 공개 API의 남은 약점 (현재 확인된 것만 기록)

- `/data.json`은 여전히 로그인 없이 누구나 읽을 수 있는 정적 파일입니다. 지금은 메모가 비어 있어 가상 메모는 나오지 않지만, 읽기 보호가 구현된 것은 아닙니다.
- 자료를 읽는 서버 함수 `/api/notes`가 있지만 로그인이 없어 **누구나 부를 수 있습니다**. 그래서 이 함수가 돌려주는 자료는 가상 메모뿐이어야 합니다. 보호는 3단계 이후에 구현합니다.
- `owner_id`는 칸만 있고 `auth.users` 외래키도 없으며, 소유자별 읽기·쓰기 정책도 없습니다. 3단계 로그인 뒤에 만들 일입니다.
- `/api/ai`와 `/api/threat-intel`은 인증 없이 호출되며 `501`만 돌려주는 빈 틀입니다. 실제 기능은 구현되지 않았습니다.
- `aleph.config.json`의 `step`은 2입니다(2단계 보완에서 올림). 빌드는 1~2단계 흐름이라, 3단계로 올릴 때는 `scripts/build-public.mjs`와 `scripts/deployment-identity.mjs`를 해당 단계에 맞게 바꿔야 합니다.
- Supabase 쪽 설정(RLS 켬, 권한 회수)은 SQL Editor에서 학생이 실행해 확인해야 하며, 이 저장소에서는 실행해 보지 않았습니다.

## 2단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

- 작동하는 것: `/` 화면(서버 함수 `/api/notes`로 Supabase의 가상 메모 네 건을 읽음)과 정적 `/data.json`(`notes`는 빈 배열), `npm run build`(`--local`은 로컬 확인용), 학습용 Supabase 테이블 스키마 파일(`supabase/schema.sql`, Git 제외).
- 아직 아닌 것: 로그인으로 보호되는 자료 API, 소유자별 정책, `/api/ai`·`/api/threat-intel` 구현. `aleph.config.json`의 `step`은 2이고(2단계 보완), 빌드는 1~2단계 흐름입니다.
- 다시 실행: `npm run build -- --local`로 화면 자료를 만들고, SQL Editor에서 `supabase/schema.sql`을 실행합니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다. 이때 `aleph.config.json`의 `publicAppUrl`에 본인의 실제 `https://…vercel.app` 주소가 필요합니다.
- `src/attack-check.mjs`는 실제로 보낸 요청의 결과만 기록하는 자기 점검이며 심판의 판정이 아닙니다. 아직 실행하지 않았습니다.
- `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny`뿐이며, 판정 규칙은 6단계부터 구현합니다.

### 2단계 제작 2: 서버 함수로 자료 읽기

- `api/notes.js`는 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 Vercel 환경변수에서만 읽고, 제목과 내용만 `{ "notes": [...] }`로 돌려줍니다(`owner_id`는 싣지 않음). 키 값은 응답·로그·브라우저 파일에 넣지 않으며, 오류 응답에는 일반 오류 이름만 담습니다. 화면(`public/index.html`)은 이 함수에서 메모를 받아 카드로 보여 줍니다.
- 환경변수는 학생이 Vercel 프로젝트의 **Settings → Environment Variables**에서 직접 만듭니다(값은 코드·Git·대화에 적지 않음). 저장한 뒤 **Deployments → 최신 배포 → Redeploy**를 눌러야 반영됩니다.
- **남은 약점**: `/api/notes`는 로그인 없이 누구나 부를 수 있는 공개 주소입니다. 접근 제한이 없고 호출 횟수 제한도 없습니다. 3단계 전까지는 가상 메모만 두세요.
- 확인: 화면에는 네 카드가 보이고, `/data.json`에는 메모가 없어야 합니다. 환경변수를 넣지 않으면 `/api/notes`는 `503 NOTES_NOT_CONFIGURED`를 돌려주며 화면에는 오류 문구가 보입니다.
- 이 저장소에서는 가짜 로컬 서버로만 함수의 동작을 시험했습니다. 실제 Supabase 연결과 배포 화면은 학생이 확인해야 합니다.

### 2단계 보완: 정적 응답에서 시작 틀 확인 표시 빼기

- 1단계 시작 틀의 확인 표시 `SAMPLE_NOTE_1`은 1단계 공개 자료에만 둡니다. `data.json`과 `aleph.config.json`에서 `sampleMarker`를 지웠고, `step`이 2면 `/aleph.json`에도 싣지 않습니다(`scripts/deployment-identity.mjs`는 1단계에서만 싣습니다).
- `src/attack-check.mjs`는 배포 주소의 `/data.json`에 메모가 없는지, `/data.json`과 `/aleph.json`에 시작 틀 확인 표시가 없는지를 직접 요청해 기록합니다. 심판의 판정이 아니라 자기 점검입니다.
- 확인: `curl -s https://<본인 배포 주소>/data.json`은 `{ "notes": [] }`만 보이고, `/aleph.json`에는 `sampleMarker`가 없어야 합니다.

## 3단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

- 작동하는 것(코드 시험 기준): `/` 화면의 이메일·비밀번호 로그인·로그아웃(Supabase Auth 공식 SDK, 실패 이유 표시)과, 로그인한 사용자의 가상 메모 추가·수정·삭제 화면. 화면 코드에는 공개용 Project URL과 publishable key만 들어 있습니다.
- 서버 API: `GET·POST /api/notes`, `GET·PUT·DELETE /api/notes/:id`(`vercel.json`이 `/:id`를 `?id=`로 넘김). 처리는 `src/notes-handler.mjs`이고, 요청의 `Authorization: Bearer` 토큰을 틀의 `src/verify-login.mjs`로 검사합니다. 토큰이 없거나 검사에 실패하면 자료 없이 `401`입니다. 추가할 때는 서버가 확인한 사용자 ID만 `owner_id`로 저장하고, 본문의 `userId`·`owner_id`·`role`은 읽지 않습니다. 목록 GET은 `owner_id`가 본인인 메모만 돌려줍니다.
- 설정: `aleph.config.json`의 `step`은 3이고, `identityProvider`(발급자·대상·공개키 주소, 비밀 키 없음)와 `allowedRoutes`(위 다섯 경로)를 적었습니다. `judgeIssuer`와 `repoUrl`, `publicAppUrl`은 바꾸지 않았습니다.
- 다시 실행: `npm run build -- --local`로 화면 자료를 만들고, `npm run test:r5`, `npm run test:package`, `node --test test/notes-api.test.mjs`로 시험합니다(가짜 DB·가짜 로그인 검사기 사용, 실제 Supabase·배포 확인이 아님). 배포 화면에는 Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 학생이 직접 넣고 Redeploy해야 합니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`, `artifacts/`는 Git에 올리지 않음).
- 확인(배포 주소에서): 토큰 없는 `curl -s -o /dev/null -w "%{http_code}\n" https://<배포 주소>/api/notes`는 `401`이어야 합니다. A 계정으로 로그인하면 메모를 추가·수정·삭제할 수 있고, 로그아웃하면 목록이 사라져야 합니다.
- `src/attack-check.mjs`: 3단계에서는 토큰 없는 GET·POST·PUT·DELETE와 서명 없는 위조 토큰 요청의 상태 코드만 기록합니다(실제로 보낸 요청의 결과이며 심판의 판정이 아님). 정상 A 로그인 뒤 동작은 이 점검이 보내지 않아 `미실행`으로 남깁니다.
- `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny`뿐이며, 판정 규칙은 6단계부터 구현합니다.

### 3단계의 남은 약점

> 3단계 시점의 기록입니다. 아래 첫 항목(소유자 검사 없음)은 4단계에서 코드로 고쳤으니 현재 상태는 맨 아래 '4단계 저장점'과 '4단계의 남은 약점'을 보세요.

- **소유자 검사 없음(4단계 과제)**: B가 A의 메모 id를 알면 `GET·PUT·DELETE /api/notes/:id`로 접근할 수 있습니다. 목록만 본인 메모로 좁혀 있습니다. 이 접근을 확인한 기록은 아직 없습니다.
- 처음 넣은 가상 메모 네 건은 `owner_id`가 비어 있을 수 있어 목록에 나오지 않을 수 있습니다.
- `notes.id` 칸이 UUID 타입인지는 이 저장소에서 확인하지 못했습니다(`supabase/schema.sql`은 Git 제외). UUID가 아니면 추가가 `502`로 실패합니다.
- `/api/ai`와 `/api/threat-intel`은 여전히 인증 없이 `501`만 돌려주는 빈 틀입니다.
- `allowedRoutes`는 `"METHOD /경로"` 문자열로 적었습니다. 문서에 정해진 형식이 없어 운영 측 양식과 다를 수 있습니다.
- 이 저장소에서는 실제 Supabase 연결·배포 화면·정상 A 로그인 동작을 시험하지 못했습니다. 학생이 확인해야 합니다. 배포 주소는 `main`에 합치기 전이면 이전 코드일 수 있습니다.

## 4단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

- 작동하는 것(코드 시험 기준): `GET·PUT·DELETE /api/notes/:id`가 DB의 `owner_id`와 서버가 확인한 사용자 ID를 비교해 본인 메모만 처리합니다. 남의 메모, 주인 없는 메모, 없는 메모는 모두 같은 `404 NOT_FOUND`입니다. 수정·삭제 조건에도 `owner_id`를 다시 걸고, 수정은 `owner_id`를 바꾸지 않습니다. 추가는 확인된 ID만 저장하고 목록은 본인 메모만 돌려줍니다. 한 건 응답은 `{id,title,body}`, 수정 본문은 `{title,body}`입니다. 처리는 `src/notes-handler.mjs`입니다.
- DB 권한(학생이 SQL Editor에서 실행한 학습용 SQL, 저장소에는 SQL을 두지 않음): `public.notes`에 RLS를 켜고 `anon`·`authenticated`의 권한을 회수한 뒤 `authenticated`에만 SELECT·INSERT·UPDATE·DELETE를 부여했습니다. 정책 `notes_select_own`·`notes_insert_own`·`notes_update_own`·`notes_delete_own`은 모두 `auth.uid() = owner_id`일 때만 허용합니다. 학생이 보고한 결과는 SQL로 역할을 흉내 낸 시험(A·B 각자 자기 행만, 상대 행·소유자 변경·`anon` 읽기 거부)이 기대와 모두 일치했다는 것이며, 이 저장소에서는 실제 DB에 접속하지 않아 확인하지 못했습니다. 서버 API는 서버 전용 키로 접속하므로 RLS를 건너뛰고, API의 접근 구분은 위 소유자 검사가 맡습니다.
- 설정: `aleph.config.json`의 `step`은 4이고 `allowedRoutes`는 실제 다섯 경로(`GET·POST /api/notes`, `GET·PUT·DELETE /api/notes/:id`) 그대로입니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`은 바꾸지 않았습니다. 빌드(`scripts/build-public.mjs`, `scripts/deployment-identity.mjs`)는 1~4단계 흐름입니다.
- 다시 실행: `npm ci` 뒤 `node --test test/notes-api.test.mjs`(소유자 시험 포함), `npm run test:r5`, `npm run test:package`로 시험합니다(가짜 DB·가짜 로그인 검사기, 실제 Supabase·배포 확인이 아님). 화면 자료는 `npm run build -- --local`입니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만들며 `bundle-notes.json`(Git 제외)에 단계 설명이 필요합니다.
- `src/attack-check.mjs`: 4단계에서는 3단계의 토큰 없는 요청·위조 토큰 점검에 더해 `cross_owner_access`(B 로그인으로 A의 메모 접근)를 **미실행**으로 남깁니다. A·B 로그인 계정을 쓰지 않아서 이 점검이 보내지 않기 때문입니다. 실제로 보낸 요청의 결과만 기록하며 심판의 판정이 아닙니다.
- `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny`뿐이며, 판정 규칙은 6단계부터 구현합니다.
- 확인(배포 주소에서): 앱에서 A로 로그인하면 메모를 추가·수정·삭제할 수 있고, B 토큰으로 A의 메모 id를 `GET·PUT·DELETE /api/notes/<id>`로 요청하면 `404`여야 합니다. 이 확인은 아직 하지 않았습니다. 배포 주소는 `main`에 합치기 전이면 이전 코드일 수 있습니다.

### 4단계의 남은 약점

- 3단계의 "소유자 검사 없음"은 코드에서 고쳤습니다. 다만 실제 배포 화면에서 A·B 두 계정으로 확인한 기록은 아직 없습니다.
- `owner_id` 칸에는 `auth.users` 외래키가 없습니다.
- 처음 넣은 가상 메모 네 건 중 `아침 리추얼`은 `owner_id`가 비어 있어 아무도 읽지 못합니다. 학생이 일부러 주인 없이 남겼습니다.
- 남의 메모와 없는 메모를 같은 `404`로 답하므로 응답으로는 존재 여부를 알 수 없지만, 요청 횟수 제한은 없습니다.
- `/api/ai`와 `/api/threat-intel`은 여전히 인증 없이 `501`만 돌려주는 빈 틀입니다.
- `allowedRoutes`는 `"METHOD /경로"` 문자열이며 운영 측 양식과 다를 수 있습니다.

## 5단계 저장점: 지금 작동하는 기능과 다시 실행하는 방법

> 3단계 저장점의 "화면 코드에는 공개용 Project URL과 publishable key만 들어 있습니다"는 3단계 시점의 기록입니다. 5단계에서 화면 코드의 키 글자를 뺐습니다.

- 작동하는 것(코드 시험 기준): 브라우저는 메모 자료를 Supabase에서 직접 읽거나 고치지 않고, 모든 자료 요청을 서버 함수 `/api/notes`(`/:id`)로 보냅니다. 브라우저의 Supabase 호출은 로그인(`signInWithPassword`·`signOut`·`getSession`·`onAuthStateChange`)뿐입니다.
- 로그인용 공개 설정: `public/index.html`에는 publishable key를 적지 않고, `GET /api/config`(`vercel.json`이 `/api/notes?config=1`로 넘김)에서 Project URL과 publishable key만 받습니다. 새 서버 함수 파일은 만들지 않아 `package/baseline-functions.json`은 그대로입니다. 값은 Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`에서만 읽으며, 없으면 `503 CONFIG_NOT_CONFIGURED`입니다. `SUPABASE_PUBLISHABLE_KEY`는 학생이 Vercel 환경변수에 직접 넣고 Redeploy해야 합니다.
- 설정: `aleph.config.json`의 `step`은 5이고 `allowedRoutes`에 `GET /api/config`를 더한 여섯 경로가 있으며, 3단계부터 `/aleph.json`에도 실립니다. `originalApiUrl`은 `https://cpdddhkjmfmwzsoxiokq.supabase.co/rest/v1/notes`입니다(쿼리 없음, 실제로 요청해 확인하지 못함). `restoreRoute`는 비어 있습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`은 바꾸지 않았습니다. 빌드는 1~5단계 흐름입니다.
- DB 권한(학생이 SQL Editor에서 실행한 학습용 SQL, 저장소에는 SQL을 두지 않음): `public.notes`의 `public`·`anon`·`authenticated` 직접 권한을 회수했다고 학생이 알려 줬습니다. 적용 전후 권한 조회 결과는 이 저장소에서 확인하지 못했습니다.
- 다시 실행: `npm ci` 뒤 `node --test test/*.test.mjs`(가짜 DB·가짜 로그인 검사기, 실제 Supabase·배포 확인이 아님)와 `npm run build -- --local`입니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만들며 `bundle-notes.json`·`artifacts/`는 Git에 올리지 않습니다.
- `src/attack-check.mjs`: 4단계 점검에 `original_api_direct`(배포 주소의 `/api/config`에서 받은 공개 키로 원본 자료 주소를 직접 요청해 상태 코드만 기록)를 더했습니다. 실제로 보낸 요청의 결과만 기록하며 심판의 판정이 아닙니다. 실행하지 못한 점검은 `미실행`으로 남습니다.
- `src/decider.mjs`의 `RULE_IDS`는 시작 틀의 `starter.deny`뿐이며, 판정 규칙은 6단계부터 구현합니다.
- 확인(학생이 배포 주소에서): ① A 로그인 뒤 메모 추가·수정·삭제 ② 토큰 없는 `GET /api/notes`는 `401` ③ B 토큰으로 A의 메모 id 요청은 `404` ④ 공개 키(`apikey` 헤더)만으로 원본 자료 주소를 요청하면 `401`·`403`이고 `200`이면 실패. ①~④는 아직 하지 않았습니다.

### 5단계의 남은 약점

- 위 ①~④ 실제 배포 확인 기록이 없습니다.
- `/api/config`는 로그인 전에 누구나 부를 수 있고 공개용 값만 돌려줍니다. 호출 횟수 제한은 없습니다.
- 서버 전용 키로 접속하는 서버 함수는 RLS와 테이블 권한을 거치지 않으므로, 접근 구분은 소유자 검사가 맡습니다.
- `owner_id`에는 `auth.users` 외래키가 없고, `/api/ai`·`/api/threat-intel`은 `501`만 돌려주는 빈 틀입니다.
- `allowedRoutes`는 `"METHOD /경로"` 문자열이며 운영 측 양식과 다를 수 있습니다.

## 보너스 xdr-01 저장점: 무차별 로그인 공격 탐지

- 작동하는 것: `xdr/brute-force/decide.mjs`가 연습 경보 28건을 block 10·alert 9·record 9로 나눕니다. 패턴 근거는 `patterns.json`(MITRE T1110), 확인용 읽기는 `read-alerts.mjs`, 거부 규칙 파일과 알림 기록은 `respond.mjs`가 `xdr/deny-rules.json`·`xdr/alerts.log`에 씁니다.
- 다시 실행: `npm run xdr:run -- brute-force`로 `result.json`을 만들고, `node xdr/brute-force/respond.mjs`로 규칙·알림을 만듭니다. 연습 경보에 맞춘 로컬 결과이며 심판의 판정이 아닙니다.
- 아직 아닌 것: 거부 규칙을 ZTNA 판정기(`src/decider.mjs`)에 연결하지 않았습니다. 요청 계약에 출발 주소가 없어서 지금은 연결할 수 없습니다.

## 보너스 xdr-02 저장점: 웹 주입 공격 탐지

- 작동하는 것: `xdr/web-injection/decide.mjs`가 연습 경보 26건을 block 8·alert 9·record 9로 나눕니다. 패턴 근거는 `patterns.json`(MITRE T1190: 요청 인자 안의 SQL 구문·스크립트 태그·`../` 반복), 확인용 읽기는 `read-alerts.mjs`, 거부 규칙과 알림 기록은 `respond.mjs`가 `xdr/deny-rules.json`·`xdr/alerts.log`에 씁니다. `respond.mjs`는 brute-force 규칙을 건드리지 않고 `xdr.web-injection.` 규칙만 고칩니다.
- 다시 실행: `npm run xdr:run -- web-injection`으로 `result.json`을 만들고, `node xdr/web-injection/respond.mjs`로 규칙·알림을 만듭니다. 연습 경보에 맞춘 로컬 결과이며 심판의 판정이 아닙니다.
- 아직 아닌 것: 거부 규칙을 ZTNA 판정기(`src/decider.mjs`)에 연결하지 않았습니다. 요청 계약에 출발 주소가 없어서 지금은 연결할 수 없습니다.
- 알아 둘 점: `decide.mjs`는 이름 있는 패턴 밖의 경보도 경보 자신의 T1190 표시와 반복 횟수로 판정합니다(명령 구분자 경보 1건이 block, 반복 없는 애매한 9건이 alert). `203.0.113.10`은 brute-force와 웹 주입 규칙이 둘 다 있어, `brute-force/respond.mjs`를 다시 실행하면 주소 기준 합치기 때문에 웹 주입 규칙 하나가 사라질 수 있습니다.

## 6단계 저장점: 등록한 기기만 자료실에 들어옵니다

- 규칙: `src/decider.mjs`의 `device_registered` 하나입니다. `request.deviceRegistered`가 `true`일 때만 `allow`(이유 코드 `approved`)이고, `false`이거나 값이 없거나 `true`가 아닌 값이면 `deny`와 이유 코드 `device_not_registered`입니다. 사용자·기기 정보는 계약에 있는 `subjectId`, `deviceId`, `deviceRegistered`만 봅니다(`docs/DECIDER_REQUEST.md`).
- 이번 과정에는 따로 설치할 접속 프로그램이 없습니다. 이 단계에서 설치 명령은 필요하지 않습니다.
- 확인 순서:
  1. 저장소 루트에서 `npm run decider:test`를 실행합니다.
  2. 정상: 「통과 · 등록 기기의 정상 요청」(`allow`)과 「통과 · 미등록 기기의 가상 요청」(`deny`, `device_not_registered`) 두 줄이 모두 나옵니다.
  3. 거부해야 할 결과: 둘 중 하나라도 「확인 필요」로 나오면 실패이며, 그 줄의 이름이 가리키는 쪽 규칙을 먼저 고칩니다.
- `npm run decider:test`는 가상 요청 연습이며 심판의 판정이나 실제 접속 증거가 아닙니다. `approved`가 운영 등록부의 허용 이유 코드에 있는지는 이 저장소에서 확인하지 못했습니다.
- 미등록 기기로 들어오려는 실제 공격 시도는 심판이 맡습니다. 이 저장소에서는 그 공격을 실행하거나 시험하지 않았습니다.
- 지금 작동하는 것(코드 시험 기준): 5단계까지의 로그인·소유자 검사·서버 함수 흐름은 그대로이고, 판정기 `decide()`가 `device_registered` 규칙 하나로 등록 기기만 `allow`합니다. `RULE_IDS`는 `starter.deny`와 `device_registered`입니다.
- 설정: `aleph.config.json`의 `step`은 6입니다. 빌드(`scripts/build-public.mjs`, `scripts/deployment-identity.mjs`)와 `src/attack-check.mjs`가 6단계를 받도록 단계 목록만 늘렸습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`allowedRoutes`·`originalApiUrl`은 바꾸지 않았습니다.
- `src/attack-check.mjs`: 5단계 점검에 `unregistered_device`를 **미실행**으로 더했습니다. 미등록 기기 공격은 심판이 맡고, 이 점검은 그런 요청을 보내지 않습니다.
- 다시 실행: `npm run decider:test`, `npm run build -- --local`입니다. `node --test test/*.test.mjs`는 `@supabase/supabase-js`가 설치되어 있어야 하므로 먼저 `npm ci`를 실행합니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음).
- 이전 5단계 ①~④ 배포 확인은 여전히 하지 않았습니다.

## 7단계 저장점: 평소와 다른 접속은 다시 확인합니다

- 규칙: `src/decider.mjs`의 `RULE_IDS`는 `device_registered`와 `step_up_required` 둘입니다(시작 틀의 `starter.deny`는 더 이상 쓰지 않아 뺐습니다). 등록 기기만 통과하는 6단계 규칙은 그대로이고, 그 위에 `step_up_required`가 더해졌습니다.
- `step_up_required`: 등록 기기의 요청에서 **새벽 0~5시**, `signals.network`가 `unusual`, 최근 10분 안 `risk_signal` 합계 **10건 이상**, 세 가지가 함께일 때만 `step_up`(이유 코드 `step_up_required`)을 돌려줍니다. 지역(`region`)은 판정에 쓰지 않으므로 지역 하나만으로는 거부도 추가 확인도 되지 않습니다. `stepUp.verified`가 true이고 `authAgeSeconds`가 0~900 정수이면 `allow`, 형식이 틀리거나 901초 이상이면 다시 `step_up`입니다. 시각·네트워크 기준값과 사건 이름은 연습 자료에 맞춘 가정이며 운영 정의는 확인하지 못했습니다.
- 입력 검사: `readSignals(request)`가 `signals.source`를 `none`·`judge_fixture`·`unverified`로 구분합니다. `verified`는 항상 `false`이고, 없거나 형식이 틀린 지역·네트워크·시각은 `null`로 남겨 정상값으로 채우지 않습니다. 헤더 같은 클라이언트 값은 요청 계약에 없어 읽지 않습니다.
- 다시 실행: `npm run decider:test`(네 줄 모두 「통과」), `npm run fixture:7`(정상 `allow`, 복합 이상 `step_up`), `node --test test/decider-input.test.mjs`입니다. 가상 요청 연습이며 심판 판정이 아닙니다.
- 아직 아닌 것: 엔진이 같은 로그인으로 다시 로그인한 시각을 확인하는 계약이 `docs/DECIDER_REQUEST.md`에 없어서, 다시 로그인하기 전 자료 차단과 새 로그인 뒤 허용은 실측하지 못했습니다. `src/attack-check.mjs`의 `step_up_reauth`는 **미실행**입니다. `decide()`를 부르는 곳은 시험 스크립트뿐이고 `/api/notes`는 판정기와 연결되어 있지 않습니다. `step_up_required`가 운영 등록부의 허용 이유 코드에 있는지도 확인하지 못했습니다.
- 설정: `aleph.config.json`의 `step`은 7이고, 빌드와 `attack-check.mjs`의 단계 목록에 7을 더했습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`allowedRoutes`·`originalApiUrl`은 바꾸지 않았습니다.
- 제출 묶음: 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음). 이전 5단계 ①~④ 배포 확인은 여전히 하지 않았습니다.

## 8단계 저장점: 자료마다 갈 수 있는 구역을 나눕니다

- 자원 ID: `src/resources.mjs`가 메모는 `note:<uuid>`(목록·추가는 `note:collection`), 강사 공지는 `announcement:<uuid>`로 서로 겹치지 않게 정합니다. `src/notes-handler.mjs`가 요청마다 서버가 확인한 경로에서만 `request.resourceId`를 계산하며, 응답과 주소는 바뀌지 않았습니다. 이 값을 읽는 코드는 아직 없습니다.
- 판정기 구역 규칙: `RULE_IDS`는 `device_registered`, `step_up_required`, `zone_notes_own_route`, `zone_announcement_edit`, `zone_unknown_route`입니다. 등록 기기의 자기 메모 한 건 경로 `GET·PUT /notes/:id`와 앱 경로 `/api/notes/:id`(`:id`는 한 칸짜리 ID, `export` 같은 기능 이름은 ID가 아님, `queryLength` 0)만 허용합니다. 여러 사람의 메모를 여는 전체 목록(`GET /notes`, `GET /api/notes`)은 판정기가 주인을 몰라 열지 않습니다. `PUT /announcements/:id`와 표에 없는 메서드·경로·깊이(`/notes/export` 포함)·쿼리는 `deny`와 이유 코드 `zone_not_allowed`입니다. 이 이유 코드가 운영 등록부의 허용 코드에 있는지, 경로 모양이 실제 엔진과 같은지는 확인하지 못했습니다.
- 자기 메모인지는 판정기가 판정하지 못합니다. 요청 계약에 메모 주인과 사용자 역할이 없고 `subjectId`는 가명이기 때문입니다. 이 구분은 서버 함수(`src/notes-handler.mjs`)가 검증된 사용자 ID와 DB의 `owner_id`를 비교해 맡습니다. 남의 메모·주인 없는 메모·없는 메모는 같은 `404`이고, 거부 사유(`unauthenticated`, `not_found`, `not_owner`, `no_owner`, `owner_changed`)는 서버 로그에 짧은 코드로만 남습니다(ID·토큰·본문 없음).
- 강사 권한: 강사임을 확인할 저장값이 이 저장소와 시작 틀(`ChoiTimo/aleph-defense-starter`)에 없고 계약에도 없습니다. 그래서 강사 공지 수정은 누구에게도 허용하지 않으며, 공지 자료·주소는 만들지 않았습니다. 판정기는 아직 `/api/notes`와 연결되어 있지 않습니다.
- 설정: `aleph.config.json`의 `step`은 8이고 빌드와 `attack-check.mjs`의 단계 목록에 8을 더했습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`allowedRoutes`·`originalApiUrl`은 바꾸지 않았습니다. 연습 자료 `scripts/fixture-7.mjs`의 경로는 UUID 모양으로 바꿨습니다.
- 다시 실행: `npm ci` 뒤 `npm run decider:test`(「통과」 여덟 줄), `node --test test/*.test.mjs`(가짜 DB·가짜 로그인 검사기, 심판 판정이 아님)입니다. 제출 묶음은 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음).
- `src/attack-check.mjs`: `cross_zone_direct_api`를 **미실행**으로 더했습니다. A·B 로그인 계정을 쓰지 않아서입니다. 5단계 ①~④와 이전 미실행 항목, 실제 배포 화면의 A·B 확인은 여전히 하지 않았습니다.

## 9단계 저장점: 의심 사건에서 회수 제안만 냅니다

- 입력: `src/detect.mjs`의 `readEvents`가 사건에서 `at`, `method`, `identity.sub`만 읽습니다. 메모 내용·토큰·이름 같은 다른 칸은 복사하지 않고, 형식이 틀린 사건은 값 없이 개수로만 셉니다. `docs/DETECT_EVENTS.md`에 없는 선택 칸 `network`(`usual`·`unusual`), `deviceId`, `deviceRegistered`는 가정이며, 형식이 맞을 때만 읽고 아니면 `null`입니다. 지역은 읽지 않습니다.
- 회수 제안: `detect(events)`는 `docs/DETECT_EVENTS.md` 계약대로 같은 사용자의 `GET`이 어느 10분 구간에서 120건을 넘을 때(정확히 120건은 제외) `{ action: 'propose_revocation', reasonCode: 'burst_read', subject }`를 돌려주고, 그 밖에는 `observe`입니다. 다른 사용자의 사건은 합산하지 않고 10분 밖의 사건은 한 묶음으로 세지 않습니다. 구간의 모든 사건이 등록 기기(`deviceRegistered`가 `true`) 한 개에서 왔을 때만 그 `deviceId`를 덧붙입니다. 계약 모양의 사건에는 기기 칸이 없어 세 칸 그대로입니다. 회수를 실행하거나 기기 권한을 바꾸는 코드, 시각을 만드는 코드는 없습니다. 실제 회수와 시간은 심판이 확인합니다.
- 복합 의심(별도 함수): `flagSuspicious(events)`는 위 다량 조회에 `network`가 `unusual`인 사건이 함께 있을 때만 `flag_suspicious`(이유 코드 `burst_unusual_network`)를 돌려줍니다. `proposeRevocation(events)`는 그 의심 구간이 등록 기기 한 개에서 왔을 때만 그 기기를 대상으로 회수를 제안하고, 기기를 확인할 수 없거나 둘 이상이면 `observe`입니다. 다량 조회만, 낯선 네트워크만, 지역만은 이 두 함수에서 의심이 아닙니다.
- 알려진 한계: `proposeRevocation`은 의심 구간에 정상 기기 사건이 하나라도 섞이면 제안을 내지 않습니다. 정상 기기를 잘못 회수하지 않기 위한 보수적 선택입니다.
- 다시 실행: `npm ci` 뒤 `node --test test/detect-*.test.mjs`(통과해야 함)와 `npm run detect:test`입니다. `npm run detect:test`는 여섯 줄 모두 「통과」여야 합니다. 모두 가상 사건 연습이며 반 엔진의 사건 전달·접속 회수가 연결됐다는 증거나 심판 판정이 아닙니다. `detect()`·`flagSuspicious()`·`proposeRevocation()`을 부르는 곳은 시험 스크립트뿐입니다.
- 설정: `aleph.config.json`의 `step`은 9이고 빌드와 `src/attack-check.mjs`의 단계 목록에 9를 더했습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`allowedRoutes`·`originalApiUrl`은 바꾸지 않았습니다. `RULE_IDS`는 8단계와 같습니다(`src/decider.mjs`는 바꾸지 않음).
- `src/attack-check.mjs`: `detect_revocation_proposal`을 **미실행**으로 더했습니다. 5단계 ①~④, A·B 로그인 확인, 이전 미실행 항목도 여전히 하지 않았습니다.
- 제출 묶음: 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음).

## 10단계 저장점: 백업에서 자료실을 되살립니다

> 이 단계의 코드 시험은 가상 자료와 가짜 DB, 임시 폴더의 판정기 복사본으로 했습니다. 그와 별도로 아래 '제작 3'에 적은 실제 Supabase·배포 주소 시험은 학생이 B 계정으로 직접 실행한 결과를 학생이 알려 준 대로 옮긴 것입니다. 이 저장소의 코드 시험 환경에서는 로그인 토큰이 없어 실행하지 못했습니다. 모두 심판의 판정이 아닙니다.

### 제작 1·2: 판정기 정책의 안전 사본 비교와 되돌리기

> 처음에는 별도 시험 정책 파일(`policy/test-policy.json`)을 만들어 비교했으나, 심판의 「백업 검증」(S10_BACKUP_UNVERIFIED)이 6~9단계 판정기 정책을 가리키는 것으로 보고 대상을 `src/decider.mjs`의 판정 정책으로 바꿨습니다. 심판이 정확히 무엇을 읽는지는 확인하지 못했습니다.

- 정책 데이터는 `src/decider.mjs`의 `POLICY` 블록(`// POLICY-BLOCK-BEGIN` ~ `// POLICY-BLOCK-END`) 한 곳에 모았습니다: 규칙 이름(`ruleIds`), 이유 코드, 기기 확인(`deviceGate`), 추가 확인 기준(`stepUp`), 구역 공통 설정(`zoneCommon`), 서비스별 구역 표(`services.notes`, `services.announcements`). `decide(request)`의 이름·인자와 응답 다섯 항목은 그대로이고 `RULE_IDS`는 `POLICY.ruleIds`입니다. 리팩터링 전 판정기와 같은 요청 14,040건에서 응답이 모두 같음을 확인했습니다(일회성 비교, 저장소에는 두지 않음).
- 사본: `policy/safe-policy.snapshot.json`에 버전 이름 `safe-v9`, 커밋(`086403f…`, 사본을 만든 시점의 HEAD), `POLICY` 전체, `sha256`을 기록했습니다. 사본은 `npm run policy:snapshot`으로 침해 **전에** 한 번만 만들 수 있고(이미 있으면 거부), 안전 조건(필수 규칙 다섯 개, 등록 기기 확인, 추가 확인 사용, 구역 공통 설정, 공지 수정 전면 거부)을 통과해야 합니다.
- 사본 다시 읽어 검증하기: `npm run policy:verify`. 저장된 사본을 다시 읽어 모양·해시·안전 조건을 확인하고 현재 정책과의 차이 수를 보여 줍니다. 통과하면 사본 파일의 `lastVerified`(해시에 들어가지 않는 기록: 시각·그 시점 HEAD·차이 수)와 `policy/audit.jsonl`의 `verify` 한 줄만 더하고, 정책 파일과 사본의 `sha256`은 바뀌지 않습니다. 실패하면 중단하고 아무것도 쓰지 않습니다.
- 비교만 하기: `npm run policy:diff`. 첫 줄에 `복원할 버전: safe-v9 · 해시(sha256): …`, 이어서 **다시 생길 규칙 / 사라질 규칙 / 바뀔 규칙**을 보여 주고 파일은 바꾸지 않습니다. 사본이 없거나 해시가 다르거나 안전 조건을 어기면 `중단: …`과 종료 코드 1입니다.
- 되돌리기: `npm run policy:restore`는 미리보기(버전·바뀔 항목·**확인 코드**)만 보여 줍니다. `npm run policy:restore -- --confirm <확인 코드>`를 줘야만 `POLICY` 블록을 사본으로 다시 씁니다. 확인 코드는 현재 정책·사본·범위에서 계산되므로 다른 내용을 승인할 수 없습니다. 블록 밖의 코드는 바이트 그대로이고, 쓴 뒤 해시를 다시 읽어 확인하며 어긋나면 원래 파일로 되돌립니다. 감사 이력 `policy/audit.jsonl`은 지우지 않고 한 줄만 덧붙입니다(사본을 만들 때의 `snapshot` 줄이 이미 있음).
- 서비스 범위: `--service notes`를 붙이면 `services.notes`만 비교·복원하고 다른 서비스(`announcements`)와 공통 설정은 그대로 둡니다. 붙이지 않으면 정책 전체이고, 미리보기에 다른 서비스의 변경도 모두 나옵니다.
- 연습해 보기(실제 정책을 일부러 바꿈): `src/decider.mjs`의 `POLICY` 블록에서 `"requireRegistered": true`를 `false`로 바꾸고 → `npm run policy:diff`(바뀔 항목 1개) → `npm run policy:restore` → 안내된 `--confirm` 명령 → `npm run policy:diff`(0개) → `npm run decider:test`. 끝나면 `git diff src/decider.mjs`가 비어 있어야 하고 `policy/audit.jsonl`에는 `restore` 줄이 한 줄 늘어납니다. 연습이 끝났으면 이 줄은 지우지 말고 그대로 두거나 `git checkout -- policy/audit.jsonl`로 되돌립니다.
- 확인(가상 요청, 임시 폴더 시험): 변조된 정책에서는 미등록 기기·강사 공지 수정·`/notes/export`·쿼리가 붙은 요청·표에 없는 메모 삭제가 `allow`가 되고, 복원 뒤에는 모두 `deny`이며 등록 기기의 정상 요청은 `allow`(`approved`)로 유지됩니다(`npm run policy:test`). 이것은 판정기를 직접 부른 결과이며 심판의 판정이 아닙니다.
- 한계: 사본이 지키는 것은 `POLICY` 블록의 **데이터**입니다. 블록 밖의 판정 논리(`decide` 안의 순서와 입력 검사)가 바뀐 것은 이 도구가 보지 못하므로 Git 기록으로 확인해야 합니다. 사본이 정말 침해 전에 만들어졌는지는 해시로 증명되지 않고 커밋 기록으로만 알 수 있습니다. 판정기는 아직 `/api/notes`와 연결되어 있지 않아서, 이 복원은 배포 환경의 정책이나 Supabase를 바꾸지 않습니다.

### 제작 3: 비공개 가상 메모 사본에서 한 건만 복원

- 서비스·경로: 서비스 `notes`, `POST /api/notes/restore`(`vercel.json`이 `/api/notes?restore=1`로 넘김, 새 서버 함수 파일 없음). `aleph.config.json`의 `step`은 10이고 `allowedRoutes`에 이 경로를 더했으며 `restoreRoute`도 같은 문자열입니다(문자열 형식은 기존 `allowedRoutes`를 따른 것이며 운영 측 양식과 다를 수 있음).
- 요청: 로그인 토큰과 본문 `{ "id": "<메모 UUID>" }`가 필수이고, `"contentSha256": "<사본의 내용 해시>"`는 보내면 사본과 대조합니다(틀리면 `409`, 보내지 않아도 됨). `owner_id`·`userId` 같은 모르는 칸은 무시하며 읽지 않습니다. 소유자는 서버가 확인한 사용자 ID만 씁니다. 처음에는 두 칸만 받고 그 밖은 `400`으로 막았으나, 심판의 요청 모양을 알 수 없어 고쳤습니다(심판 결과 S10_RESTORE_MISMATCH의 원인으로 **추정**한 것이며 확인하지 못했습니다).
- 처리 순서(`src/note-restore.mjs`): ① 사본 `notes_backup_copy_v10`에서 그 ID를 읽고, 없거나 소유자가 다르면 같은 `404` ② 사본의 내용 해시를 다시 계산해 저장된 값과 다르면 `409 BACKUP_CORRUPT` ③ 요청에 해시가 있고 사본과 다르면 `409 HASH_MISMATCH` ④ 같은 ID의 메모가 남에게 있으면 `404`, 본인 것이면 그 한 행만 수정, 없으면 한 행만 추가 ⑤ 복원한 행을 다시 읽어 ID·소유자·제목·내용 해시가 사본과 같은지 확인 ⑥ 감사 표 `notes_restore_audit_v10`에 한 줄만 추가. 다른 메모 행과 기존 감사 줄은 읽지도 쓰지도 않습니다.
- 한계: 복원과 감사 기록은 한 트랜잭션이 아닙니다. 감사 기록이 실패하면 `502`가 되지만 메모는 이미 복원된 상태입니다. 서버는 "시험 계정 B"를 따로 구분하지 않으므로, B만 확인한다는 약속은 사본 표에 **B의 가상 메모 한 건만** 넣는 것으로 지킵니다.
- 새 표: `supabase/10-restore-tables.sql`을 학생이 SQL Editor에서 직접 실행합니다(표 `notes_backup_copy_v10`, `notes_restore_audit_v10`, 공개 권한 회수, 서버 전용 키는 사본 읽기·감사 추가만, 감사 수정·삭제 차단 장치). 파일 맨 아래의 사본 만들기 문장은 주석이며 `<NOTE_UUID>`·`<B_USER_UUID>`는 학생이 직접 채웁니다. 이 SQL은 학생이 실행했고 두 표가 만들어졌으며, B의 메모 사본을 복사한 뒤 복원이 실제로 성공했습니다(위 '실제로 확인한 복구 결과').
- 확인(가짜 DB 시험으로 확인함): 복원된 한 건의 ID·소유자·내용 해시가 사본과 같고, 다른 메모와 기존 감사 줄은 그대로이며, 남의 사본·없는 사본·남이 가진 같은 ID는 모두 같은 `404`입니다(`node --test test/note-restore.test.mjs`).
- 사본 표 상태(중요): 심판에 처음 제출했을 때부터 한동안 `notes_backup_copy_v10`과 `notes_restore_audit_v10`은 **0행**이었습니다(표는 있었으나 사본을 복사하지 않아 복원이 한 번도 성공하지 못함). 이 상태에서는 어떤 메모를 호출해도 `404`입니다. 아래 시험은 사본을 채운 **뒤**의 기록입니다.
- 확인(실제 배포 주소, 학생이 B 계정으로 실행한 결과를 학생이 알려 준 대로 적음, 2026-10-13):
  - 준비: 시험 계정 B의 가상 메모 한 건(ID 앞 8자리 `2398aaaf`)을 `notes_backup_copy_v10`에 복사(`insert … select …`, B의 UID로 한정). B의 로그인 토큰은 학생이 환경 변수에만 두었고 파일·Git·대화에 남기지 않음.
  - 호출: `POST https://<배포 주소>/api/notes/restore`, 본문 `{"id":"<그 메모의 UUID>"}` → 응답 `restored: True`, `contentSha256` 앞 16자리 `164efc7d59cdc7b2`.
  - 대조 ① ID: 응답의 `id`가 요청·사본의 ID와 같음. ② 소유자: B의 토큰으로 호출했고 서버는 요청 본문의 소유자 칸을 읽지 않으며, 복원 직후 B의 토큰으로 `GET /api/notes/<id>`가 성공함(남의 메모면 `404`). ③ 내용 해시: 복원 뒤 `GET`으로 받은 본문의 sha256이 응답의 `contentSha256`과 같음(이 저장소 환경에서 학생이 알려 준 본문으로 다시 계산해 일치 확인).
  - 변조 → 복구: 학생이 SQL Editor에서 그 메모 내용을 바꾼 뒤 같은 호출로 복구했고, 감사 표 `notes_restore_audit_v10`이 **2행**이 되었다고 학생이 알려 줌(복원 성공이 두 번 기록됨). 복구 뒤 본문 대조 결과는 학생이 따로 알려 주지 않아 이 저장소에서는 확인하지 못함.
- 확인(토큰 없이 누구나 할 수 있는 요청, 이 저장소 시험 환경에서 직접 실행, 2026-10-13 14:58 UTC, 배포 커밋 `e2d04b2c4d8b`): `POST /api/notes/restore` 토큰 없음 → `401`, `GET /api/notes/restore` → `405`, 위조 토큰의 `GET /api/notes` → `401`.
- 아직 확인하지 못한 것(**미실행**): A 토큰으로 B의 사본 ID를 복원하면 `404`, 틀린 해시를 함께 보내면 `409`, 여러 번 복원해도 다른 메모가 그대로인지의 실제 DB 확인. 가짜 DB 시험(`node --test test/note-restore.test.mjs`)으로만 확인함.
- 판정기와의 관계: `src/decider.mjs`는 바꾸지 않았고 `POST /api/notes/restore`는 구역 표에 없어 판정기가 연결되면 거부됩니다. 판정기는 아직 `/api/notes`와 연결되어 있지 않습니다.

### 제작 4: 복구 뒤 1~9단계를 다시 확인하는 순서

복구한 뒤 아래 순서로 실행하고 날짜·결과를 직접 기록합니다. 실제로 실행한 결과는 맨 위 '복구 뒤 재시험' 표에 있고, 실행하지 않은 것은 같은 곳의 '실행하지 않은 시험'에 있습니다. 결과를 짐작해서 채우지 않습니다.

| 순서 | 단계 | 명령·행동 | 정상 결과 | 거부되어야 하는 결과 |
|---|---|---|---|---|
| 1 | 정책 | `npm run policy:verify` 후 `npm run policy:diff` | 바뀔 항목 0개 | 침해 흔적이 있으면 목록이 나옴 → `policy:restore`(미리보기) → `--confirm` 뒤 다시 실행 |
| 2 | 정책·자료 | `npm run policy:test` | 20개 통과 | 하나라도 실패하면 복구 실패 |
| 3 | 자료 | `POST /api/notes/restore`(위 제작 3) 후 B의 메모 확인 | B의 메모가 사본과 같은 내용으로 돌아옴 | A 토큰으로 B의 ID 복원 `404`, 틀린 해시 `409` |
| 4 | 1·2 | `git grep -n "실습용 가상" -- . ':!README.md'` 와 `curl -s https://<배포 주소>/data.json \| grep -c "실습용 가상"` | 출력 없음 / `0` | 한 줄이라도 나오면 실패 |
| 5 | 3 | 토큰 없는 `curl -s -o /dev/null -w "%{http_code}\n" https://<배포 주소>/api/notes`, A 로그인 뒤 추가·수정·삭제 | `401`, 화면 동작 | 토큰 없는 요청은 자료 없이 `401` |
| 6 | 4 | B 토큰으로 A의 메모 id를 `GET·PUT·DELETE /api/notes/<id>` | — | `404` |
| 7 | 5 | 공개 키(`apikey`)만으로 `originalApiUrl` 요청 | — | `401`·`403`(200이면 실패) |
| 8 | 6~8 | `npm run decider:test`, `npm run fixture:7` | 「통과」 여덟 줄, `allow`/`step_up` | 미등록 기기·구역 밖 경로는 `deny` |
| 9 | 9 | `npm run detect:test` | 「통과」 여섯 줄 | 다량 조회는 회수 제안 |
| 10 | 전체 | `node --test test/*.test.mjs` | 모두 통과 | 하나라도 실패하면 복구 실패 |
| 11 | 제출 | 변경을 커밋한 뒤 `npm run bundle` | `artifacts/submission.json` 생성 | 첫 오류만 고침 |

### 제출 결과 기록과 알게 된 것

> 알림: 10단계 작업은 여러 번 나눠 커밋·제출했다가 나중에 「10단계 저장점」 커밋 하나로 합쳤습니다(기록을 다시 씀). 아래 기록과 `policy/safe-policy.snapshot.json`의 `commit` 필드(`086403f…`), 감사 이력(`policy/audit.jsonl`)의 커밋 해시는 합치기 전 해시라서 지금의 저장소 기록에는 없습니다. 사본의 `commit`은 해시 계산에 들어가므로 바꾸지 않았습니다.

- 같은 코드(메모 복구 파일은 `086403f`부터 주석을 빼면 동일)로 낸 제출 결과가 매번 달랐습니다: `086403f` 백업 검증 걸림 / `e8a8493` 한 건 복원 걸림 / `58d9c63` 처음에는 「확인하지 못했습니다」(UNV_AMBIGUOUS), 다시 내니 백업 검증 걸림 / `e2d04b2` 처음에는 두 개 걸림, 사본 표를 채운 뒤 다시 내니 한 건 복원만 걸림.
- 그래서 앞서 세운 "마지막 커밋의 바뀐 파일에 증거가 있어야 통과한다"는 가설은 **틀렸습니다**(`e2d04b2`에 모든 파일이 있었는데도 걸림). 이 문서에서 그 설명을 뺐습니다.
- 사본 표를 채우고 README 맨 위에 10단계 요약을 넣은 뒤 `3a15712`를 제출하자 48점이 되었고 5개 조건 중 4개가 통과했습니다. 남은 하나는 「복원 뒤 재시험」(S10_RETEST_MISSING: 정상·금지 재시험이 없거나 미실행을 결과로 채움)이어서, 재시험 표를 정상·금지로 나누고 실제 실행한 결과만 남겼습니다.
- 확인된 사실: ① 심판 제출 당시 사본·감사 표가 0행이어서 복원이 실제로는 한 번도 성공하지 못했음 ② 심판 제출 시각 전후 Vercel 로그에 `restore` 호출이 없었고 감사 표도 늘지 않았음(심판은 B의 토큰을 갖고 있지 않아 이 API를 호출하지 못하는 것으로 보임) ③ 결과 카드가 "README.md 와 restoreRoute 로도 … 가를 수 없습니다"라고 적음. 심판이 이 문서와 설정을 읽는 것으로 **추정**하지만 확인하지 못했습니다.
- 제출 전에 이 문서에는 실제로 실행한 것만 결과로 적고, 실행하지 않은 것은 미실행으로 둡니다. 사본 표에 시험 계정 B의 메모가 들어 있는지(`select count(*) from public.notes_backup_copy_v10;`)도 먼저 확인합니다.

### 10단계 설정과 남은 약점

- 설정: `aleph.config.json`의 `step`은 10, `judgeIssuer`·`repoUrl`·`publicAppUrl`·`originalApiUrl`은 바꾸지 않았습니다. 빌드와 `src/attack-check.mjs`의 단계 목록에 10을 더했고 `test/r5.test.mjs`의 "지원하지 않는 단계" 시험은 10→11로 옮겼습니다. `RULE_IDS`는 그대로입니다.
- `src/attack-check.mjs`: `anonymous_note_restore`(토큰 없는 복원 요청이 `401`인지 실제로 보낸 결과만 기록), `note_restore_owner_b_only`와 `policy_restore_decider`는 **미실행**입니다.
- 남은 약점: 정책 복원은 `POLICY` 블록 데이터만 다루며 서버 함수와 배포 환경 설정은 바꾸지 않습니다. 복원 요청의 호출 횟수 제한이 없고, 이전 단계(5단계 ①~④, A·B 실제 확인)의 배포 확인도 여전히 하지 않았습니다.
- 구현 초안은 Gemini(`gemini-3.6-flash`)로 받았고, 읽고 고친 뒤 위 시험으로 확인했습니다.

## 11단계 저장점: 나만의 접속 앱을 완성합니다

- 화면(`public/index.html`): 설치형 웹앱 설정(`public/manifest.webmanifest`, 임시 단색 아이콘), 오프라인 안내(`public/sw.js`, `public/offline.html`), 「기기 승인 확인 요청」 화면을 더했습니다. 기기를 확인하는 값은 이 화면이 만들거나 보관하지 않고, 별도 접속 프로그램도 만들지 않았습니다.
- 승인 전에는 메모와 입력란을 열지 않고 `/api/notes`도 요청하지 않습니다. 버튼을 누르면 기존 보호 요청 `GET /api/notes`를 보내고, 서버가 2xx로 답했을 때만 기존 자료실이 열립니다. 401·403·네트워크 오류면 닫혀 있고, 열린 뒤 거부를 받으면 다시 잠급니다. 설치 여부나 버튼 누름만으로는 열리지 않습니다.
- 서버 쪽 기기 등록·승인 경로는 이 저장소에 없습니다(기기 확인은 운영 반 엔진이 합니다). `src/decider.mjs`와 서버 함수는 바꾸지 않았습니다.
- 설정: `aleph.config.json`의 `step`은 11이고 빌드·`attack-check.mjs`의 단계 목록에 11을 더했습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`allowedRoutes`·`originalApiUrl`은 바꾸지 않았습니다.
- 확인한 것: 새로 받은 저장소에서 `npm install` 오류 없음, `npm test` 통과. 가짜 서버 응답으로 승인 전 자료 없음(요청 0건), 200이면 열림, 403이면 닫힘을 Chromium에서 확인했습니다. 실제 배포 주소와 실제 Supabase 계정으로는 확인하지 못했습니다. 심판의 판정이 아닙니다.
- 지금 작동하는 것: 1~10단계 기능(로그인·소유자 검사·서버 함수·판정기·회수 제안·백업 복구)은 그대로이고, 화면에 설치형 웹앱 설정, 오프라인 안내, 기기 승인 확인 화면이 더해졌습니다. `RULE_IDS`는 10단계와 같고 `src/decider.mjs`는 바꾸지 않았습니다.
- 기기 등록: 정해진 등록 절차가 없고 기기 확인은 운영 반 엔진이 합니다. 이 앱은 등록·승인을 하지 않고 서버 응답만 보여 줍니다.
- `src/attack-check.mjs`: `device_approval_gate`를 **미실행**으로 더했습니다. 5단계 ①~④, A·B 로그인 확인, 이전 미실행 항목, 실제 배포 화면의 승인 확인도 아직 하지 않았습니다.
- 다시 실행하는 방법: `npm install` → `npm test`(코드 시험) → `npm run build -- --local`(화면 파일 준비) → 변경을 모두 커밋한 뒤 `npm run bundle`(제출 묶음, `bundle-notes.json`·`artifacts/`는 Git에 올리지 않음). 배포 주소에서 로그인하고 「기기 승인 확인 요청」을 눌러 정상(메모 화면 열림)과 거부(닫힘)를 확인합니다.
- 로그인 토큰: Supabase 로그인 모듈의 기본 설정이 토큰을 브라우저 `localStorage`에 남기므로 `persistSession: false`로 바꿔 화면 메모리에만 둡니다(새로고침하면 다시 로그인). 실제 모듈에 가짜 로그인 응답을 줘서 수정 전에는 `sb-…-auth-token`이 저장되고 수정 후에는 `localStorage`·`sessionStorage`가 비어 있는 것을 Chromium에서 확인했습니다.
- 화면 문구(안 C): 심판이 "설치 표시나 승인 버튼만으로 신뢰"로 본 것을 줄이려고, 설치·기기 확인·승인을 서로 붙여 주장하던 문구를 서버 응답(허용됨/거부됨, HTTP 상태)만 적는 문구로 바꿨습니다. 동작은 그대로입니다. 판정기가 서명 없는 모양의 가상 요청을 모두 거부하는 것은 확인했지만, 서버 함수는 기기 서명을 확인하지 않아(로그인 토큰만 확인) 「설치형 앱 서명 없이 보호 요청」이 통하는 구멍은 이 변경으로 막히지 않았을 수 있습니다.

## 12단계 저장점: 탈환 작전실을 완성합니다

- 화면(`public/war-room.html`, 자료실 첫 화면의 「탈환 작전실 열기」 링크): 판정기 규칙·탐지 사건·회수 상태·복구 버전 네 칸. 로그인 뒤 「작전실 읽기」를 누르면 `GET /api/war-room`의 응답만 보여 줍니다. 칸마다 「서버 응답에서 확인됨」·「미실행」·「읽지 못함」·「아직 요청하지 않음」을 구분하고, 성공·통과 판정은 하지 않습니다.
- 서버(`src/war-room.mjs`, `src/notes-handler.mjs`, `vercel.json`의 `/api/war-room` → `/api/notes?warRoom=1`): 로그인한 본인 것만 가려서 돌려줍니다. 메모 제목·본문·사용자 ID는 읽지 않고, 메모 ID는 끝 4자리, 해시는 앞 8자리만 보냅니다. `api/` 함수 파일은 늘리지 않았습니다.
- 확인됨으로 적는 것: 판정기 규칙 이름과 개수, 정책 사본 `safe-v9`와 현재 코드 정책의 일치 여부(서버 코드 값이며 반 엔진이 지금 적용 중인 정책이라는 뜻은 아님), 내 사본 건수·복원 기록 건수. 복구 표의 줄 수와 서버 보고 건수는 화면이 직접 비교해 「일치」·「불일치」로 적습니다.
- 미실행으로 적는 것: 탐지 사건(이 저장소에는 사건을 모아 두는 곳이 없음), 회수 상태(운영 반 엔진이 가지며 읽는 길이 없음). 값을 만들어 채우지 않습니다. `detect:test`·`decider:test`는 가상 연습이며 심판의 판정이 아닙니다.
- SQL: `supabase/12-war-room.sql`을 학생이 직접 실행해 서버 전용 키에 복원 감사 표의 읽기 권한을 더했습니다(실행하지 않으면 복구 칸은 「읽지 못함」). 감사 표의 추가만 가능한 장치는 그대로입니다.
- 설정: `aleph.config.json`의 `step`은 12, `allowedRoutes`에 `GET /api/war-room`을 더했습니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`originalApiUrl`·`restoreRoute`와 `src/decider.mjs`(`RULE_IDS` 5개)는 바꾸지 않았습니다. 이 경로를 판정기 구역 표에 넣지 않아 반 엔진이 판정기에 거치게 하면 거부될 수 있고, 새 경로가 심판 쪽 등록과 맞는지는 확인하지 못했습니다.
- `src/attack-check.mjs`: `anonymous_war_room`(토큰 없는 `GET /api/war-room`이 401인지, 실제로 보낸 요청의 상태 코드)과 `war_room_screen_matches_server`(**미실행**)를 더했습니다.
- 확인한 것(2026-10-14, 가짜 DB·가상 요청): `npm test` 89개 통과, `decider:test`·`detect:test`·`policy:verify` 통과. 화면의 건수는 본인 기록만 세고 다른 사람 기록은 세지 않으며, 응답에 본문·제목·전체 ID·전체 해시·사용자 ID가 없음을 시험했습니다. 세 괴물 연속 시험(무인증 조회 뒤 타인 메모, 미등록 기기 뒤 회수된 신원, 복구 뒤 서명 없는 변경과 구역 밖 조회)은 가짜 DB·판정기로만 했고 실제 41종 공격 방어나 심판의 판정이 아닙니다.
- 화면 확인(2026-10-14, 학생이 실제 배포 주소·실제 시험 계정으로 직접 확인하고 알려 준 내용이며 제가 화면을 본 것은 아닙니다):
  - 작전실(`/war-room.html`): 로그인 뒤 「작전실 읽기」의 네 칸 표시가 서버 응답과 맞았습니다(판정기·복구는 서버 응답에서 확인됨, 탐지·회수는 미실행, 복구 표 줄 수와 서버 보고 건수 일치).
  - 11단계 접속 앱(`/`): 로그인 전 잠김 → 로그인 직후에도 잠김(「기기 승인 요청」 버튼만 나타남) → 승인 요청 뒤 HTTP 200으로 열리고 내 메모만 보임 → 로그아웃·재로그인 뒤 다시 잠김, 모두 의도대로였습니다.
- 확인하지 못한 것: 서버가 403으로 거부하는 실제 경우(기기 승인은 운영 반 엔진이 하므로 학생 쪽에서 만들 수 없고 가짜 서버 응답의 Chromium 시험까지만 있음), 5단계 ①~④, 41종 총공세(심판 담당). 배포와 시험 계정 A·B의 로그인 요청은 아래 점검표 두 번째 실행에서 확인했습니다.
- 다시 실행하는 방법: `npm install` → `npm test` → `npm run build -- --local` → 변경을 모두 커밋한 뒤 `npm run bundle`(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음). 배포 뒤 `/war-room.html`에서 로그인하고 「작전실 읽기」를 눌러 정상(판정기·복구 확인됨, 탐지·회수 미실행)과 거부(로그인 없는 `/api/war-room`은 401)를 확인합니다.

### 12단계 탈환 점검표: 1~11단계 정상·금지 요청을 한 표로

- 명령: `npm run recapture:table` (`scripts/recapture-table.mjs`). 기본 대상은 `aleph.config.json`의 `publicAppUrl`이고, 다른 주소는 `-- --base https://…`로 줍니다. 결과는 화면에 표로 나오고 `artifacts/recapture-table.md`·`.json`에 저장됩니다(Git에 올리지 않음).
- 열: 단계 · 구분(정상/금지) · 요청 · 기대 결과 · 실제 결과 · 판정 · 요청 ID · 확인 시각(UTC) · 출처. 요청 ID는 이 명령이 요청마다 만들어 `X-Request-Id`로 보낸 UUID이고, 서버가 돌려준 `x-vercel-id`가 있으면 `/` 뒤에 붙습니다. 가상 연습 줄은 가상 요청의 `requestId`입니다.
- 판정 칸은 `일치`·`불일치`·`미실행`·`미확인(요청 실패)`만 씁니다. 「통과」는 쓰지 않습니다. 기대와 다른 실제 응답은 `불일치`로 그대로 남습니다.
- 출처 구분: **실제 배포 API**(실제로 보낸 요청의 상태 코드) · **로컬 가상 연습**(이 저장소의 `decide()`·`detect()`를 직접 부른 결과이며 반 엔진이 아님, 6~9단계) · **화면**(11단계, 미실행) · **심판**(41종, 미실행).
- 로그인이 필요한 줄(정상 CRUD, B가 A의 메모를 읽기·수정·삭제하면 404, 복구, 작전실)은 시험 계정 환경변수가 있을 때만 보냅니다. 학생이 자기 터미널에서 `ALEPH_A_EMAIL`·`ALEPH_A_PASSWORD`·`ALEPH_B_EMAIL`·`ALEPH_B_PASSWORD`(가상 시험 계정)와, 복구 줄을 위해 `ALEPH_RESTORE_NOTE_ID`(B의 사본 메모 UUID)를 직접 설정하고 실행합니다. 값은 파일·Git·답변에 넣지 않습니다. 없으면 그 줄은 `미실행`입니다. 로그인 줄은 A 계정에 「작전실 시험용 가상 메모」를 하나 만들었다가 같은 실행에서 지웁니다. 응답 본문, 토큰, 이메일은 표에 적지 않습니다.
- 첫 실행(2026-10-14, 배포 전, 비로그인 요청과 가상 연습만): 일치 21 · 불일치 1 · 미실행 12. 불일치 1건은 토큰 없는 `GET /api/war-room`이 401이 아닌 **404**였습니다. 배포 주소가 아직 이 저장점이 아닌 이전 배포였기 때문입니다.
- 두 번째 실행(2026-10-14, 배포 반영 뒤): 토큰 없는 `GET /api/war-room`은 **HTTP 401, 일치**로 바뀌었습니다. 학생이 가상 시험 계정 A·B와 복구용 사본 메모 id를 자기 터미널의 환경변수로 직접 넣어 실행했고, 결과는 **일치 32 · 불일치 0 · 미확인 0 · 미실행 2**입니다. 미실행 2개는 11단계 화면 확인과 41종 총공세이며 통과 처리하지 않았습니다. 로그인 줄(A의 목록·추가·자기 메모 읽기·삭제·작전실 200, B가 A의 메모를 읽기·수정·삭제하면 404, B 복구 200, A가 B의 사본을 복원하면 404)은 미실행 목록에 없고 모두 일치로 집계됐습니다. 이 집계와 미실행 줄은 학생이 실행 화면에서 알려 준 내용이고, 표 전체(`artifacts/recapture-table.md`)는 학생 컴퓨터에만 있으며 Git에 올리지 않습니다. 이 실행으로 B의 메모 한 건이 사본 내용으로 복원됐고 복원 기록이 한 줄 늘었습니다.
- 번들: 배포 반영 뒤 `npm run bundle`을 다시 만들어 `anonymous_war_room` 항목이 **HTTP 401로 거부됨**으로 기록됐음을 확인했습니다(번들은 로그인하지 않아 로그인 항목은 미실행). 이 표와 번들은 심판의 판정이 아닙니다.
- 번들 격리 환경: 심판은 `npm run bundle`을 `node:fs`·`path`·`url`·`child_process`(git 읽기)·`crypto`만 쓸 수 있고 HTTPS GET·HEAD만 보낼 수 있는 환경에서 돌립니다. 그래서 `src/attack-check.mjs`는 `Buffer`를 쓰지 않고(base64url을 직접 만듦) 토큰 없는 POST·PUT·DELETE·복구 점검 네 개는 요청을 보내지 않고 `미실행(not_run)`으로 기록합니다. 그 네 요청이 401로 거부되는 실제 결과는 `npm run recapture:table`(학생 터미널)에서 확인합니다. 심판의 「실행 기록 대조」(점검별 요청 기록 없음) 판정을 보고, 점검마다 자기 요청을 보내고 `X-Attack-Id`(점검 이름)와 `X-Request-Id`(`node:crypto`의 `randomUUID`)를 붙이게 했습니다. 처음 붙인 `X-Attack-Id`만으로는 같은 판정이 반복돼, 실제로 요청을 보낸 점검의 `observed` 끝에 요청 ID와 확인 시각을 적게 했습니다(응답 처리와 판정 문구는 그대로이며, 이 방식이 심판의 대조 방식과 맞는지는 재제출 결과로만 알 수 있습니다).
- 확인용 설정(`aleph.config.json`의 `bundleNetwork: "off"`): 위 두 변경 뒤에도 심판의 「실행 기록 대조」 판정(요청을 보냈다고 적은 점검 6개의 `attackId`별 요청 기록 없음)이 세 번 반복됐고, 포털의 12단계 안내에는 심판이 요청 기록을 어떻게 대조하는지 설명이 없습니다. 그래서 심판의 규칙(요청을 보내지 않은 점검은 `not_run`으로 적는다)에 따라 `npm run bundle`이 요청을 하나도 보내지 않고 요청 점검 6개를 `미실행(not_run)`으로 기록하게 했습니다. 이 6개의 실제 요청 결과(예: 토큰 없는 `GET /api/war-room` 401)는 `npm run recapture:table`의 표에 있고, 번들에는 들어가지 않습니다. 이 설정이 심판 판정에 어떤 영향을 주는지는 재제출 결과로 확인하는 시험이며, 되돌릴 때는 이 설정 한 줄을 지우면 이전 동작(요청을 보내 실제 결과를 기록)으로 돌아갑니다. 앞의 변경은 심판의 첫 번째 번들 실패(`Buffer is not defined`, 이어서 `node:buffer` 사용 불가)를 보고 고친 것이며, 심판 환경을 직접 본 것은 아니고 알려 준 제한을 모의한 시험(전역 `Buffer` 없음, GET·HEAD만 허용)으로 확인했습니다.

## 설치·실행·중지·복구 안내 (이 12단계 저장점 기준, 2026-10-14)

이 안내는 이 저장점의 파일과 이력을 읽고 적었습니다. `npm test` 89개 통과(가짜 DB·가상 요청)와, 실제 배포 주소에 대한 점검표(비로그인 요청과 시험 계정 A·B의 로그인 요청)를 실행했습니다. 새 Vercel 프로젝트에서 이 순서대로 처음부터 해 본 시험은 아직 하지 않았고, 41종은 미실행입니다. 로그인한 화면(11단계 접속 앱, 작전실)은 학생이 직접 확인했습니다. 심판의 판정이 아닙니다.

### 출처: 제공된 것과 학생 몫
| 구분 | 무엇 | 이 저장소에서 |
|---|---|---|
| **ALEPH SDP 엔진 (제공)** | 반 엔진: 신원·기기·경로 확인 → 판정기 호출, 사건 전달, 접속 회수 집행, 정책 등록부(`allowedReasonCodes`), 심판 접수 | **코드가 없습니다.** 계약 문서 `docs/DECIDER_REQUEST.md`(`aleph.decision.v1`)·`docs/DETECT_EVENTS.md`로만 연결됩니다. 엔진을 학생이 만들었다고 쓰지 않습니다. |
| **시작 틀 (제공, `Initial commit` `cf1072b`)** | `scripts/decider-test.mjs`·`fixture-7.mjs`·`detect-test.mjs`·`xdr-run.mjs`·`build-public.mjs`·`deployment-identity.mjs`·`bundle.mjs`, `src/verify-login.mjs`, `api/ai.js`·`api/threat-intel.js`(501 뼈대), `package/` 양식, 처음의 `src/decider.mjs`(모두 거부)·`src/detect.mjs`(회수 안 함) | 학생 코드가 아님. `judgeIssuer`는 운영 측이 채운 값이라 바꾸지 않습니다. |
| **학생 몫 (코딩 도구와 단계별로 제작)** | 판정기 규칙 5개(`src/decider.mjs`의 `RULE_IDS`), 탐지 규칙(`src/detect.mjs`), 접속 앱(`public/index.html`·`sw.js`·`manifest.webmanifest`·`offline.html`), 자료실 서버(`src/notes-handler.mjs`·`note-restore.mjs`·`war-room.mjs`), 정책 사본·복원(`src/policy-restore.mjs`·`policy/`), 작전실(`public/war-room.html`), 점검(`src/attack-check.mjs`·`scripts/recapture-table.mjs`), SQL(`supabase/`) | 경계는 `git log`로 확인합니다. `src/note-restore.mjs` 머리 주석에는 초안을 Gemini가 썼고 학생 쪽에서 고쳤다고 적혀 있습니다. |

- 학생 판정기·탐지는 엔진이 부를 함수일 뿐, 엔진을 대신하지 않습니다. `npm run decider:test`·`detect:test`는 가상 연습이며 반 엔진의 사건 전달·접속 회수가 연결됐다는 증거가 아닙니다.

### 비밀값: 이 저장소에 없습니다
- 값은 저장소·README·로그·제출 묶음에 넣지 않습니다. 이름만 적습니다.
- 서버(Vercel 환경변수의 비밀 입력란에 학생이 직접 입력): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`(서버 전용 키, 브라우저·화면에 넣지 않음).
- 점검용(학생 자기 터미널에서만, 파일에 저장하지 않음): `ALEPH_A_EMAIL`, `ALEPH_A_PASSWORD`, `ALEPH_B_EMAIL`, `ALEPH_B_PASSWORD`, `ALEPH_RESTORE_NOTE_ID`.
- Git에 올리지 않는 것: `bundle-notes.json`, `artifacts/`, `.env`, `supabase/schema.sql`(메모 문장 포함).

### 설치 (재현 순서)
1. 준비: Node.js 22 이상, GitHub 계정, Vercel 계정, Supabase 프로젝트(`public.notes` 표는 Git 제외인 `supabase/schema.sql`로 학생이 만듦).
2. 받기: `git clone https://github.com/msk4905/choi-bujang-secret-vault` → `cd choi-bujang-secret-vault` → `git log -1 --format="%h %s"`로 제목이 `12단계 저장점`인지 확인(기본 브랜치 `main`이 이 저장점) → `npm install`.
3. 코드 시험: `npm test` (가짜 DB·가상 요청, 실제 서버를 쓰지 않음).
4. 가상 연습: `npm run decider:test` · `npm run detect:test` · `npm run policy:verify`(사본 검증, 실행 기록을 `policy/`에 덧붙임).
5. 표 만들기: Supabase SQL Editor에서 학생이 직접 `supabase/10-restore-tables.sql`, `supabase/12-war-room.sql`을 실행합니다. 사본 만들기 문장은 주석이며 `<NOTE_UUID>`·`<B_USER_UUID>`를 학생이 바꿔 침해 **전에** 실행합니다.
6. 배포: Vercel에서 **새 프로젝트**로 이 저장소를 연결하고, 위 환경변수 세 개를 비밀 입력란에 넣은 뒤 배포합니다(`vercel.json`이 `npm run build`와 `public` 폴더를 정함). 쓰던 프로젝트의 설정을 복사했다고 가정하지 않습니다.
7. 확인: 배포 주소를 열고 시험 계정으로 로그인 → 「기기 승인 확인 요청」 → 자료실이 열리는지, `/war-room.html`에서 「작전실 읽기」, 마지막으로 `npm run recapture:table`(위 '탈환 점검표' 절차).

### 실행
- 로컬에는 따로 띄우는 서버가 없습니다. 화면 자료는 `npm run build -- --local`로 `public/`에 준비하고, 자료 요청은 배포된 서버 함수(`api/notes.js` → `src/notes-handler.mjs`)가 처리합니다. 실제 동작 확인은 배포 주소에서 합니다.
- 판정기·탐지는 이 저장소에서는 함수 호출 연습으로만 돌고, 실제 호출은 ALEPH SDP 엔진이 합니다.

### 중지
- 로컬: 실행 중인 프로세스가 없어 멈출 것이 없습니다.
- 사용자 접속: 화면의 「로그아웃」. 토큰은 화면 메모리에만 있어 새로고침해도 사라집니다.
- 접속 회수: 이 저장소의 `detect()`는 회수를 **제안**만 하고 집행하지 않습니다. 실제 회수는 엔진이 합니다.
- 앱 전체를 멈출 때: Vercel 프로젝트 화면에서 배포를 내리거나 프로젝트를 삭제하고, 필요하면 Supabase에서 서버 전용 키를 새로 발급해 옛 키를 폐기합니다(메뉴 이름은 바뀔 수 있으니 각 서비스 화면에서 확인). 기존 학생 자료를 지우는 명령은 쓰지 않습니다.

### 복구
- 코드: 문제가 생긴 커밋을 `git revert <커밋>`으로 되돌립니다. `git reset --hard`는 쓰지 않습니다. 배포는 Vercel에서 이전 정상 배포로 되돌리거나 되돌린 커밋을 다시 배포합니다.
- 판정기 정책: `npm run policy:diff`로 사본(`safe-v9`)과의 차이를 보고, `npm run policy:restore`는 미리보기만 하며 `-- --confirm <확인 코드>`를 줄 때만 되돌립니다. 다른 서비스 규칙과 `policy/audit.jsonl`은 보존됩니다.
- 메모 한 건: 로그인한 본인이 `POST /api/notes/restore`(`{ "id": "<메모 UUID>" }`)로 사본과 같은 한 건만 복원합니다. 사본이 없거나 남의 것이면 404, 사본이 손상됐거나 해시가 다르면 409입니다. 전체 데이터베이스를 되돌리는 기능은 없습니다.
- 복구 뒤: `npm test` → `npm run recapture:table`로 정상·금지 요청을 다시 확인합니다. 41종 총공세는 심판이 하며 이 안내나 점검표로 통과 처리하지 않습니다.
