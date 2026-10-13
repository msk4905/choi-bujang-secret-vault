# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 10단계 요약: 복구 경로와 재시험 (먼저 읽는 곳)

- 복구 경로: `POST /api/notes/:id/restore` (`aleph.config.json`의 `restoreRoute`이고, 배포된 `/aleph.json`에도 `restoreRoute`와 `allowedRoutes`로 실립니다). 로그인한 사용자의 토큰이 필요하고, 본문 없이 한 번 보내면 복구합니다.
- 사본 일치 대조: 메모를 만들 때 서버가 제목·내용·내용 해시를 검증용 사본으로 남깁니다(사본이 없던 옛 메모는 처음 수정하거나 지우기 직전 상태를 남기며, 사본이 이미 있으면 덮어쓰지 않으므로 변조가 사본을 바꿀 수 없습니다). 복구 때 사본을 다시 읽어 사본 행 위치(메모 ID·소유자), 사본 기록 안의 ID·소유자, 내용 해시를 모두 대조하고, 어긋나거나 사본이 없으면 쓰지 않고 멈춥니다(`404`·`409`). 쓴 뒤에는 사본과 되살린 행을 다시 읽어 같은지 확인하고 다르면 되돌립니다(`502`).
- 실행 전 확인: 본문 `{"dryRun": true}`를 보내면 복원할 버전과 바뀔 항목만 돌려주고 아무것도 쓰지 않습니다. 본문에 ID·소유자·제목·내용·내용 해시를 담아 보내면 이를 **주장으로만 보고 검증된 사본과 대조**하며, 하나라도 다르면 복원하지 않고 `409`로 멈춥니다.
- 보존: 다른 메모와 사본, `xdr/alerts.log`는 지우거나 고치지 않습니다. 운영 정책에는 접근하지 않습니다. 시험 정책 사본(`xdr/deny-rules.json`)은 `npm run policy:diff`(차이만 보기)와 `npm run policy:restore`(미리보기와 확인 코드를 거친 되돌리기)로 다룹니다.
- 복구 뒤 1~9단계 재시험: 순서와 칸별 결과는 아래 '복구 뒤 1~9단계 정상·금지 요청을 다시 실행하는 순서' 절에 있습니다. **2026-10-13 05:48 UTC에 배포 주소(당시 배포 커밋 `b21bf10`)로 실제로 보낸 것**: `/` HTTP 200, `/data.json`에 가상 메모 없음, `/aleph.json`에 시작 틀 확인 표시 없음, 토큰 없는 `GET·POST·PUT·DELETE /api/notes`는 `401`, 위조 토큰 `GET /api/notes`는 `401`, 토큰 없는 `POST /api/notes/:id/restore`는 `401`, 공개 키만으로 원본 자료 주소를 직접 요청하면 `401`. 로컬(가짜 DB·가상 요청, 심판 판정 아님): `node --test test/*.test.mjs` 96건 중 96건 통과, `decider:test` 여덟 줄 통과, `fixture:7` 정상 `allow`·복합 이상 `step_up`, `detect:test` 여섯 줄 통과.
- **미실행(결과를 꾸미지 않음)**: 배포에서 A·B 로그인으로 하는 확인(4·8단계 교차 접근, 3단계 정상 메모 추가·수정·삭제, 복구 정상 호출과 거부), 5단계 ①~③, 6·7·9단계의 심판·엔진 몫(미등록 기기 공격, 재로그인 뒤 허용, 사건 전달과 접속 회수), 실제 DB에서 사본 저장이 되는지.
- 한계: 사본이 없던 옛 메모는 처음 수정하거나 지우기 **전에** 이미 변조되었다면 되돌릴 사본이 없어 복구할 수 없습니다(`404`). 사본은 처음 한 번만 남으므로 그 뒤 정상 수정한 내용도 복구하면 사본 시점의 내용으로 돌아갑니다. 자세한 설명은 아래 '10단계 작업' 절에 있습니다.

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
- 알아 둘 점: `decide.mjs`는 이름 있는 패턴 밖의 경보도 경보 자신의 T1190 표시와 반복 횟수로 판정합니다(명령 구분자 경보 1건이 block, 반복 없는 애매한 9건이 alert). `203.0.113.10`은 brute-force와 웹 주입 규칙이 둘 다 있습니다. (옛 기록: `brute-force/respond.mjs`가 규칙 이름 접두어를 가리지 않아 다시 실행하면 웹 주입 규칙이 모두 사라졌고, 이는 아래 '10단계 점검에서 고친 이전 단계 결함'에서 고쳤습니다.)

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

