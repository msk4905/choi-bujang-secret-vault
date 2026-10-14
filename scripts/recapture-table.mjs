// 12단계 탈환 점검표: 1~11단계의 정상·금지 요청을 한 표로 모읍니다.
// 표에 적는 것은 실제로 보낸 요청의 상태 코드와 실제로 돌린 가상 연습의 결과뿐입니다. 보내지 못한 요청은 「미실행」이고,
// 41종 총공세는 심판이 하므로 이 표에서 통과 처리하지 않습니다. 이 표는 심판의 판정이 아닙니다.
// 토큰·비밀번호·응답 본문·메모 내용은 표와 출력에 넣지 않습니다. 시험 계정 정보는 학생이 자기 터미널의 환경변수로만 줍니다:
//   ALEPH_A_EMAIL ALEPH_A_PASSWORD ALEPH_B_EMAIL ALEPH_B_PASSWORD (가상 시험 계정, 없으면 로그인이 필요한 줄은 미실행)
//   ALEPH_RESTORE_NOTE_ID (B의 사본 메모 UUID, 없으면 복구 정상 줄은 미실행)
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const NIL_ID = '00000000-0000-4000-8000-000000000000';
const API = '실제 배포 API';
const PRACTICE = '로컬 가상 연습';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export async function buildTable({ base, config, env = {}, fetchImpl = fetch, now = () => new Date().toISOString(), newId = randomUUID, local = {} }) {
  const rows = [];
  const add = row => rows.push({ requestId: '해당 없음', serverId: '', at: now(), ...row });
  const skip = (step, kind, request, expected, reason, source = API) =>
    add({ step, kind, request, expected, actual: `미실행: ${reason}`, verdict: '미실행', source });

  async function call(method, path, { token, body, absolute } = {}) {
    const requestId = newId();
    try {
      const response = await fetchImpl(absolute ?? new URL(path, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: {
          'X-Request-Id': requestId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text().catch(() => '');
      return { status: response.status, text, requestId, serverId: response.headers.get('x-vercel-id') ?? '', at: now() };
    } catch {
      return { status: null, text: '', requestId, serverId: '', at: now() };
    }
  }
  const judge = (status, ok) => (status === null ? '미확인(요청 실패)' : ok.includes(status) ? '일치' : '불일치');
  const record = (step, kind, request, expected, ok, result, extra = {}) => add({
    step, kind, request, expected, source: API, requestId: result.requestId, serverId: result.serverId, at: result.at,
    actual: result.status === null ? '요청을 보내지 못함(네트워크 오류)' : `HTTP ${result.status}`,
    verdict: judge(result.status, ok), ...extra,
  });

  // 1·2단계: 공개 자료
  let r = await call('GET', '/');
  record('1·2', '정상', 'GET /', 'HTTP 200', [200], r);
  r = await call('GET', '/data.json');
  let notesLeft = null;
  try { const parsed = JSON.parse(r.text); notesLeft = Array.isArray(parsed?.notes) ? parsed.notes.length : null; } catch { notesLeft = null; }
  const dataOk = r.status === 404 || (r.status === 200 && notesLeft === 0);
  record('1·2', '금지', 'GET /data.json (비로그인)', 'HTTP 404, 또는 200이고 가상 메모 0건', [], r, {
    actual: r.status === null ? '요청을 보내지 못함(네트워크 오류)' : `HTTP ${r.status}${r.status === 200 ? `, 메모 ${notesLeft ?? '개수 확인 불가'}건` : ''}`,
    verdict: r.status === null ? '미확인(요청 실패)' : dataOk ? '일치' : '불일치',
  });

  // 3단계: 토큰 없음·위조 토큰
  const forged = [b64({ alg: 'none', typ: 'JWT' }), b64({ iss: config.identityProvider?.issuer, aud: config.identityProvider?.audience, role: 'authenticated', sub: NIL_ID, exp: 4102444800 }), 'forged'].join('.');
  for (const [label, method, path, opts] of [
    ['토큰 없는 GET /api/notes', 'GET', '/api/notes', {}],
    ['토큰 없는 POST /api/notes', 'POST', '/api/notes', { body: {} }],
    ['토큰 없는 PUT /api/notes/:id', 'PUT', `/api/notes/${NIL_ID}`, { body: {} }],
    ['토큰 없는 DELETE /api/notes/:id', 'DELETE', `/api/notes/${NIL_ID}`, {}],
    ['서명 없는 위조 토큰 GET /api/notes', 'GET', '/api/notes', { token: forged }],
  ]) record('3', '금지', label, 'HTTP 401', [401], await call(method, path, opts));

  // 5단계: 공개 설정과 원본 주소 직접 요청
  r = await call('GET', '/api/config');
  record('5', '정상', 'GET /api/config (로그인용 공개 설정)', 'HTTP 200', [200], r);
  let publishableKey = null;
  try { publishableKey = JSON.parse(r.text)?.publishableKey ?? null; } catch { publishableKey = null; }
  if (r.status === 200 && typeof publishableKey === 'string' && publishableKey && typeof config.originalApiUrl === 'string') {
    const requestId = newId();
    let status = null; let leaked = false;
    try {
      const response = await fetchImpl(config.originalApiUrl, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { apikey: publishableKey, 'X-Request-Id': requestId } });
      status = response.status;
      const parsed = JSON.parse(await response.text().catch(() => ''));
      leaked = response.ok && Array.isArray(parsed) && parsed.length > 0;
    } catch { leaked = false; }
    add({ step: '5', kind: '금지', request: '공개 키만으로 원본 자료 주소 직접 요청', expected: 'HTTP 401 또는 403, 메모 행 없음',
      source: API, requestId, at: now(), actual: status === null ? '요청을 보내지 못함(네트워크 오류)' : `HTTP ${status}${leaked ? ', 메모 행이 보임' : ''}`,
      verdict: status === null ? '미확인(요청 실패)' : !leaked && [401, 403].includes(status) ? '일치' : '불일치' });
  } else skip('5', '금지', '공개 키만으로 원본 자료 주소 직접 요청', 'HTTP 401 또는 403', '/api/config에서 공개 키를 받지 못해 보내지 않음');

  // 10·12단계: 토큰 없는 복구·작전실
  record('10', '금지', '토큰 없는 POST /api/notes/restore', 'HTTP 401', [401], await call('POST', '/api/notes/restore', { body: {} }));
  record('10', '금지', 'GET /api/notes/restore (허용되지 않는 방식)', 'HTTP 405', [405], await call('GET', '/api/notes/restore'));
  record('12', '금지', '토큰 없는 GET /api/war-room', 'HTTP 401', [401], await call('GET', '/api/war-room'));

  // 로그인이 필요한 줄: 시험 계정 A·B (환경변수가 있을 때만)
  const tokens = {};
  if (publishableKey && config.identityProvider?.issuer) {
    for (const who of ['A', 'B']) {
      const email = env[`ALEPH_${who}_EMAIL`]; const password = env[`ALEPH_${who}_PASSWORD`];
      if (!email || !password) continue;
      try {
        const response = await fetchImpl(`${config.identityProvider.issuer}/token?grant_type=password`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { apikey: publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
        });
        const token = response.ok ? (await response.json())?.access_token : null;
        if (typeof token === 'string' && token) tokens[who] = token;
      } catch { /* 로그인하지 못하면 해당 줄은 미실행 */ }
    }
  }
  const need = '시험 계정 A·B 로그인 환경변수가 없거나 로그인에 실패해 보내지 않음';
  const loginRows = [
    ['3·4', '정상', 'A 토큰 GET /api/notes', 'HTTP 200'],
    ['3·4', '정상', 'A 토큰 POST /api/notes (가상 시험 메모)', 'HTTP 201'],
    ['4·8', '금지', 'B 토큰으로 A의 메모 GET /api/notes/:id', 'HTTP 404'],
    ['4·8', '금지', 'B 토큰으로 A의 메모 PUT /api/notes/:id', 'HTTP 404'],
    ['4·8', '금지', 'B 토큰으로 A의 메모 DELETE /api/notes/:id', 'HTTP 404'],
    ['3·4', '정상', 'A 토큰 GET /api/notes/:id (자기 메모)', 'HTTP 200'],
    ['3·4', '정상', 'A 토큰 DELETE /api/notes/:id (시험 메모 정리)', 'HTTP 204'],
    ['12', '정상', 'A 토큰 GET /api/war-room', 'HTTP 200'],
  ];
  if (!tokens.A || !tokens.B) {
    for (const [step, kind, request, expected] of loginRows) skip(step, kind, request, expected, need);
  } else {
    const A = tokens.A; const B = tokens.B;
    record('3·4', '정상', 'A 토큰 GET /api/notes', 'HTTP 200', [200], await call('GET', '/api/notes', { token: A }));
    const created = await call('POST', '/api/notes', { token: A, body: { title: '작전실 시험용 가상 메모', body: '가상 시험 내용입니다.' } });
    record('3·4', '정상', 'A 토큰 POST /api/notes (가상 시험 메모)', 'HTTP 201', [201], created);
    let id = null;
    try { id = JSON.parse(created.text)?.id ?? null; } catch { id = null; }
    if (typeof id !== 'string') {
      for (const [step, kind, request, expected] of loginRows.slice(2, 7)) skip(step, kind, request, expected, '시험 메모를 만들지 못해 보내지 않음');
    } else {
      try {
        record('4·8', '금지', 'B 토큰으로 A의 메모 GET /api/notes/:id', 'HTTP 404', [404], await call('GET', `/api/notes/${id}`, { token: B }));
        record('4·8', '금지', 'B 토큰으로 A의 메모 PUT /api/notes/:id', 'HTTP 404', [404], await call('PUT', `/api/notes/${id}`, { token: B, body: { title: '침해 시도', body: '가상' } }));
        record('4·8', '금지', 'B 토큰으로 A의 메모 DELETE /api/notes/:id', 'HTTP 404', [404], await call('DELETE', `/api/notes/${id}`, { token: B }));
        record('3·4', '정상', 'A 토큰 GET /api/notes/:id (자기 메모)', 'HTTP 200', [200], await call('GET', `/api/notes/${id}`, { token: A }));
      } finally {
        record('3·4', '정상', 'A 토큰 DELETE /api/notes/:id (시험 메모 정리)', 'HTTP 204', [204], await call('DELETE', `/api/notes/${id}`, { token: A }));
      }
    }
    r = await call('GET', '/api/war-room', { token: A });
    record('12', '정상', 'A 토큰 GET /api/war-room', 'HTTP 200', [200], r);
  }
  const restoreId = env.ALEPH_RESTORE_NOTE_ID;
  if (tokens.A && tokens.B && /^[0-9a-f-]{36}$/iu.test(restoreId ?? '')) {
    record('10', '정상', 'B 토큰 POST /api/notes/restore (사본의 한 건)', 'HTTP 200', [200], await call('POST', '/api/notes/restore', { token: tokens.B, body: { id: restoreId } }));
    record('10', '금지', 'A 토큰으로 B의 사본 ID 복원', 'HTTP 404', [404], await call('POST', '/api/notes/restore', { token: tokens.A, body: { id: restoreId } }));
  } else {
    skip('10', '정상', 'B 토큰 POST /api/notes/restore (사본의 한 건)', 'HTTP 200', '시험 계정 로그인 또는 ALEPH_RESTORE_NOTE_ID가 없어 보내지 않음');
    skip('10', '금지', 'A 토큰으로 B의 사본 ID 복원', 'HTTP 404', '시험 계정 로그인 또는 ALEPH_RESTORE_NOTE_ID가 없어 보내지 않음');
  }

  // 6~9·정책: 가상 연습. 반 엔진이 아니라 이 저장소의 함수를 직접 부른 결과입니다.
  if (local.decide && local.fixtureRequests) {
    const { normal, suspicious } = local.fixtureRequests();
    const id = '11111111-1111-4111-8111-111111111111';
    const at = (method, route, path, extra = {}) => ({ ...normal, requestId: newId(), method, route, path, ...extra });
    const cases = [
      ['6', '정상', '등록 기기의 정상 요청(가상)', { ...normal, requestId: newId() }, 'allow'],
      ['6', '금지', '미등록 기기 요청(가상)', { ...normal, requestId: newId(), deviceRegistered: false }, 'deny', 'device_not_registered'],
      ['7', '금지', '복합 이상 접속, 재확인 전(가상)', { ...suspicious, requestId: newId() }, 'step_up', 'step_up_required'],
      ['7', '정상', '복합 이상 접속, 재확인 뒤(가상)', { ...suspicious, requestId: newId(), stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow'],
      ['8', '정상', '메모 한 건 수정(가상)', at('PUT', 'PUT /notes/:id', `/notes/${id}`), 'allow'],
      ['8', '금지', '강사 공지 수정(가상)', at('PUT', 'PUT /announcements/:id', `/announcements/${id}`), 'deny', 'zone_not_allowed'],
      ['8', '금지', '같은 깊이의 export 경로(가상)', at('GET', 'GET /notes/:id', '/notes/export'), 'deny', 'zone_not_allowed'],
      ['8', '금지', '쿼리가 붙은 요청(가상)', at('GET', 'GET /notes/:id', `/notes/${id}`, { queryLength: 8 }), 'deny', 'zone_not_allowed'],
    ];
    for (const [step, kind, request, req, decision, reasonCode] of cases) {
      const out = await local.decide(req);
      const ok = out?.decision === decision && (!reasonCode || out.reasonCode === reasonCode) && out.requestId === req.requestId;
      add({ step, kind, request, expected: `${decision}${reasonCode ? ` · ${reasonCode}` : ''}`, source: PRACTICE, requestId: req.requestId,
        actual: `${out?.decision} · ${out?.reasonCode}`, verdict: ok ? '일치' : '불일치' });
    }
  }
  if (local.detect) {
    const events = count => Array.from({ length: count }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 1) + i * 2000).toISOString(), method: 'GET', identity: { sub: 'learner_fixture' } }));
    for (const [kind, count, want] of [['정상', 120, 'observe'], ['금지', 121, 'propose_revocation']]) {
      const out = await local.detect(events(count));
      add({ step: '9', kind, request: `같은 사용자 10분 안 조회 ${count}건(가상 사건)`, expected: want, source: PRACTICE, actual: out?.action ?? '응답 없음', verdict: out?.action === want ? '일치' : '불일치' });
    }
  }
  skip('11', '정상', '기기 승인 확인 뒤 자료실 열림(화면)', '서버가 2xx일 때만 열림', '화면 시험이라 이 표가 열지 않음. 가짜 서버 응답의 Chromium 시험만 있음', '화면');
  skip('전체', '정상·금지', '41종 총공세', '심판이 판정', '심판 담당이며 이 표는 41종 통과를 판정하지 않음', '심판');
  return rows;
}

