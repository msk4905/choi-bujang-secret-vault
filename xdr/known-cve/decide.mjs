// 알려진 취약점(CVE-2021-44228 형태) 악용 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/known-cve/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'kc.jndi-in-header',
    name: '요청 머리글 안의 원격 조회 구문',
    condition: '요청 머리글(data.useragent 등)에 jndi 형태의 원격 조회 구문(조회 방식 표기와 외부 주소가 함께 있는 형태)이 완전하게 들어 있습니다. 표기는 rule.description 에서도 읽습니다. 머리글에 중괄호만 있거나 \'jndi\'라는 단어만 있는 것은 구문이 아닙니다. 반복 횟수는 data.count 이며 기준값은 연습 경보를 보고 학생이 정합니다.',
    basis: 'CVE-2021-44228·T1190: 공격자가 외부에 열린 앱의 머리글에 조회 구문을 실어 보내면, 취약한 로그 라이브러리가 그 값을 기록하다 외부 주소의 코드를 불러올 수 있습니다.',
  }),
  Object.freeze({
    id: 'kc.jndi-in-param',
    name: '요청 인자 안의 원격 조회 구문',
    condition: '요청 주소의 인자(data.url 의 ? 뒤)에 jndi 형태의 원격 조회 구문이 완전하게 들어 있습니다. 같은 srcip의 반복 횟수는 data.count, 표기는 rule.description 에서 읽습니다. 취약점 번호(CVE-2021-44228)나 \'jndi\'라는 글자만 검색어로 들어온 요청, 잘린 조회 형태는 구문이 아닙니다. 반복 기준값은 연습 경보를 보고 학생이 정합니다.',
    basis: 'CVE-2021-44228·T1190: 공격자가 외부에 열린 앱의 요청 인자에 조회 구문을 끼워 넣어 취약한 로그 라이브러리가 기록하게 하려는 방식입니다.',
  }),
  Object.freeze({
    id: 'kc.scanner-trace',
    name: '알려진 취약점 점검 도구의 흔적',
    condition: '알려진 취약점을 점검하는 도구의 흔적이 rule.description 에 적혀 있고, 같은 경보에 위 두 패턴의 원격 조회 구문이 함께 있습니다. 점검 도구와 이름만 비슷한 수업용 프로그램이 한 번 보인 것, 취약점 목록 문서를 연 것은 흔적이 아닙니다. 흔적만으로는 공격으로 보지 않고 위 패턴의 보조 신호로만 씁니다.',
    basis: 'T1190: 공격자는 공개 취약점을 노린 요청을 보내기 전후에 점검 도구로 열린 앱을 훑으며, 이 흔적은 조회 구문과 함께 있을 때만 근거가 됩니다(연습 경보 kc-05).',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const REPEAT_MANY = 8; // 이 횟수 이상 반복되면 뚜렷한 반복으로 봅니다.
const REPEAT_SOME = 3;
const MAX_TEXT = 2000; // 아주 긴 값은 앞부분만 봅니다.

// 완전한 조회 구문: ${jndi:<방식>://<주소> 형태. 닫는 괄호는 없어도 됩니다.
const FULL_SYNTAX = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|nis|corba|https?):\/\/[^\s}]+/;
// 구문은 아니지만 관련 있어 보이는 말 (애매한 신호)
const WORD_JNDI = /jndi/;
const WORD_CVE = /cve-2021-44228|log4j|log4shell/;
const BRACE = /\$\{|\}/;
const SCANNER_TEXT = /점검\s*(?:도구|흔적)|취약점\s*점검|스캐너/;
const WEAK_TEXT = /cve-2021-44228|취약점|라이브러리|조회\s*형태|중괄호|jndi/i;

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

// 소문자로 바꾸고, 한 번 더 풀어 이중 인코딩을 잡고, ${lower:j} · ${::-j} 같은 감싸기를 벗깁니다.
function normalize(value) {
  if (typeof value !== 'string') return '';
  let text = safeDecode(safeDecode(value.slice(0, MAX_TEXT))).toLowerCase();
  for (let i = 0; i < 3; i += 1) {
    const next = text
      .replace(/\$\{\s*(?:lower|upper)\s*:\s*([^}]*)\}/g, '$1')
      .replace(/\$\{[^}:]*:-([^}]*)\}/g, '$1');
    if (next === text) break;
    text = next;
  }
  return text;
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

function round2(value) {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

export function decide(alert) {
  if (alert === null || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니어서 기록만 합니다.' };
  }
  const header = normalize(alert?.data?.useragent);
  const url = normalize(alert?.data?.url);
  const text = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, MAX_TEXT) : '';
  const count = toCount(alert?.data?.count);

  const inHeader = FULL_SYNTAX.test(header);
  const inParam = FULL_SYNTAX.test(url);

  // 뚜렷한 경우: 머리글이나 주소에 완전한 조회 구문이 있습니다.
  if (inHeader || inParam) {
    let score = 0.9;
    if (inHeader && inParam) score += 0.04;
    if (count >= REPEAT_MANY) score += 0.04;
    else if (count >= REPEAT_SOME) score += 0.02;
    const trace = SCANNER_TEXT.test(text);
    if (trace) score += 0.03;
    const names = [];
    if (inHeader) names.push(PATTERNS[0].name);
    if (inParam) names.push(PATTERNS[1].name);
    if (trace) names.push(PATTERNS[2].name);
    const confidence = round2(Math.min(0.99, score));
    return { action: actionFor(confidence), confidence, reason: names.join(' + ') };
  }

  // 애매한 경우: 구문은 없고 관련 있어 보이는 말이나 조각만 있습니다.
  const weak = [];
  if (WORD_JNDI.test(header) || WORD_CVE.test(header) || BRACE.test(header)) {
    weak.push({ kind: 'header', name: PATTERNS[0].name });
  }
  if (WORD_JNDI.test(url) || WORD_CVE.test(url)) {
    weak.push({ kind: 'param', name: PATTERNS[1].name });
  }
  if (SCANNER_TEXT.test(text)) weak.push({ kind: 'scanner', name: PATTERNS[2].name });
  if (weak.length === 0 && WEAK_TEXT.test(text)) {
    weak.push({ kind: 'text', name: /머리글/.test(text) ? PATTERNS[0].name : PATTERNS[1].name });
  }

  if (weak.length === 0) {
    return { action: 'record', confidence: 0.1, reason: '맞는 패턴이 뚜렷하지 않아 기록만 합니다.' };
  }
  let score = 0.55 + 0.05 * (weak.length - 1);
  if (count >= 2) score += 0.03;
  const confidence = round2(Math.min(0.8, score));
  return {
    action: actionFor(confidence),
    confidence,
    reason: `${weak[0].name} (일부만 맞아 애매함)`,
  };
}