## 10단계 작업: 비공개 사본에서 메모 한 건만 복원

- 서비스·경로: 기존 메모 서버 함수 `/api/notes`(새 함수 파일 없음)의 `POST /api/notes/:id/restore`입니다. `vercel.json`이 `/api/notes/:id/restore`를 `/api/notes?id=:id&restore=1`로 넘기고, 이 경로는 POST만 받습니다. `aleph.config.json`의 `allowedRoutes`에 같은 경로를 더했고 `restoreRoute`에도 적었으며, 10단계부터 `scripts/deployment-identity.mjs`가 `restoreRoute`를 `/aleph.json`에도 싣습니다(`restoreRoute`의 적는 형식이 운영 측 양식과 같은지는 확인하지 못했습니다). `step`은 10단계 저장점에서 10으로 올렸습니다.
- 사본은 서버가 자동으로 남깁니다: 로그인한 사용자가 `POST /api/notes`로 메모를 만들면, 서버가 만든 직후 그 메모의 제목·내용·해시를 검증용 사본으로 한 번 남깁니다. 사본은 `notes` 표 안의 예약 행입니다. 행 ID와 `owner_id`를 (메모 ID, 확인된 사용자 ID)에서 계산한 값으로 두며, 이 값은 로그인 검사가 받는 v4 사용자 ID와 같아질 수 없습니다. 그래서 목록·조회·수정·삭제 API로는 보이지도 고쳐지지도 않고 서버 전용 키로만 읽습니다. 별도 표나 SQL 실행은 필요 없습니다. 사본은 만들 때 한 번만 남기며 이후 수정으로 덮어쓰지 않습니다(침해 전에 검증한 사본). 이미 있으면 그대로 둡니다. 사본이 없던 옛 메모(이 기능 이전에 만든 메모)는 **처음 수정하거나 지우기 직전의 상태**를 같은 방식으로 사본으로 남깁니다. 이 저장은 메모 주인임을 확인한 뒤에만 하고, 사본이 이미 있으면 그대로 두며, 실패해도 수정·삭제는 그대로 진행되고 서버 로그에만 남습니다.
- 요청: 로그인한 사용자의 `Authorization: Bearer` 토큰으로 `POST /api/notes/<메모 id>/restore`를 **본문 없이 한 번** 보내면 됩니다. 소유자는 서버가 확인한 로그인 결과만 쓰고, 본문의 값은 믿고 쓰지 않습니다. 선택 본문(모두 생략 가능, 이름 대소문자 무시): `id`(`noteId`)·`ownerId`(`owner_id`·`owner`·`userId`)·`title`·`body`(`content`)·`contentSha256`(`sha256`·`hash`·`contentHash`, `sha256:` 접두어 허용)는 **검증된 사본과 대조**하며 하나라도 다르면 `409`(`HASH_MISMATCH`·`CLAIM_MISMATCH`)로 멈춥니다. 해시는 제목+본문 해시와 본문만의 sha256을 모두 인정합니다. `{"dryRun": true}`는 복원할 버전(`version`), 할 일(`action`: `create`·`update`), 바뀔 항목(`willChange`: `title`·`content`)만 돌려주고 **아무것도 쓰지 않습니다**(실행 전 확인).
- 대조: 사본을 새로 읽어 사본의 행 위치(메모 ID·소유자), 사본 기록 안의 메모 ID·소유자, 사본 내용의 해시가 모두 맞을 때만 진행합니다. 하나라도 어긋나면 쓰지 않고 멈춥니다. 복원 뒤에는 사본과 되살린 행을 다시 새로 읽어 ID·소유자·내용 해시가 같은지 확인하고, 다르면 쓴 내용을 되돌립니다(새로 만든 행은 지우고 고친 행은 이전 제목·내용으로 돌림). 그때 응답은 `502 RESTORE_UNVERIFIED`입니다.
- 결과: 현재 메모가 없으면 새로 만들고(`201`, `restored: "created"`), 같은 ID의 본인 메모가 있으면 사본 내용으로 한 건만 고치며(`200`, `"updated"`), 이미 같으면 쓰지 않습니다(`200`, `"unchanged"`). 응답에는 ID·소유자(`ownerId`, 요청자 본인)·전체 내용 해시(`contentSha256`)·버전·바뀐 항목 이름과 결과만 있고 메모 내용은 싣지 않습니다. 다른 메모와 사본은 고치지 않습니다.
- 거부(아무것도 쓰지 않음): 토큰 없음 `401`, 사본 없음·남의 메모·같은 ID의 현재 메모 주인이 다름 `404 NOT_FOUND`(구별하지 않음), 요청 해시가 다름 `409 HASH_MISMATCH`, 요청의 ID·소유자·제목·내용이 사본과 다름 `409 CLAIM_MISMATCH`, 사본이 변조되어 해시가 안 맞음 `409 BACKUP_HASH_MISMATCH`, 본문·ID 형식 오류 `400`, POST가 아닌 메서드 `405`.
- 응답 시간: 서로 독립인 DB 호출은 동시에 실행합니다(복구는 사본·현재 메모 읽기를 동시에, 쓴 뒤 재확인 읽기도 동시에, 수정·삭제는 직전 상태 사본 저장을 실제 수정·삭제와 동시에). 호출 수와 보안 확인은 그대로입니다. 호출당 0.1초 지연을 준 로컬 시험에서 복구 0.5초→0.3초, 수정 0.3초→0.2초였습니다. 실제 배포에서는 개선 전 복구 2.8~3.1초, 수정 2.9초를 쟀고, 개선 뒤 시간은 아직 재지 않았습니다(`npm run restore:selfcheck`가 호출별 시간을 보여 줍니다).
- 심판 요청 추적 로그: 로그인 검사가 심판(`kind: judge`)으로 구분한 요청에 한해, 신분(`a`/`b`)·메서드·경로 종류(`collection`/`item`/`restore`)·쿼리와 본문의 **키 이름과 값의 종류**(uuid, 64자리 해시, 문자열 길이 구간 등)·응답 상태·상수 오류 이름·걸린 시간을 서버 로그 한 줄(`trace: …`)로 남깁니다. 메모 내용·제목·ID·해시·토큰 같은 **값은 남기지 않으며** 학생 본인의 요청은 기록하지 않습니다. 로그인 실패 요청은 메서드와 경로 종류만 남깁니다. 동작은 바꾸지 않습니다. 확인: Vercel 프로젝트의 Logs에서 `trace:`로 검색합니다(보관 시간이 짧을 수 있음). 코드는 `src/judge-trace.mjs`, 시험은 `test/judge-trace.test.mjs`입니다.
- 감사 기록: 이 저장소와 DB 스키마에는 메모용 감사 표가 없어서 새로 만들지 않았습니다. 복원 성공·미리보기·거부 사유는 서버 로그에 짧은 코드만 남고(`notes restored: updated`, `notes restore denied: no_backup` 등) ID·본문·토큰은 싣지 않습니다. 이 복원은 기존 로그나 다른 메모를 지우거나 고치지 않습니다. 영구 감사 기록이 필요하면 학생이 표를 정해야 합니다.
- 확인 순서(학생이 배포 주소에서, 아직 하지 않음): ① B로 로그인해 새 메모를 만듭니다(이때 사본이 남습니다). ② 그 메모를 수정하거나 지웁니다. ③ B 토큰으로 `POST /api/notes/<id>/restore`에 본문 `{"dryRun":true}`를 보내 `preview: true`와 `willChange`를 보고 메모가 아직 그대로인지 봅니다. ④ 본문 없이 같은 요청을 보내 `201` 또는 `200`을 받고 메모가 처음 내용으로 돌아왔는지 봅니다. 정상: `verified: true`. 거부되어야 할 결과: 해시를 한 글자 바꿔 보내면 `409`, A 토큰이면 `404`이고 메모가 바뀌지 않아야 합니다.
- 코드 시험: `npm ci` 뒤 `node --test test/notes-restore.test.mjs`와 `node --test test/*.test.mjs`입니다(가짜 DB·가짜 로그인 검사기). 시험 계정 B의 가상 메모만 복원 대상으로 썼고, A는 B의 메모를 요청했을 때 거부되는지 보는 요청자로만 나옵니다. 실제 Supabase·배포 확인이 아니며 심판 판정이 아닙니다.
- 한계(확인하지 못한 것 포함): ① 사본이 없던 옛 메모는 처음 수정·삭제하기 전에 이미 변조되었다면 되돌릴 사본이 없어 `404`입니다. ② 사본은 만들 때 한 번이라, 정상 수정한 내용은 복원하면 처음 내용으로 돌아갑니다. ③ 사본이 `notes` 표의 예약 행이라 서버 전용 키(RLS 우회)를 가진 쪽은 읽을 수 있습니다. API로 보이지 않는다는 뜻의 비공개입니다. ④ 실제 DB에서 `notes.owner_id`에 외래키나 다른 제약이 있으면 사본 저장이 실패할 수 있고, 이때 메모 만들기는 성공하지만 그 메모는 복원되지 않습니다(서버 로그에만 남음). 실제 DB로는 확인하지 못했습니다. ⑤ 판정기(`src/decider.mjs`)는 이 경로와 연결되어 있지 않고 `RULE_IDS`는 그대로입니다. `src/attack-check.mjs`는 토큰 없는 복원 요청이 `401`인지만 보내고 A·B 로그인이 필요한 점검은 미실행입니다.

