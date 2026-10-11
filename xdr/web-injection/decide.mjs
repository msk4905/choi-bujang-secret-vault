// 웹 주입 공격 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/web-injection/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'wi.sql-in-param',
    name: '요청 인자 안의 SQL 구문',
    condition: '요청 주소의 인자(data.url 의 ? 뒤)에 SQL 구문 표기가 들어 있고, 같은 srcip에서 반복됩니다. 반복 횟수는 data.count, 어떤 표기인지는 rule.description 에서 읽습니다. 한 번뿐이거나 수업 단어로만 나온 경우는 공격으로 보지 않습니다.',
    basis: 'T1190: 공격자가 외부에 열린 앱의 요청 인자에 SQL 구문을 끼워 넣어 데이터베이스 조회를 바꾸려는 방식입니다.',
  }),
  Object.freeze({
    id: 'wi.script-tag-in-param',
    name: '요청 인자 안의 스크립트 태그',
    condition: '요청 주소의 인자(data.url 의 ? 뒤)에 스크립트 태그 삽입 표기가 들어 있고, 같은 srcip에서 반복됩니다. 반복 횟수는 data.count, 표기는 rule.description 에서 읽습니다. 수업 단어로 \'스크립트\'가 한 번 나온 것은 삽입 표식이 아닙니다.',
    basis: 'T1190: 공격자가 외부에 열린 앱이 받는 입력에 스크립트를 심어 앱이 그대로 실행하거나 돌려보내게 하려는 방식입니다.',
  }),
  Object.freeze({
    id: 'wi.path-traversal-repeat',
    name: '경로 거슬러 올라가기(../) 반복',
    condition: '요청 주소의 경로 인자(data.url 의 path·name 등)에 상위 폴더로 올라가는 표기(../)가 여러 단계 반복됩니다. 같은 srcip의 반복 횟수는 data.count, 표기는 rule.description 에서 읽습니다. 경로에 \'up\' 같은 글자가 한 번 있는 것은 거슬러 올라가기가 아닙니다.',
    basis: 'T1190: 공격자가 외부에 열린 앱의 파일 경로 인자를 이용해 허용된 폴더 밖의 파일에 닿으려는 방식입니다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const REPEAT_MANY = 8; // 이 횟수 이상 반복되면 뚜렷한 반복으로 봅니다.
const REPEAT_SOME = 3;

// 패턴마다 요청 인자에서 찾을 표기와 설명에서 찾을 말
const SIGNALS = Object.freeze([
  Object.freeze({
    pattern: PATTERNS[0],
    inUrl: /union[\s+]+select|select[\s+]+.+[\s+]from|['"][\s+]*or[\s+]|\bor[\s+]+1[\s+]*=[\s+]*1|;[\s+]*drop\b|--[\s+]|doc-sql/,
    inText: /SQL\s*(구문|표식)|데이터베이스\s*조회를\s*이어/i,
  }),
  Object.freeze({
    pattern: PATTERNS[1],
    inUrl: /<[\s+]*script|javascript:|onerror[\s+]*=|doc-script/,
    inText: /스크립트\s*(삽입|표식|태그)/,
  }),
  Object.freeze({
    pattern: PATTERNS[2],
    inUrl: /(\.\.[/\\]){2,}|\.\.[/\\]\.\.|doc-up/,
    inText: /경로를\s*여러\s*단계\s*거슬러|경로\s*이탈/,
  }),
]);

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// 요청 주소의 ? 뒤 인자만 소문자로 풀어서 봅니다. 한 번 더 풀어 이중 인코딩도 잡습니다.
function paramText(alert) {
  const url = String(alert?.data?.url ?? '');
  const at = url.indexOf('?');
  if (at < 0) return '';
  return safeDecode(safeDecode(url.slice(at + 1))).toLowerCase();
}

function repeatScore(count) {
  if (count >= REPEAT_MANY) return 0.88 + Math.min(0.1, (count - REPEAT_MANY) * 0.01);
  if (count >= REPEAT_SOME) return 0.7;
  return 0.55;
}

// 패턴 하나와 경보가 얼마나 뚜렷하게 맞는지 0~1
function scorePattern(signal, params, text, count) {
  const hitUrl = signal.inUrl.test(params);
  const hitText = signal.inText.test(text);
  if (!hitUrl && !hitText) return 0;
  const both = hitUrl && hitText ? 0.01 : 0;
  return Math.min(0.99, repeatScore(count) + both);
}

// 이름 있는 패턴에 안 맞아도, 경보 자신이 T1190 표시를 달았다면 반복 정도로 애매함을 가립니다.
function scoreTagged(alert, count) {
  const tags = alert?.rule?.mitre;
  if (!Array.isArray(tags) || !tags.includes('T1190')) return 0;
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  if (count >= REPEAT_MANY && level >= 10) return 0.86;
  if (level >= 5) return 0.5 + Math.min(0.1, (level - 5) * 0.02);
  return 0.3;
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
  const count = toCount(alert?.data?.count);
  const params = paramText(alert);
  const text = String(alert?.rule?.description ?? '');

  let best = { score: 0, name: '' };
  for (const signal of SIGNALS) {
    const score = scorePattern(signal, params, text, count);
    if (score > best.score) best = { score, name: signal.pattern.name };
  }
  const tagged = scoreTagged(alert, count);
  if (tagged > best.score) {
    const many = count >= REPEAT_MANY;
    best = {
      score: tagged,
      name: many
        ? 'T1190 표시가 붙은 주입 표기 반복 (이름 있는 패턴 밖)'
        : 'T1190 표시가 붙은 반복 없는 애매한 표기 (이름 있는 패턴 밖)',
    };
  }

  const confidence = Math.round(Math.min(1, best.score) * 100) / 100;
  const action = actionFor(confidence);
  const reason = action === 'record'
    ? '맞는 패턴이 뚜렷하지 않아 기록만 합니다.'
    : best.name;
  return { action, confidence, reason };
}
