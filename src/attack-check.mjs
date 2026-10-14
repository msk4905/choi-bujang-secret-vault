// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
const STARTER_MARKER = 'SAMPLE_NOTE_1';

export async function runAttackChecks(config) {
  if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  const get = async (path) => {
    const response = await fetch(new URL(path, app), {
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, text: await response.text().catch(() => '') };
  };
  const data = await get('/data.json');
  const aleph = await get('/aleph.json');

  // 2단계: 공개 /data.json에는 가상 메모가 남아 있지 않아야 한다. 본문은 기록하지 않는다.
  let memosVisible = null;
  if (data.status === 404) {
    memosVisible = false;
  } else if (data.status >= 200 && data.status < 300) {
    try {
      const parsed = JSON.parse(data.text);
      memosVisible = Array.isArray(parsed?.notes) ? parsed.notes.length > 0 : null;
    } catch {
      // A non-JSON response is not evidence that the memos are gone.
    }
  }
  const noteObserved = memosVisible === false
    ? '비로그인 요청에서 공개 /data.json에 가상 메모가 보이지 않음'
    : memosVisible === true
      ? '비로그인 요청에서 공개 /data.json에 가상 메모가 아직 보임'
      : `비로그인 요청의 공개 /data.json 형식을 확인할 수 없음 (HTTP ${data.status})`;

  // 2단계: 정적 응답에 1단계 시작 틀 확인 표시가 남아 있으면 안 된다.
  const markerFound = [data, aleph].some(item => item.text.includes(STARTER_MARKER));
  const markerObserved = markerFound
    ? '정적 응답(/data.json, /aleph.json)에 시작 틀 확인 표시가 아직 보임'
    : `정적 응답(/data.json HTTP ${data.status}, /aleph.json HTTP ${aleph.status})에 시작 틀 확인 표시가 보이지 않음`;

  const attempts = [
    { attackId: 'anonymous_note_read', expected: '비로그인 요청에서 공개 /data.json에 가상 메모가 보이지 않음', observed: noteObserved },
    { attackId: 'static_marker_absent', expected: '정적 응답에 시작 틀 확인 표시가 보이지 않음', observed: markerObserved },
  ];
  if (config.step >= 3) attempts.push(...await apiChecks(app, config));
  if (typeof config.originalApiUrl === 'string') attempts.push(await originalApiCheck(app, config));
  return attempts;
}

// 3단계: 자료 API가 토큰 없는 요청과 위조 토큰을 거부하는지, 실제로 보낸 요청의 상태 코드만 기록한다.
// 본문·토큰·메모 내용은 기록하지 않는다. 존재하지 않는 id와 빈 본문만 써서 자료를 바꾸지 않는다.
const NIL_ID = '00000000-0000-4000-8000-000000000000';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

async function send(app, method, path, { token, body } = {}) {
  try {
    const response = await fetch(new URL(path, app), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    await response.text().catch(() => '');
    return response.status;
  } catch {
    return null;
  }
}

function describe(label, status) {
  if (status === null) return `${label}: 요청을 보내지 못함(네트워크 오류), 거부 여부를 확인하지 못함`;
  if (status === 401) return `${label}: HTTP 401로 거부됨`;
  return `${label}: HTTP ${status}로 응답해 401 거부를 확인하지 못함`;
}

async function apiChecks(app, config) {
  const forged = [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({ iss: config.identityProvider?.issuer, aud: config.identityProvider?.audience,
      role: 'authenticated', sub: NIL_ID, exp: 4102444800 }),
    'forged',
  ].join('.');
  const results = {
    list: await send(app, 'GET', '/api/notes'),
    create: await send(app, 'POST', '/api/notes', { body: {} }),
    update: await send(app, 'PUT', `/api/notes/${NIL_ID}`, { body: {} }),
    remove: await send(app, 'DELETE', `/api/notes/${NIL_ID}`),
    forged: await send(app, 'GET', '/api/notes', { token: forged }),
    ...(config.step >= 10 ? { restore: await send(app, 'POST', '/api/notes/restore', { body: {} }) } : {}),
    ...(config.step >= 12 ? { warRoom: await send(app, 'GET', '/api/war-room') } : {}),
  };
  return [
    { attackId: 'anonymous_api_list', expected: '토큰 없는 GET /api/notes가 401로 거부됨', observed: describe('토큰 없는 GET /api/notes', results.list) },
    { attackId: 'anonymous_api_create', expected: '토큰 없는 POST /api/notes가 401로 거부됨', observed: describe('토큰 없는 POST /api/notes', results.create) },
    { attackId: 'anonymous_api_update', expected: '토큰 없는 PUT /api/notes/:id가 401로 거부됨', observed: describe('토큰 없는 PUT /api/notes/:id', results.update) },
    { attackId: 'anonymous_api_delete', expected: '토큰 없는 DELETE /api/notes/:id가 401로 거부됨', observed: describe('토큰 없는 DELETE /api/notes/:id', results.remove) },
    { attackId: 'forged_token_list', expected: '서명 없는 위조 토큰의 GET /api/notes가 401로 거부됨', observed: describe('위조 토큰 GET /api/notes', results.forged) },
    ...(config.step >= 10 ? [
      { attackId: 'anonymous_note_restore', expected: '토큰 없는 POST /api/notes/restore가 401로 거부됨', observed: describe('토큰 없는 POST /api/notes/restore', results.restore) },
      { attackId: 'note_restore_owner_b_only', expected: '시험 계정 B가 사본의 B 메모 한 건만 복원하고, A 로그인으로 같은 ID를 복원하면 404이며 다른 메모·감사 기록은 그대로임',
        observed: '미실행: 이 점검은 A·B 로그인 계정과 실제 Supabase 사본을 쓰지 않음. 가짜 DB 시험(node --test test/note-restore.test.mjs)만 했고 심판의 판정이 아님' },
      { attackId: 'policy_restore_decider', expected: '판정기 정책(src/decider.mjs의 POLICY)을 검증한 안전 정책 사본(safe-v9)으로 되돌리면 변조로 열렸던 금지 요청이 다시 거부되고 정상 요청은 허용됨',
        observed: '미실행: 이 점검은 요청을 보내지 않음. npm run policy:verify로 저장된 사본을 다시 읽어 검증한 기록과 npm run policy:test의 임시 폴더 시험·가상 요청만 있으며 배포 환경의 정책이나 심판의 판정이 아님' },
    ] : []),
    ...(config.step >= 4 ? [{ attackId: 'cross_owner_access', expected: 'B 로그인으로 A의 메모 id를 읽기·수정·삭제하면 404로 거부되고 소유자 변경도 거부됨',
      observed: '미실행: 이 점검은 A·B 로그인 계정을 쓰지 않음. 학생이 두 계정으로 직접 확인해야 함' }] : []),
    ...(config.step >= 6 ? [{ attackId: 'unregistered_device', expected: '등록하지 않은 기기의 요청이 판정기에서 deny·device_not_registered로 거부됨',
      observed: '미실행: 미등록 기기 공격은 심판이 맡으며 이 점검은 그런 요청을 보내지 않음. npm run decider:test는 가상 요청 연습일 뿐임' }] : []),
    ...(config.step >= 6 ? [{ attackId: 'step_up_reauth', expected: '복합 이상 접속은 다시 로그인하기 전 자료가 막히고, 새 로그인 뒤 요청은 다시 판정되어 허용됨',
      observed: '미실행: 엔진이 같은 로그인으로 다시 로그인한 시각을 확인하는 계약이 아직 없음(docs/DECIDER_REQUEST.md에는 stepUp 값만 있음). 실제 자료 차단은 시험하지 않음. npm run decider:test는 가상 요청 연습일 뿐임' }] : []),
    ...(config.step >= 8 ? [{ attackId: 'cross_zone_direct_api', expected: '메뉴를 우회해 B 로그인으로 A의 메모 id를 직접 요청하면 404로 거부되고, 일반 학생의 공지 수정은 거부됨',
      observed: '미실행: 이 점검은 A·B 로그인 계정을 쓰지 않고 공지 자료·주소도 없음. 판정기의 구역 규칙은 npm run decider:test와 가짜 DB 시험으로만 확인했으며 심판의 판정이 아님' }] : []),
    ...(config.step >= 9 ? [{ attackId: 'detect_revocation_proposal', expected: '10분 안 다량 조회와 낯선 네트워크가 함께인 복합 의심 사건만 확인된 기기 한 개의 회수 제안을 내고, 정상 사건은 내지 않음',
      observed: '미실행: 이 점검은 반 엔진의 사건 전달이나 접속 회수를 시험하지 않음. npm run detect:test와 node --test test/detect-*.test.mjs는 가상 사건 연습일 뿐이며 심판의 판정이 아님' }] : []),
    ...(config.step >= 11 ? [{ attackId: 'device_approval_gate', expected: '기기 승인 확인 전에는 화면에 자료가 없고, 서버가 허용한 기기에서만 기존 자료실이 열리며 설치 표시나 버튼만으로는 열리지 않음',
      observed: '미실행: 이 점검은 화면을 열거나 로그인하지 않음. 가짜 서버 응답으로 한 Chromium 시험(승인 전 요청 0건, 200이면 열림, 403이면 닫힘)만 있고 실제 배포 주소·실제 계정·심판의 판정이 아님' }] : []),
    ...(config.step >= 12 ? [
      { attackId: 'anonymous_war_room', expected: '토큰 없는 GET /api/war-room이 401로 거부됨', observed: describe('토큰 없는 GET /api/war-room', results.warRoom) },
      { attackId: 'war_room_screen_matches_server', expected: '작전실 화면의 복구 건수·판정기 규칙 수가 서버 응답과 같고, 미실행 항목은 미실행으로 표시되며 메모 본문은 보이지 않음',
        observed: '미실행: 이 점검은 로그인하지 않아 화면을 열지 않음. 가짜 DB 시험(node --test test/war-room.test.mjs)만 했고 실제 배포 주소·실제 계정·심판의 판정이 아님' },
    ] : []),
    { attackId: 'normal_login_crud', expected: 'A 계정 로그인 뒤 메모 추가·수정·삭제가 되고 로그아웃 뒤에는 자료가 사라짐',
      observed: '미실행: 이 점검은 로그인 계정을 쓰지 않음. 학생이 화면에서 직접 확인해야 함' },
  ];
}

// 5단계: 원본 자료 주소를 공개 키만으로 직접 불러 본다. 공개 키는 배포 주소의 /api/config에서 받아 쓰고,
// 키 값과 응답 본문은 기록하지 않는다. 기록하는 것은 상태 코드뿐이며 심판의 판정이 아니다.
async function originalApiCheck(app, config) {
  const expected = '공개 키만으로 원본 자료 주소를 직접 불러도 메모가 나오지 않음(401·403 등 거부)';
  let key = null;
  try {
    const response = await fetch(new URL('/api/config', app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (response.ok) key = (await response.json())?.publishableKey ?? null;
  } catch {
    key = null;
  }
  if (typeof key !== 'string' || !key) {
    return { attackId: 'original_api_direct', expected, observed: '미실행: 배포 주소의 /api/config에서 공개 키를 받지 못해 직접 요청을 보내지 않음' };
  }
  let status = null;
  let leaked = false;
  try {
    const response = await fetch(config.originalApiUrl, {
      redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { apikey: key },
    });
    status = response.status;
    const text = await response.text().catch(() => '');
    try {
      const parsed = JSON.parse(text);
      leaked = response.ok && Array.isArray(parsed) && parsed.length > 0;
    } catch {
      leaked = false;
    }
  } catch {
    status = null;
  }
  const observed = status === null
    ? '원본 자료 주소로 요청을 보내지 못함(네트워크 오류), 거부 여부를 확인하지 못함'
    : leaked
      ? `원본 자료 주소가 HTTP ${status}로 응답하며 메모 행이 보임`
      : status >= 200 && status < 300
        ? `원본 자료 주소가 HTTP ${status}로 응답함(메모 행은 보이지 않음), 권한 회수 여부는 따로 확인 필요`
        : `원본 자료 주소가 HTTP ${status}로 거부됨`;
  return { attackId: 'original_api_direct', expected, observed };
}