## 복구 뒤 1~9단계 정상·금지 요청을 다시 실행하는 순서

복구(위 `policy:restore`나 메모 복원) 직후에 아래 순서로 다시 확인합니다. 결과 칸은 실제로 실행한 것만 적었고, 실행하지 않은 것은 **미실행**입니다. 로컬 시험은 가짜 DB·가짜 로그인 검사기·가상 요청이라 실제 Supabase·배포·심판의 결과가 아닙니다. `<…>`와 `$TOKEN_B`·`$TOKEN_A`는 학생이 채우며, 토큰은 앱 화면에서 복사해 터미널 변수로만 쓰고 대화·Git·README에 붙이지 않습니다.

### 0. 복구된 것 확인 (자료와 정책이 돌아왔는가)

| 확인 | 명령·행동 | 정상 | 거부·실패면 | 결과 |
|---|---|---|---|---|
| 정책이 검증본과 같음 | `npm run policy:diff` | 「차이 없음」, 종료 코드 0 | 「다시 생김/사라짐/바뀜」이나 「중단」이면 `npm run policy:restore`의 미리보기부터 | 2026-10-13 04:57 UTC 실행: 차이 없음(규칙 16개). 복구 절차 자체는 실제 파일에 적용하지 않음 |
| 메모 한 건이 사본 그대로 돌아옴 | B로 메모를 만든 뒤 수정하고, B 토큰으로 `POST /api/notes/<B 메모 id>/restore`를 본문 없이 한 번 보냄(미리 보려면 `{"dryRun":true}`) | `verified: true`, 이어서 B의 `GET /api/notes`에 처음 내용이 보임 | 해시를 한 글자 바꾸면 `409`, A 토큰이면 `404`이고 메모가 바뀌지 않아야 함 | 코드 시험만 실행(아래 4단계 줄). 실제 배포·DB: **미실행** |

