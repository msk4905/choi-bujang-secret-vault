// 무차별 로그인 공격 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/brute-force/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'bf.burst-same-source',
    name: '같은 주소의 로그인 실패 연속',
    condition: '같은 srcip에서 짧은 시간 안에 로그인 실패가 연속으로 쌓입니다. 건수는 data.count, 시간 폭은 rule.description 에서 읽습니다.',
    basis: 'T1110.001 Password Guessing: 공격자가 한 계정에 비밀번호를 반복해 추측하며 시도하는 방식입니다.',
  }),
  Object.freeze({
    id: 'bf.spray-many-accounts',
    name: '여러 계정에 같은 비밀번호 대입',
    condition: '같은 srcip가 서로 다른 계정 여러 개에 같은 비밀번호를 차례로 넣습니다. 계정 수는 data.accounts 의 쉼표 목록에서 셉니다.',
    basis: 'T1110.003 Password Spraying: 흔한 비밀번호 하나를 많은 계정에 대입해 계정 잠금을 피하는 방식입니다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 계정 수: data.accounts 쉼표 목록, 없으면 설명의 "계정 N개"
function countAccounts(alert) {
  const list = alert?.data?.accounts;
  if (typeof list === 'string' && list.trim()) {
    return new Set(list.split(',').map((s) => s.trim()).filter(Boolean)).size;
  }
  const m = /계정\s*(\d+)\s*개/.exec(String(alert?.rule?.description ?? ''));
  return m ? Number(m[1]) : 0;
}

// 패턴 하나와 경보가 얼마나 뚜렷하게 맞는지 0~1
function scoreBurst(alert) {
  const failures = toCount(alert?.data?.count);
  if (failures >= 30) return 0.9 + Math.min(0.09, (failures - 30) / 1000);
  if (failures >= 8) return 0.6;
  if (failures >= 3) return 0.5;
  return failures > 0 ? 0.1 : 0;
}

function scoreSpray(alert) {
  const accounts = countAccounts(alert);
  if (accounts >= 5) return 0.9 + Math.min(0.09, accounts * 0.002);
  if (accounts >= 2) return 0.55;
  return 0;
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
    { pattern: PATTERNS[0], score: scoreBurst(alert) },
    { pattern: PATTERNS[1], score: scoreSpray(alert) },
  ].sort((a, b) => b.score - a.score)[0];

  const confidence = Math.round(Math.min(1, scored.score) * 100) / 100;
  const action = actionFor(confidence);
  const reason = action === 'record'
    ? '맞는 패턴이 뚜렷하지 않아 기록만 합니다.'
    : `${scored.pattern.name} (${scored.pattern.id})`;
  return { action, confidence, reason };
}
