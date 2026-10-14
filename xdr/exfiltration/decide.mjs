// 자료 빼돌리기 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/exfiltration/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'ex.large-to-new-destination',
    name: '처음 보는 목적지로 대용량 전송',
    condition: '평소 쓰지 않던 목적지(dstip)로 전송량(data.bytes)이 크거나 파일 수(data.files)·반복 횟수(data.count)가 많습니다. 목적지가 처음이라는 표시는 rule.description 에서 읽습니다.',
    basis: 'T1041·T1048: 공격자는 이미 열린 명령 통로나 평소와 다른 프로토콜·경로로 자료를 한꺼번에 밖으로 보냅니다.',
  }),
  Object.freeze({
    id: 'ex.archive-off-hours',
    name: '업무 시간 밖 압축 파일 반출',
    condition: '수업·업무 시간 밖에 압축 파일이 외부 주소로 나갔습니다. 시간대와 압축 파일 여부는 rule.description 에서 읽고, 전송량은 data.bytes 로 함께 봅니다.',
    basis: 'T1048: 공격자는 자료를 압축해 묶은 뒤 눈에 덜 띄는 시간대에 다른 경로로 반출합니다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;

const MB = 1_000_000;
const NEW_DESTINATION = /처음\s*(보|봅)|평소에\s*쓰지\s*않|평소와\s*다른\s*주소|외부\s*주소/;
const VOLUME_ANOMALY = /평소보다|한\s*번\s*(높|늘)/;
const OFF_HOURS = /(수업|업무)\s*시간\s*밖/;
const ARCHIVE = /압축/;

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function describe(alert) {
  return String(alert?.rule?.description ?? '');
}

// 패턴 하나와 경보가 얼마나 뚜렷하게 맞는지 0~1
function scoreLargeToNew(alert) {
  // 보낸 목적지가 없으면 전송이 아니므로 맞지 않습니다.
  if (!alert?.data?.dstip) return 0;
  const bytes = toCount(alert?.data?.bytes);
  const files = toCount(alert?.data?.files);
  const repeats = toCount(alert?.data?.count);
  const text = describe(alert);

  let score = 0;
  if (bytes >= 50 * MB) score = 0.75;
  else if (bytes >= 5 * MB) score = 0.4;
  else if (bytes >= 1 * MB) score = 0.25;
  else if (bytes >= 100_000) score = 0.1;
  if (score === 0) return 0;

  if (NEW_DESTINATION.test(text)) score += 0.15;
  if (VOLUME_ANOMALY.test(text)) score += 0.1;
  if (score >= 0.75 && (files >= 50 || repeats >= 5)) score += 0.1;
  return Math.min(0.99, score);
}

function scoreArchiveOffHours(alert) {
  if (!alert?.data?.dstip) return 0;
  const text = describe(alert);
  if (!ARCHIVE.test(text)) return 0;
  const bytes = toCount(alert?.data?.bytes);
  if (bytes < 1 * MB) return 0;

  let score = 0.5;
  if (OFF_HOURS.test(text)) score += 0.2;
  if (bytes >= 50 * MB) score += 0.2;
  return Math.min(0.99, score);
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

export function decide(alert) {
  if (alert === null || typeof alert !== 'object') {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다.' };
  }
  const scored = [
    { pattern: PATTERNS[0], score: scoreLargeToNew(alert) },
    { pattern: PATTERNS[1], score: scoreArchiveOffHours(alert) },
  ].sort((a, b) => b.score - a.score)[0];

  const confidence = Math.round(Math.min(1, scored.score) * 100) / 100;
  const action = actionFor(confidence);
  const reason = action === 'record'
    ? '맞는 패턴이 뚜렷하지 않아 기록만 합니다.'
    : `${scored.pattern.name} (${scored.pattern.id})`;
  return { action, confidence, reason };
}