### 1~9단계 다시 실행

각 줄의 「로컬」은 저장소에서, 「배포」는 `aleph.config.json`의 `publicAppUrl`에서 하는 확인입니다. 배포 주소가 `main`을 보고 있으면 이 브랜치의 변경 전 코드일 수 있어, 확인 전에 어떤 커밋이 배포됐는지 먼저 봅니다.

| 단계 | 정상 요청 | 금지 요청 | 로컬 결과 | 배포 결과 |
|---|---|---|---|---|
| 1 공개 틀 | 배포 `/` 화면이 열림(`curl -s -o /dev/null -w "%{http_code}\n" https://<배포 주소>/`) | 1단계의 공개 가상 메모는 2단계부터 의도적으로 없앴으므로, 복구 뒤에도 `/data.json`이 `{ "notes": [] }`이어야 함 | `npm run build -- --local` 실행: 성공, `public/data.json` 변화 없음 | `/` HTTP 200: 2026-10-13 05:48 UTC 실행 |
| 2 코드 밖으로 | `curl -s https://<배포 주소>/data.json` → `{ "notes": [] }` | `git grep -n "실습용 가상" -- . ':!README.md'` 출력 없음, 배포 `/data.json`에 같은 글자 `grep -c` 가 `0` | `git grep` 실행: 출력 없음(종료 코드 1) | `/data.json` 가상 메모 없음·`/aleph.json` 시작 틀 표시 없음: 2026-10-13 05:48 UTC 실행(`attack-check`). `grep -c`: **미실행** |
| 3 로그인 | A로 로그인해 메모 추가·수정·삭제, 로그아웃 뒤 목록이 사라짐 | 토큰 없는 `curl -s -o /dev/null -w "%{http_code}\n" https://<배포 주소>/api/notes` → `401`(POST·PUT·DELETE도 `401`) | `node --test test/notes-api.test.mjs test/r5.test.mjs` 포함 전체 실행: 통과 | 토큰 없는 GET·POST·PUT·DELETE `401`, 위조 토큰 GET `401`: 2026-10-13 05:48 UTC 실행. A 로그인 화면 확인: **미실행** |
| 4 소유자 | 본인 토큰으로 본인 메모 `GET·PUT·DELETE /api/notes/<id>` 성공 | B 토큰(`$TOKEN_B`)으로 A의 메모 id 요청 → `404`, 소유자 변경 시도도 거부 | 전체 시험 통과(가짜 DB의 A·B 시험 포함) | A·B 두 계정 실제 확인: **미실행** |
| 5 서버 함수로만 | 화면이 `/api/config`에서 공개 설정을 받아 로그인하고 자료는 `/api/notes`로만 읽음 | 공개 키(`apikey` 헤더)만으로 `aleph.config.json`의 `originalApiUrl`을 요청 → `401`·`403`(`200`이면 실패) | `node --test test/config-api.test.mjs test/r5.test.mjs` 포함 전체 실행: 통과 | ④ 공개 키로 원본 자료 주소 직접 요청 `401`: 2026-10-13 05:48 UTC 실행(`attack-check`). ①~③: **미실행** |
| 6 등록 기기 | `npm run decider:test` 첫 줄 「통과 · 등록 기기의 정상 요청」(`allow`) | 「통과 · 미등록 기기의 가상 요청」(`deny`, `device_not_registered`) | 2026-10-13 04:57 UTC 실행: 여덟 줄 모두 「통과」 | 미등록 기기 실제 공격은 심판 몫: **미실행** |
| 7 평소와 다른 접속 | `npm run fixture:7`의 정상 사건 `allow` | 복합 이상 사건 `step_up`, 다시 확인한 요청만 `allow`(`decider:test` 3·4번째 줄) | `fixture:7` 실행: 정상 `allow`, 복합 이상 `step_up` | 다시 로그인 전 자료 차단·새 로그인 뒤 허용: **미실행**(계약에 없음) |
| 8 구역 | 자기 메모 한 건 경로(`GET·PUT /notes/:id`)만 허용(`decider:test` 5번째 줄 「메모 한 건 수정」) | 강사 공지 수정, `export` 경로, 쿼리가 붙은 요청 거부(`decider:test` 6~8번째 줄), 배포에서 B가 A의 id를 직접 요청 → `404` | `decider:test` 위 여덟 줄 통과, `node --test test/zones.test.mjs` 포함 전체 통과 | 배포 직접 요청: **미실행** |
| 9 탐지 | `npm run detect:test` 정상 조회 30건·정확히 120건은 `observe` | 121건·폭주 200건은 `propose_revocation`, 서로 다른 사용자 100건씩·10분 밖으로 흩어진 200건은 제안 없음 | `detect:test` 실행: 여섯 줄 모두 「통과」 | 반 엔진의 사건 전달·접속 회수: **미실행** |

