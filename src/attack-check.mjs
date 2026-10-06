// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
const STARTER_MARKER = 'SAMPLE_NOTE_1';

export async function runAttackChecks(config) {
  if (![2, 3].includes(config.step)) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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
  };
  return [
    { attackId: 'anonymous_api_list', expected: '토큰 없는 GET /api/notes가 401로 거부됨', observed: describe('토큰 없는 GET /api/notes', results.list) },
    { attackId: 'anonymous_api_create', expected: '토큰 없는 POST /api/notes가 401로 거부됨', observed: describe('토큰 없는 POST /api/notes', results.create) },
    { attackId: 'anonymous_api_update', expected: '토큰 없는 PUT /api/notes/:id가 401로 거부됨', observed: describe('토큰 없는 PUT /api/notes/:id', results.update) },
    { attackId: 'anonymous_api_delete', expected: '토큰 없는 DELETE /api/notes/:id가 401로 거부됨', observed: describe('토큰 없는 DELETE /api/notes/:id', results.remove) },
    { attackId: 'forged_token_list', expected: '서명 없는 위조 토큰의 GET /api/notes가 401로 거부됨', observed: describe('위조 토큰 GET /api/notes', results.forged) },
    { attackId: 'normal_login_crud', expected: 'A 계정 로그인 뒤 메모 추가·수정·삭제가 되고 로그아웃 뒤에는 자료가 사라짐',
      observed: '미실행: 이 점검은 로그인 계정을 쓰지 않음. 학생이 화면에서 직접 확인해야 함' },
  ];
}
