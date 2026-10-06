// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
const STARTER_MARKER = 'SAMPLE_NOTE_1';

export async function runAttackChecks(config) {
  if (config.step !== 2) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
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

  return [
    { attackId: 'anonymous_note_read', expected: '비로그인 요청에서 공개 /data.json에 가상 메모가 보이지 않음', observed: noteObserved },
    { attackId: 'static_marker_absent', expected: '정적 응답에 시작 틀 확인 표시가 보이지 않음', observed: markerObserved },
  ];
}