- 전체 코드 시험: `npm ci` 뒤 `node --test test/*.test.mjs`. 2026-10-13 04:57 UTC에 85건 중 85건 통과, 실패 0건이었습니다. 이 시험은 위 로컬 열의 근거이며 배포나 심판 결과가 아닙니다.
- `npm run bundle`은 배포 주소로 토큰 없는 GET·POST·PUT·DELETE와 위조 토큰 요청을 실제로 보내 상태 코드만 기록하는 자기 점검(`src/attack-check.mjs`)을 포함하고, 변경을 모두 커밋한 뒤에만 실행합니다. 이번 복구 뒤에는 **미실행**입니다. 이 점검은 A·B 로그인 요청을 보내지 않아 4·6·8·9단계 항목은 계속 「미실행」으로 남습니다.
- 한 곳이라도 정상 요청이 거부되거나 금지 요청이 통과하면 거기서 멈추고, 그 줄의 첫 출력과 이번에 바뀐 파일만 근거로 한 가지만 고칩니다.

## 복구 경로 자체 시험: `npm run restore:selfcheck` (학생이 직접 실행)

- 용도: 배포된 사이트에서 복구 경로가 처음부터 끝까지 동작하는지 시험 계정으로 직접 확인합니다. 메모 만들기 → 변조 → 복구 미리보기(`dryRun`, 쓰지 않음) → 복구(본문 없음) → 처음 내용 확인 → 틀린 해시 거부 → 지우기 → 지운 뒤 복구 → 로그인 없는 복구 거부 → 사본 없는 메모 거부, 13단계입니다. 각 단계의 상태 코드와 걸린 시간만 출력하고, 토큰과 메모 내용은 출력하지 않습니다.
- 실행: 시험 계정으로 앱에 로그인한 뒤 그 계정의 토큰을 터미널에서 화면에 보이지 않게 입력하고(`read -rs ALEPH_TEST_TOKEN && export ALEPH_TEST_TOKEN`) `npm run restore:selfcheck`를 실행합니다. 토큰을 파일·Git·대화에 붙이지 마세요. 시험용 메모는 끝에 지우지만, 서버가 남긴 사본 행(제목 `backup`) 한 개는 API로 지울 수 없어 남습니다.
- 정상: 13단계가 모두 「통과」이고 요약이 `13/13`입니다. 거부되어야 할 결과: 하나라도 「실패」이면 첫 실패 단계 이름을 알려 줍니다.
- 이 스크립트는 코드 시험(`node --test test/restore-selfcheck.test.mjs`, 로컬 가짜 서버)으로만 확인했습니다. 실제 배포에서의 실행은 **미실행**입니다.

