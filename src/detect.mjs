// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.

// docs/DETECT_EVENTS.md 계약의 세 값(at, method, identity.sub)만 꺼냅니다.
// 그 밖의 칸(메모 내용·토큰·이름 등)은 복사하지 않고 버립니다. 이 계약에는 기기 값이 없으므로 만들지 않습니다.
// 선택 칸 network('usual'|'unusual')는 계약에 없는 가정입니다. 있고 형식이 맞을 때만 읽고, 아니면 null로 둡니다.
// 선택 칸 deviceId·deviceRegistered도 계약에 없는 가정입니다(판정기 계약의 같은 이름을 따름). 형식이 맞고 deviceRegistered가 true일 때만 기기를 인정합니다.
// 지역(region)은 읽지 않습니다. 지역 하나만으로는 의심 표시를 하지 않기 위해서입니다.
// 형식이 틀린 사건은 값을 출력하지 않고 개수(skipped)로만 셉니다.
const METHOD = /^[A-Z]{3,7}$/u;
const SUBJECT = /^[A-Za-z0-9._:-]{1,64}$/u;
const DEVICE = /^[A-Za-z0-9._:-]{1,64}$/u;
const WINDOW_MS = 10 * 60 * 1000;
const BURST_LIMIT = 120;

export function readEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const read = [];
  let skipped = 0;
  for (const event of events) {
    const at = typeof event?.at === 'string' ? Date.parse(event.at) : Number.NaN;
    const method = event?.method;
    const subject = event?.identity?.sub;
    if (!Number.isFinite(at) || typeof method !== 'string' || !METHOD.test(method)
      || typeof subject !== 'string' || !SUBJECT.test(subject)) {
      skipped += 1;
      continue;
    }
    const network = event.network === 'usual' || event.network === 'unusual' ? event.network : null;
    const deviceId = typeof event.deviceId === 'string' && DEVICE.test(event.deviceId) && event.deviceRegistered === true
      ? event.deviceId : null;
    read.push(Object.freeze({ at, method, subject, network, deviceId }));
  }
  return { events: read, skipped };
}

// 규칙 하나: 같은 사용자의 GET이 어느 10분 구간에서 120건을 넘고(정확히 120건은 제외),
// 그 구간 안에 network가 'unusual'인 사건이 함께 있을 때만 의심으로 봅니다.
// 다량 조회만, 또는 낯선 네트워크만으로는 보지 않습니다. 의심이 없으면 null입니다.
function findSuspicious(read) {
  const bySubject = new Map();
  for (const event of read) {
    if (event.method !== 'GET') continue;
    if (!bySubject.has(event.subject)) bySubject.set(event.subject, []);
    bySubject.get(event.subject).push(event);
  }
  for (const [subject, list] of bySubject) {
    list.sort((a, b) => a.at - b.at);
    let start = 0;
    let unusual = 0;
    for (let end = 0; end < list.length; end += 1) {
      if (list[end].network === 'unusual') unusual += 1;
      while (list[end].at - list[start].at >= WINDOW_MS) {
        if (list[start].network === 'unusual') unusual -= 1;
        start += 1;
      }
      if (end - start + 1 > BURST_LIMIT && unusual > 0) return { subject, window: list.slice(start, end + 1) };
    }
  }
  return null;
}

// 의심 표시입니다. 회수 제안이 아닙니다.
export function detect(events) {
  const found = findSuspicious(readEvents(events).events);
  return found
    ? { action: 'flag_suspicious', reasonCode: 'burst_unusual_network', subject: found.subject }
    : { action: 'observe' };
}

// 별도 결과: 의심 구간의 모든 사건이 같은 등록 기기(deviceId, deviceRegistered true) 하나에서 왔을 때만
// 그 기기 한 개를 대상으로 회수를 '제안'합니다. 기기를 확인할 수 없거나 둘 이상이면 제안하지 않습니다.
// 이 함수는 회수를 실행하거나 기기 권한을 바꾸지 않으며 시각도 만들지 않습니다. 실제 회수와 시간은 심판이 확인합니다.
export function proposeRevocation(events) {
  const found = findSuspicious(readEvents(events).events);
  if (!found) return { action: 'observe' };
  const devices = new Set(found.window.map(event => event.deviceId));
  if (devices.size !== 1 || devices.has(null)) return { action: 'observe' };
  return { action: 'propose_revocation', reasonCode: 'burst_unusual_network', subject: found.subject, deviceId: [...devices][0] };
}
