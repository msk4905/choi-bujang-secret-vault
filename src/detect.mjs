// 9단계에서 학생이 채우는 탐지 함수입니다. 이 기본값은 어떤 접속도 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.

// docs/DETECT_EVENTS.md 계약의 세 값(at, method, identity.sub)만 꺼냅니다.
// 그 밖의 칸(메모 내용·토큰·이름 등)은 복사하지 않고 버립니다. 이 계약에는 기기 값이 없으므로 만들지 않습니다.
// 형식이 틀린 사건은 값을 출력하지 않고 개수(skipped)로만 셉니다.
const METHOD = /^[A-Z]{3,7}$/u;
const SUBJECT = /^[A-Za-z0-9._:-]{1,64}$/u;

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
    read.push(Object.freeze({ at, method, subject }));
  }
  return { events: read, skipped };
}

export function detect(events) {
  readEvents(events);
  return { action: 'observe' };
}