## 정책 사본 되돌리기: `policy:diff`와 `policy:restore` (10단계)

- 대상: 연습 거부 규칙 파일 `xdr/deny-rules.json`(보너스 1·2의 `xdr.brute-force.`·`xdr.web-injection.` 규칙)뿐입니다. 판정기(`src/decider.mjs`)와 `/api/notes`에는 연결되어 있지 않으며 운영 정책에는 접근하지 않습니다.
- 검증본: `xdr/verified-policy.json`이 Git 커밋(`e73192b`)의 사본과 sha256을 가리킵니다. 해시는 사본이 바뀌지 않았다는 확인일 뿐 안전하다는 증명이 아닙니다. 이 커밋을 검증본으로 지정한 판단은 학생이 해야 하며, 저는 직접 검증하지 못했습니다.
- `npm run policy:diff`: 검증본과 현재 파일의 차이만 보여 줍니다(다시 생길·사라질·바뀔 규칙과 영향받는 모듈). 파일을 쓰지 않으며, 기록 파일이 없거나 커밋·해시·형식 검증에 실패하면 차이를 보여 주지 않고 중단합니다(종료 코드 1).
- `npm run policy:restore`: 기본은 같은 내용의 미리보기와 12자리 확인 코드만 보여 주고 아무것도 쓰지 않습니다. 목록이 맞으면 `npm run policy:restore -- --apply --confirm <코드>`로 적용합니다. 그 사이 파일이 바뀌면 코드가 달라져 중단됩니다. 되돌리는 범위는 검증본에 들어 있는 모듈의 규칙뿐이고, 다른 모듈 규칙은 그대로 두며, `xdr/alerts.log`는 기존 줄을 지우지 않고 `restore` 기록 한 줄만 덧붙입니다. 기록을 쓰지 못하면 규칙 파일을 원래대로 되돌리고 중단합니다.
- 알아 둘 점: 검증본 규칙의 만료 시각(2026-10-11)은 이미 지났습니다. 복원해도 만료된 규칙은 맞지 않으며, 미리보기가 그 개수를 알려 줍니다. 아직 실제 `xdr/deny-rules.json`에는 적용하지 않았습니다(현재 파일이 검증본과 같아 `policy:diff`가 차이 없음).

