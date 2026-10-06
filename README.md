# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

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

- **소유자 검사 없음(4단계 과제)**: B가 A의 메모 id를 알면 `GET·PUT·DELETE /api/notes/:id`로 접근할 수 있습니다. 목록만 본인 메모로 좁혀 있습니다. 이 접근을 확인한 기록은 아직 없습니다.
- 처음 넣은 가상 메모 네 건은 `owner_id`가 비어 있을 수 있어 목록에 나오지 않을 수 있습니다.
- `notes.id` 칸이 UUID 타입인지는 이 저장소에서 확인하지 못했습니다(`supabase/schema.sql`은 Git 제외). UUID가 아니면 추가가 `502`로 실패합니다.
- `/api/ai`와 `/api/threat-intel`은 여전히 인증 없이 `501`만 돌려주는 빈 틀입니다.
- `allowedRoutes`는 `"METHOD /경로"` 문자열로 적었습니다. 문서에 정해진 형식이 없어 운영 측 양식과 다를 수 있습니다.
- 화면 상단의 "로그인하지 않은 방문자도 자료를 볼 수 있습니다" 안내문은 아직 1단계 문구 그대로입니다.
- 이 저장소에서는 실제 Supabase 연결·배포 화면·정상 A 로그인 동작을 시험하지 못했습니다. 학생이 확인해야 합니다. 배포 주소는 `main`에 합치기 전이면 이전 코드일 수 있습니다.
