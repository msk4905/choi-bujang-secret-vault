// 권한 상승(관리자 그룹 추가·관리자 명령·업무 시간 밖 권한 사용) 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/privilege/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'pv.admin-group-add',
    name: '관리자 그룹 추가',
    condition: 'rule.description 에 평범한 계정(예: user01)이 관리자 그룹에 추가됐거나 들어갔다고 적혀 있고, data.group 이 administrators 입니다. rule.mitre 에 T1078 이 있고, 곧바로 권한 명령을 실행했거나(근거가 강해짐) 같은 주소에서 계정 여러 개가 한꺼번에 추가됐으면(data.count) 더 뚜렷합니다. 과제 그룹이나 수업 그룹 같은 관리자가 아닌 그룹에 추가된 것, 새 로컬 그룹 만들기, 그룹 목록·소속을 읽기만 한 것, 수업용 관리 계정(admin01)의 평소 로그인은 해당하지 않습니다.',
    basis: 'T1078: 공격자는 훔친 정상 계정을 관리자 그룹에 넣어 그 계정의 권한을 키웁니다. 평범한 계정이 관리자 그룹에 들어가는 것이 이 패턴의 핵심 신호입니다.',
  }),
  Object.freeze({
    id: 'pv.first-seen-admin-command',
    name: '처음 보는 관리자 명령',
    condition: 'rule.description 에 처음 보는 주소에서 관리자 명령이 실행됐거나, 세션이 관리자 권한으로 바뀌었거나, 다른 계정의 권한으로 관리자 명령을 실행했다고 적혀 있고, rule.mitre 에 T1068 이 있습니다. 방금 관리자가 된 계정이 곧바로 관리자 명령을 실행하면 근거가 강해집니다. 평소 주소에서 한 번 실행된 관리자 명령, 실패 1건으로 끝난 명령, 취소된 권한 상승 창, 권한 상승 1건 뒤 이어진 명령이 없는 것은 해당하지 않습니다.',
    basis: 'T1068: 공격자는 권한 상승 수단을 악용해 평소 쓰지 않던 관리자 권한으로 명령을 실행합니다. 연습 경보는 이 표기를 관리자 명령 경보에 붙였으며, 실제 취약점 악용 증거까지 담지는 않습니다.',
  }),
  Object.freeze({
    id: 'pv.off-hours-privilege-use',
    name: '업무 시간 밖 권한 사용',
    condition: 'rule.description 에 수업 시간 밖이거나 업무처럼 보이지 않는 시각에 관리자 그룹 추가·관리자 명령 같은 권한 사용이 있다고 적혀 있습니다. 처음 보는 주소이거나(pv.first-seen-admin-command 와 겹침) 그룹 추가와 명령이 같이 있으면 근거가 강해집니다. 수업 시간에 평소 주소에서 한 번 일어난 권한 사용, 수업 시간 안에 취소된 권한 상승은 해당하지 않으며, 시각만으로는 확정하지 않습니다.',
    basis: 'T1078: 훔친 정상 계정은 주인이 쓰지 않는 시각에 쓰이기 쉽습니다. 시각은 단독 증거가 아니라 위 두 패턴을 거드는 신호입니다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const MAX_TEXT = 2000; // 아주 긴 값은 앞부분만 봅니다.

// 설명(rule.description)에서 읽는 신호
const ADMIN_GROUP_TEXT = /관리자\s*그룹/;
const NOT_ADMIN_GROUP = /관리자\s*그룹은?\s*아닙/; // "관리자 그룹은 아닙니다" 같은 부정
const ADD_VERB = /추가|들어/;
const ADMIN_CMD = /관리자\s*명령|권한\s*명령/;
const COMMAND_RAN = /명령\s*실행/;
const SESSION_ELEVATED = /세션이\s*관리자\s*권한으로\s*바뀌/;
const FIRST_SEEN = /처음\s*보는|처음\s*봅/;
const OTHER_ACCOUNT = /다른\s*계정의\s*권한/;
const JUST_ADMIN = /방금\s*관리자|곧바로/;
const OFF_HOURS = /수업\s*시간\s*밖|업무처럼\s*보이지\s*않는/;
const REMOTE = /원격/;
const READ_ONLY = /읽기만|조회/; // 읽기만 한 것은 권한 사용이 아닙니다.
const PRIV_WORDS = /관리자\s*그룹|관리자\s*명령|권한\s*상승|권한\s*명령|관리자\s*권한/; // 애매한 경보에서 읽는 말

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  const text = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, MAX_TEXT) : '';
  const group = typeof alert?.data?.group === 'string' ? alert.data.group.slice(0, MAX_TEXT) : '';
  const mitre = Array.isArray(alert?.rule?.mitre) ? alert.rule.mitre.filter((id) => typeof id === 'string') : [];
  const count = toCount(alert?.data?.count);

  const readOnly = READ_ONLY.test(text);
  const firstSeen = FIRST_SEEN.test(text);
  const offHours = OFF_HOURS.test(text);

  // 패턴마다 "찾는 조건"이 갖춰졌는지 봅니다. 관리자가 아닌 그룹, 읽기만 한 것, 평소 주소의 한 번은 조건에 걸리지 않습니다.
  const groupAdd = !readOnly && (group === 'administrators'
    || (ADMIN_GROUP_TEXT.test(text) && !NOT_ADMIN_GROUP.test(text) && ADD_VERB.test(text)));
  const adminCmd = ADMIN_CMD.test(text) && !readOnly;
  const justAdmin = JUST_ADMIN.test(text);
  const otherAccount = OTHER_ACCOUNT.test(text);
  const command = (adminCmd && (firstSeen || otherAccount || justAdmin || groupAdd))
    || (SESSION_ELEVATED.test(text) && firstSeen);
  const offHoursUse = offHours && (groupAdd || command || COMMAND_RAN.test(text));

  const matches = [];
  if (groupAdd) matches.push({ pattern: PATTERNS[0], tech: 'T1078' });
  if (command) matches.push({ pattern: PATTERNS[1], tech: 'T1068' });
  if (offHoursUse) matches.push({ pattern: PATTERNS[2], tech: 'T1078' });

  // 뚜렷한 경우: 패턴의 조건이 갖춰졌습니다. 근거가 겹칠수록 확신도가 올라갑니다.
  if (matches.length > 0) {
    let score = 0.8;
    if (matches.some((m) => mitre.includes(m.tech))) score += 0.03;
    if (firstSeen) score += 0.05;
    if (otherAccount) score += 0.05;
    if (justAdmin) score += 0.05;
    if (offHours) score += 0.05;
    if (REMOTE.test(text)) score += 0.05;
    if (count >= 2) score += 0.05; // 같은 주소에서 여러 계정·반복
    score += 0.05 * (matches.length - 1);
    const confidence = round2(Math.min(0.99, score));
    return {
      action: actionFor(confidence),
      confidence,
      reason: matches.map((m) => m.pattern.name).join(' + '),
    };
  }

  // 애매한 경우: 권한 이야기가 있거나 경보 자신이 T1068·T1078 표시를 달았지만 조건이 일부만 맞습니다.
  const tagged = mitre.includes('T1068') || mitre.includes('T1078');
  if (tagged || (PRIV_WORDS.test(text) && !readOnly)) {
    const weak = mitre.includes('T1068') && !mitre.includes('T1078') ? PATTERNS[1]
      : ADMIN_CMD.test(text) ? PATTERNS[1] : PATTERNS[0];
    let score = 0.5;
    if (tagged) score += 0.05;
    if (PRIV_WORDS.test(text)) score += 0.05;
    const confidence = round2(Math.min(0.8, score));
    return {
      action: actionFor(confidence),
      confidence,
      reason: `${weak.name} (일부만 맞아 애매함)`,
    };
  }

  // 정상으로 보이는 경우: 권한 표시도 권한 이야기도 없는 평소 작업입니다.
  return { action: 'record', confidence: 0.1, reason: '평소 작업으로 보여 기록만 합니다.' };
}