## 복원 시험 기록 (결과를 꾸미지 않고 직접 채우는 칸)

백업은 실제로 되살려 본 것만 믿습니다. 아래 칸은 실제로 실행한 뒤 날짜와 첫 오류를 적습니다. 실행하지 않은 칸은 미실행으로 둡니다.

| 시험 | 명령·행동 | 정상 | 실행 날짜·시각 | 결과 |
|---|---|---|---|---|
| 정책 사본 비교 | `npm run policy:diff` | 차이 없음 또는 변경 범위 표시 | 2026-10-13 (로컬) | 차이 없음(규칙 16개) |
| 정책 복원 미리보기 | `npm run policy:restore` | 변경 범위와 확인 코드 표시, 파일 무변경 | 2026-10-13 (로컬) | 「되돌릴 것이 없습니다」(현재 파일이 검증본과 같음). 변경이 있는 경우는 임시 저장소 시험으로만 확인 |
| 정책 복원 적용 | `npm run policy:restore -- --apply --confirm <코드>` | 검증본 모듈만 바뀌고 다른 모듈·기록 보존 | 미실행 | 미실행 (임시 저장소 시험 `node --test test/policy-restore.test.mjs`만 통과, 실제 파일에는 적용 안 함) |
| 배포에서 복구 경로 전체 자체 시험 | `npm run restore:selfcheck` (시험 계정 토큰 필요) | 13단계 모두 통과 | 미실행 | 미실행 (로컬 가짜 서버 시험만 통과) |
| 메모 한 건 복원 | B 토큰으로 `POST /api/notes/<id>/restore` | `verified: true`, 다른 메모 그대로 | 미실행 | 미실행 (가짜 DB 시험 `node --test test/notes-restore.test.mjs`만 통과) |
| 복원 뒤 1~9단계 재확인 | 위 '복구 뒤 1~9단계 정상·금지 요청을 다시 실행하는 순서' | 정상은 통과, 금지는 거부 | 로컬만 2026-10-13 | 로컬 통과. 배포는 토큰 없이 보낸 요청만 2026-10-13 05:48 UTC 실행(1·2·3·5단계 대표와 복구 경로 `401`), 로그인이 필요한 확인은 미실행 |

## 10단계 점검에서 고친 이전 단계 결함

- 보너스 1 `xdr/brute-force/respond.mjs`: 규칙을 합칠 때 규칙 이름 접두어를 가리지 않아, 다시 실행하면 같은 파일의 웹 주입 규칙까지 모두 지우던 결함을 고쳤습니다. 수정 전 코드를 임시 폴더 복사본에서 돌렸더니 규칙이 16개에서 9개로 줄고 웹 주입 규칙 7개가 사라졌습니다. 이제 `xdr.brute-force.deny.` 규칙만 고치고 다른 모듈 규칙은 만료된 것도 그대로 둡니다. 시험은 `node --test test/xdr-respond-merge.test.mjs`(임시 폴더만 씀)입니다. 이미 사라진 규칙은 이 수정으로 돌아오지 않습니다(필요하면 `npm run xdr:run -- web-injection` 뒤 `node xdr/web-injection/respond.mjs`).
- `package/POLICIES.md`: 6~8단계에서 비워 둔 규칙 표를 실제로 구현한 규칙과 확인 방법으로 채웠습니다(확인은 로컬 시험이며 배포·심판 결과가 아님).
- `src/attack-check.mjs`: `step`이 10일 때 토큰 없는 `POST /api/notes/:id/restore`가 `401`인지 보내 보는 점검과, A·B 로그인이 필요한 복원 점검 두 개(미실행)를 더했습니다. `step`을 10으로 올린 10단계 저장점부터 실행됩니다. 이때 `build-public.mjs`·`deployment-identity.mjs`의 단계 목록에 10을 더하고 `test/r5.test.mjs`의 '지원하지 않는 단계' 시험을 11로 옮겼습니다.