const cell = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
export function renderMarkdown(rows, { base, generatedAt }) {
  const tally = rows.reduce((sum, row) => ({ ...sum, [row.verdict]: (sum[row.verdict] ?? 0) + 1 }), {});
  const head = ['단계', '구분', '요청', '기대 결과', '실제 결과', '판정', '요청 ID', '확인 시각(UTC)', '출처'];
  const lines = [`# 탈환 점검표 (${generatedAt})`, '', `대상: ${base}`, '',
    '이 표는 실제로 보낸 요청과 돌린 가상 연습의 결과만 적습니다. 심판의 판정이 아니며 41종 총공세를 통과 처리하지 않습니다.', '',
    `집계: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ')}`, '',
    `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const row of rows) {
    lines.push(`| ${[row.step, row.kind, row.request, row.expected, row.actual, row.verdict,
      row.serverId ? `${row.requestId} / ${row.serverId}` : row.requestId, row.at, row.source].map(cell).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(await readFile(join(root, 'aleph.config.json'), 'utf8'));
    const flag = process.argv.indexOf('--base');
    const base = new URL(flag > 0 ? process.argv[flag + 1] : config.publicAppUrl);
    if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('https 주소(또는 localhost)만 사용할 수 있습니다.');
    const load = async name => import(pathToFileURL(join(root, name)).href);
    const { decide } = await load('src/decider.mjs');
    const { detect } = await load('src/detect.mjs');
    const { fixtureRequests } = await load('scripts/fixture-7.mjs');
    const rows = await buildTable({ base, config, env: process.env, local: { decide, detect, fixtureRequests } });
    const generatedAt = new Date().toISOString();
    const markdown = renderMarkdown(rows, { base: base.origin, generatedAt });
    await mkdir(join(root, 'artifacts'), { recursive: true });
    await writeFile(join(root, 'artifacts', 'recapture-table.md'), markdown, 'utf8');
    await writeFile(join(root, 'artifacts', 'recapture-table.json'), `${JSON.stringify({ generatedAt, base: base.origin, rows }, null, 2)}\n`, 'utf8');
    process.stdout.write(markdown);
    process.stdout.write('\n저장: artifacts/recapture-table.md · artifacts/recapture-table.json (Git에 올리지 않음)\n');
    if (rows.some(row => row.verdict === '불일치')) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`점검표 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
