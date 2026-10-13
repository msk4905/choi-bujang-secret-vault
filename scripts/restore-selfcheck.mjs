// 복구 경로를 실제 배포(또는 로컬 서버)에서 처음부터 끝까지 시험하는 학생용 확인 스크립트입니다.
// 흐름: 메모 만들기 → 변조 → 복구 미리보기(dryRun) → 복구 → 처음 내용 확인 → 지운 뒤 복구 → 거부 확인.
// 토큰은 환경변수 ALEPH_TEST_TOKEN으로만 받습니다(명령줄 인자·파일·출력에 쓰지 않음). 출력에는 상태 코드와 걸린 시간만 있고,
// 토큰과 메모 내용은 찍지 않습니다. 시험용 메모는 끝에 지웁니다(서버가 남기는 사본 행 하나는 API로 지울 수 없어 남습니다).
// 실제로 실행한 결과만 의미가 있습니다. 이 스크립트가 통과해도 심판 판정이 아닙니다.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha = (title, body) => createHash('sha256').update(`${title}\u0000${body}`, 'utf8').digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const SLOW_MS = 3000;

export async function runSelfCheck({ baseUrl, token, log = console.log, timeoutMs = 15000 } = {}) {
  const base = new URL(baseUrl);
  const local = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (base.username || base.password || !(base.protocol === 'https:' || (local && base.protocol === 'http:'))) {
    throw new Error('주소는 https여야 합니다(로컬 시험만 http://localhost 허용).');
  }
  if (typeof token !== 'string' || token.length < 20) throw new Error('시험 계정 토큰이 없습니다.');

  async function call(method, path, { body, auth = true } = {}) {
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* JSON이 아님 */ }
      return { status: response.status, json, ms: Math.round(performance.now() - started) };
    } catch {
      return { status: null, json: null, ms: Math.round(performance.now() - started) };
    }
  }

  const results = [];
  let failed = null;
  const step = (name, r, ok) => {
    results.push({ name, status: r.status, ms: r.ms, ok });
    log(`${ok ? '통과' : '실패'} · ${name} · ${r.status === null ? '응답 없음' : `HTTP ${r.status}`} · ${r.ms}ms${r.ms > SLOW_MS ? ' (느림)' : ''}`);
    if (!ok && !failed) failed = name;
    return ok;
  };

  const original = { title: '복구 시험', body: `원본 ${randomBytes(6).toString('hex')}` };
  const tampered = { title: '복구 시험(변조)', body: `변조 ${randomBytes(6).toString('hex')}` };
  const originalHash = sha(original.title, original.body);
  const tamperedHash = sha(tampered.title, tampered.body);
  const read = async (id) => {
    const r = await call('GET', `/api/notes/${id}`);
    return { ...r, hash: r.status === 200 && r.json ? sha(r.json.title ?? '', r.json.body ?? '') : null };
  };

  let id = null;
  try {
    const created = await call('POST', '/api/notes', { body: original });
    id = UUID.test(created.json?.id ?? '') ? created.json.id : null;
    step('1 메모 만들기(서버가 사본을 남김)', created, created.status === 201 && id !== null);
    if (id) {
      const edit = await call('PUT', `/api/notes/${id}`, { body: tampered });
      step('2 메모 변조', edit, edit.status === 200);
      const after = await read(id);
      step('3 변조된 것 확인', after, after.hash === tamperedHash);
      const preview = await call('POST', `/api/notes/${id}/restore`, { body: { dryRun: true } });
      step('4 복구 미리보기(버전·바뀔 항목만, 쓰지 않음)', preview, preview.status === 200 && preview.json?.preview === true
        && typeof preview.json.version === 'string' && Array.isArray(preview.json.willChange) && preview.json.willChange.length > 0);
      const stillBad = await read(id);
      step('5 미리보기는 아무것도 쓰지 않음', stillBad, stillBad.hash === tamperedHash);
      const restored = await call('POST', `/api/notes/${id}/restore`);
      step('6 복구 호출(본문 없음)', restored, restored.status === 200 && restored.json?.verified === true && restored.json?.restored === 'updated');
      const back = await read(id);
      step('7 처음 내용으로 돌아옴', back, back.hash === originalHash);
      const wrong = await call('POST', `/api/notes/${id}/restore`, { body: { contentSha256: 'a'.repeat(64) } });
      step('8 틀린 해시는 거부', wrong, wrong.status === 409);
      const removed = await call('DELETE', `/api/notes/${id}`);
      step('9 메모 지우기', removed, removed.status === 204);
      const recreated = await call('POST', `/api/notes/${id}/restore`);
      step('10 지운 뒤 복구', recreated, recreated.status === 201 && recreated.json?.restored === 'created' && recreated.json?.verified === true);
      const again = await read(id);
      step('11 되살아난 내용 확인', again, again.hash === originalHash);
    }
    const noToken = await call('POST', `/api/notes/${id ?? UNKNOWN_ID}/restore`, { auth: false });
    step('12 로그인 없는 복구는 거부', noToken, noToken.status === 401);
    const unknown = await call('POST', `/api/notes/${UNKNOWN_ID}/restore`);
    step('13 사본 없는 메모는 거부', unknown, unknown.status === 404);
  } finally {
    if (id) await call('DELETE', `/api/notes/${id}`); // 시험용 메모 정리(이미 없으면 404여도 무시)
  }

  const slowest = results.reduce((max, r) => Math.max(max, r.ms), 0);
  log(`요약: ${results.filter(r => r.ok).length}/${results.length} 통과 · 가장 느린 호출 ${slowest}ms`);
  if (failed) log(`첫 실패: ${failed}`);
  return { ok: failed === null, results, firstFailure: failed, slowest };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const token = process.env.ALEPH_TEST_TOKEN;
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  const baseUrl = process.env.ALEPH_BASE_URL || config.publicAppUrl;
  if (!token) {
    console.error('시험 계정 토큰이 필요합니다. 터미널에서 화면에 보이지 않게 입력하세요:');
    console.error('  read -rs ALEPH_TEST_TOKEN && export ALEPH_TEST_TOKEN   (입력 후 Enter)');
    console.error('그다음 npm run restore:selfcheck 를 실행합니다. 토큰을 파일·Git·대화에 붙이지 마세요.');
    process.exitCode = 2;
  } else {
    try {
      const outcome = await runSelfCheck({ baseUrl, token });
      process.exitCode = outcome.ok ? 0 : 1;
    } catch (error) {
      console.error(`중단: ${error.message}`);
      process.exitCode = 2;
    }
  }
}