## 10단계 저장점: 백업에서 자료실을 되살립니다

- 작동하는 것(코드 시험 기준): ① 메모를 만들 때(사본이 없던 옛 메모는 처음 수정·삭제 직전에) 서버가 검증용 사본을 남기고, `POST /api/notes/:id/restore`가 본문 없이 한 번 호출돼도 사본을 다시 읽어 ID·소유자·내용 해시를 대조한 뒤 메모 한 건만 되살리며(`dryRun`으로 실행 전에 버전과 바뀔 항목 확인), 복원 뒤 사본과 되살린 행을 새로 읽어 확인하며 어긋나면 쓴 내용을 되돌립니다(다른 메모와 사본 표는 그대로). ② `npm run policy:diff`는 검증본과 현재 시험 정책의 차이만 보여 주고, `npm run policy:restore`는 미리보기와 확인 코드를 거쳐서만 검증본 모듈의 규칙을 되돌립니다(다른 모듈 규칙은 보존하고 `xdr/alerts.log`에는 한 줄만 덧붙임). 두 절의 자세한 설명은 위 '10단계 작업'과 '정책 사본 되돌리기'에 있습니다. 1~9단계 기능은 그대로입니다.
- 설정 대조: `aleph.config.json`의 `step`은 10, `allowedRoutes`는 일곱 경로(`POST /api/notes/:id/restore` 포함, `test/notes-restore.test.mjs`가 `vercel.json`과 대조), `restoreRoute`는 `POST /api/notes/:id/restore`(형식이 운영 측 양식과 같은지는 미확인)입니다. `judgeIssuer`·`repoUrl`·`publicAppUrl`·`identityProvider`·`originalApiUrl`은 바꾸지 않았습니다. `RULE_IDS`는 실제로 구현한 다섯 개(`device_registered`, `step_up_required`, `zone_notes_own_route`, `zone_announcement_edit`, `zone_unknown_route`) 그대로입니다. 복원 경로는 서버 함수의 소유자·해시 대조이고 판정기 규칙이 아닙니다.
- 단계 목록: `build-public.mjs`·`deployment-identity.mjs`에 10을 더했고, `test/r5.test.mjs`의 '지원하지 않는 단계' 시험은 11로 옮겼습니다.
- 다시 실행: `npm ci` 뒤 `node --test test/*.test.mjs`(2026-10-13 로컬 89건 중 89건 통과, 가짜 DB·가짜 로그인 검사기·임시 폴더 기준이며 심판 판정이 아님), `npm run decider:test`, `npm run detect:test`, `npm run policy:diff`, `npm run build -- --local`. 복구 뒤 1~9단계를 다시 확인하는 순서는 위 '복구 뒤 1~9단계 정상·금지 요청을 다시 실행하는 순서'를 따릅니다.
- `src/attack-check.mjs`: 10단계 항목으로 토큰 없는 `POST /api/notes/:id/restore`가 `401`인지 실제로 보내는 점검(`anonymous_api_restore`)을 더했습니다. 로그인이 필요한 `restore_cross_owner`·`restore_normal_one_note`는 **미실행**으로 남습니다. 실제로 보낸 요청의 상태 코드만 기록하며 심판의 판정이 아닙니다.
- 미실행으로 남은 것: 실제 배포 화면에서의 사본 생성과 복원(예약 행 저장이 실제 DB에서 되는지 포함), 실제 `xdr/deny-rules.json`에 `policy:restore -- --apply` 적용, A·B 두 계정의 배포 화면 확인, 5단계 ①~④, 미등록 기기 공격과 재로그인 뒤 허용(6·7단계), 반 엔진의 사건 전달·접속 회수(9단계). 배포 주소가 이 커밋을 배포하기 전이면 이전 코드일 수 있습니다.
- 제출 묶음: 변경을 모두 커밋한 뒤 `npm run bundle`로 만듭니다(`bundle-notes.json`·`artifacts/`는 Git에 올리지 않음).
