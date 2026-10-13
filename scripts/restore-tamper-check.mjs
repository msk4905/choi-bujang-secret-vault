// 사본을 일부러 변조했을 때 복구가 멈추는지를 실제 배포·실제 DB에서 확인하는 학생용 3단계 스크립트입니다.
//   1) node scripts/restore-tamper-check.mjs create            → 시험용 메모를 만들고(서버가 사본을 남김) 사본을 바꾸는 SQL을 보여 줍니다.
//   2) (Supabase SQL Editor에서 보여 준 SQL을 실행해 사본 내용만 바꿉니다. 해시는 그대로 둡니다.)
//   3) node scripts/restore-tamper-check.mjs check <메모 ID>   → 복구를 호출해 409(BACKUP_HASH_MISMATCH)로 멈추고 메모가 그대로인지 확인합니다.
//   4) node scripts/restore-tamper-check.mjs cleanup <메모 ID> → 시험용 메모를 지웁니다(사본 한 건과 감사 기록은 표에 남습니다).
// 토큰은 환경변수 ALEPH_TEST_TOKEN으로만 받고 출력하지 않습니다. 출력에는 상태 코드·응답 오류 이름·메모 ID만 있고 메모 내용은 찍지 않습니다.
// 실제로 실행한 결과만 의미가 있습니다. 이 스크립트가 통과해도 심판 판정이 아닙니다.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGINAL = { title: '사본 변조 시험 제목', body: '사본 변조 시험 원래 내용' };

export async function runTamperCheck({ baseUrl, token, step, id, log = console.log, timeoutMs = 20000 }) {
  const call = async (method, path, body) => {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text().catch(() => '');
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* JSON이 아님 */ }
      return { status: response.status, json };
    } catch { return { status: null, json: null }; }
  };

  if (step === 'create') {
    const noteId = randomUUID();
    const created = await call('POST', '/api/notes', { id: noteId, ...ORIGINAL });
    if (created.status !== 201) { log(`실패 · 메모 만들기 · HTTP ${created.status}`); return { ok: false }; }
    log(`통과 · 시험용 메모를 만들었습니다(서버가 사본을 남김) · 메모 ID ${noteId}`);
    log('다음: Supabase SQL Editor에서 아래를 실행해 사본 내용만 바꾸세요(해시 칸은 그대로 둡니다).');
    log(`  update vault_notes_backup set content = 'tampered-copy' where note_id = '${noteId}';`);
    log(`그다음 node scripts/restore-tamper-check.mjs check ${noteId}`);
    return { ok: true, id: noteId };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id ?? '')) {
    log('메모 ID(UUID)를 뒤에 적어 주세요.');
    return { ok: false };
  }
  if (step === 'check') {
    // 메모를 일부러 고쳐 두면, 멈추지 않고 복원했는지(되돌아왔는지)가 눈에 보입니다.
    const edited = await call('PUT', `/api/notes/${id}`, { title: '변조된 제목', body: '변조된 내용' });
    log(`${edited.status === 200 ? '통과' : '실패'} · 메모를 변조함 · HTTP ${edited.status}`);
    const restored = await call('POST', `/api/restore/${id}`);
    const stopped = restored.status === 409 && restored.json?.error === 'BACKUP_HASH_MISMATCH';
    log(`${stopped ? '통과' : '실패'} · 변조된 사본이면 복구가 멈춤(기대: 409 BACKUP_HASH_MISMATCH) · HTTP ${restored.status}${restored.json?.error ? ` ${restored.json.error}` : ''}`);
    const after = await call('GET', `/api/notes/${id}`);
    const untouched = after.status === 200 && after.json?.title === '변조된 제목' && after.json?.body === '변조된 내용';
    log(`${untouched ? '통과' : '실패'} · 멈춘 뒤 메모는 쓰이지 않고 변조된 그대로 · HTTP ${after.status}`);
    const ok = edited.status === 200 && stopped && untouched;
    log(`요약: ${ok ? '사본 검증 실패 시 복구가 멈춥니다' : '확인 실패'}. 이 결과는 학생 계정으로 직접 확인한 것이며 심판 판정이 아닙니다.`);
    log(`정리: node scripts/restore-tamper-check.mjs cleanup ${id}`);
    return { ok };
  }
  if (step === 'cleanup') {
    const removed = await call('DELETE', `/api/notes/${id}`);
    log(`${removed.status === 204 ? '통과' : '실패'} · 시험용 메모 지우기 · HTTP ${removed.status}`);
    return { ok: removed.status === 204 };
  }
  log('사용법: create | check <메모 ID> | cleanup <메모 ID>');
  return { ok: false };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const token = process.env.ALEPH_TEST_TOKEN;
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  const baseUrl = process.env.ALEPH_BASE_URL || config.publicAppUrl;
  if (!token) {
    console.error('시험 계정 토큰이 필요합니다. PowerShell에서 ALEPH_TEST_TOKEN 환경변수를 숨김 입력으로 설정한 뒤 실행하세요. 토큰을 파일·Git·대화에 붙이지 마세요.');
    process.exitCode = 2;
  } else {
    const outcome = await runTamperCheck({ baseUrl, token, step: process.argv[2], id: process.argv[3] });
    process.exitCode = outcome.ok ? 0 : 1;
  }
}
