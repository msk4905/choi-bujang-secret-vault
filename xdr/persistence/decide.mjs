// 몰래 심어진 프로그램(서비스·예약 작업·시작 폴더) 판정기입니다. 이 파일 하나로 혼자 계산해 답합니다.
// 다른 파일·패키지를 가져오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않습니다.
// 아래 PATTERNS 는 xdr/persistence/patterns.json 의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'ps.unsigned-new-service',
    name: '서명 없는 새 서비스 등록',
    condition: 'rule.description 에 서명이 없거나 평소 목록에 없는 서비스가 새로 등록되거나 실행 파일이 바뀌었다고 적혀 있고, rule.mitre 에 T1543 이 있습니다. data.path 가 있으면 임시 폴더(Temp)나 사용자 앱 데이터 아래 실행 파일을 가리키는지 함께 봅니다. 같은 srcip 의 연속 등록 횟수는 data.count 이며 기준값은 연습 경보를 보고 학생이 정합니다. 서명된 기존 수업 도구 서비스가 실행 중이거나 한 번 멈췄다 같은 파일로 다시 시작된 것, 서비스 설명만 바뀐 것은 해당하지 않습니다.',
    basis: 'T1543: 공격자는 서비스를 새로 만들거나 바꿔 재부팅 뒤에도 자기 프로그램이 다시 실행되게 합니다. 서명 없음과 임시 폴더 경로가 함께 있을 때 근거가 강해집니다.',
  }),
  Object.freeze({
    id: 'ps.unfamiliar-scheduled-task',
    name: '낯선 예약 작업 생성',
    condition: 'rule.description 에 처음 보는 예약 작업이 만들어졌거나 작업 이름이 임의 문자열이라고 적혀 있고, rule.mitre 에 T1053 이 있습니다. data.path 가 임시 폴더의 프로그램을 가리키거나 실행 시각이 수업 시간 밖이면 근거가 강해집니다. 운영체제·정의 업데이트처럼 평소 시각 그대로인 기존 작업, 수업 시간에 사용자가 만든 작업 하나만으로는 해당하지 않으며, 서명을 확인하지 못했다는 말만으로도 확정하지 않습니다.',
    basis: 'T1053: 공격자는 예약 작업으로 프로그램을 정해진 때마다 또는 부팅 때 실행시켜 접속 없이도 자리를 유지합니다.',
  }),
  Object.freeze({
    id: 'ps.startup-folder-change',
    name: '시작 폴더·시작 항목 변경',
    condition: 'rule.description 에 시작 폴더 또는 시작 프로그램에 평소 목록에 없는 프로그램이 추가됐다고 적혀 있고, data.path 가 Startup 폴더 아래 실행 파일을 가리킵니다. 같은 임시 파일을 예약 작업도 함께 가리키면(rule.mitre 에 T1543 과 T1053 이 함께 있으면) 근거가 강해집니다. 목록을 읽기만 한 것, 수업 도구 이름의 항목 하나, 변경 뒤 이어서 실행된 기록이 없는 변경 1건은 해당하지 않습니다.',
    basis: 'T1543(연습 경보가 시작 폴더 변경에 붙인 표기): 로그온 때 자동으로 열리는 자리에 프로그램을 두면 다시 켜도 남습니다. ATT&CK 정식 분류는 T1547.001(Startup Folder)입니다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const REPEAT_SOME = 3; // 연속 등록이 이 횟수 이상이면 뚜렷한 반복으로 봅니다.
const MAX_TEXT = 2000; // 아주 긴 값은 앞부분만 봅니다.

// 설명(rule.description)에서 읽는 신호
const SERVICE = /서비스/;
const TASK = /예약\s*작업/;
const STARTUP = /시작\s*(?:폴더|프로그램|항목)/;
const UNSIGNED = /서명\s*(?:이|은)?\s*없/;
const UNKNOWN_SIG = /서명은?\s*(?:확인되지|아직)/;
const UNFAMILIAR = /평소\s*목록에\s*없|처음\s*보는|임의\s*문자열|새\s*서비스|새로\s*등록/;
const PERSIST = /다시\s*켜도\s*남/;
const CHANGED_EXE = /실행\s*파일이\s*바뀌/;
const CHANGE_VERB = /추가|등록|변경|가리킵/;
const OFF_HOURS = /수업\s*시간\s*밖/;
const TEMP_TEXT = /임시\s*폴더/;
const EXE_TEXT = /실행\s*파일/;
const NO_FOLLOWUP = /기록은?\s*없/;
// 평소의 정상 작업이라는 말: 읽기만 함, 서명된 기존 서비스, 평소 시각·저장소, 끝난 작업, 로그인·로그아웃
const BENIGN = /읽기만|서명된|평소\s*(?:시각|저장소)|마쳤|로그인|로그아웃|화면이\s*열|정의\s*업데이트|운영체제\s*업데이트/;
// 경로(data.path)에서 읽는 신호
const TEMP_PATH = /[\\/]temp[\\/]/i;
const STARTUP_PATH = /[\\/]startup[\\/]/i;

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
  const path = typeof alert?.data?.path === 'string' ? alert.data.path.slice(0, MAX_TEXT) : '';
  const mitre = Array.isArray(alert?.rule?.mitre) ? alert.rule.mitre.filter((id) => typeof id === 'string') : [];
  const count = toCount(alert?.data?.count);

  const temp = TEMP_PATH.test(path) || TEMP_TEXT.test(text);
  const startupPath = STARTUP_PATH.test(path);
  const unsigned = UNSIGNED.test(text);
  const unfamiliar = UNFAMILIAR.test(text);

  // 패턴마다 "찾는 조건"이 갖춰졌는지 봅니다. 서명된 기존 항목, 읽기만 한 것은 조건에 걸리지 않습니다.
  const service = SERVICE.test(text) && (unsigned || unfamiliar || PERSIST.test(text) || CHANGED_EXE.test(text));
  const startup = STARTUP.test(text) && CHANGE_VERB.test(text) && !BENIGN.test(text);
  const task = TASK.test(text) && (unfamiliar || (STARTUP.test(text) && temp));

  const matches = [];
  if (service) matches.push({ pattern: PATTERNS[0], tech: ['T1543'], path: false });
  if (task) matches.push({ pattern: PATTERNS[1], tech: ['T1053'], path: false });
  if (startup) matches.push({ pattern: PATTERNS[2], tech: ['T1543', 'T1547'], path: startupPath });

  // 뚜렷한 경우: 패턴의 조건이 갖춰졌습니다. 근거가 겹칠수록 확신도가 올라갑니다.
  if (matches.length > 0) {
    const scores = matches.map((m) => {
      let score = 0.7;
      if (temp) score += 0.1;
      if (m.path) score += 0.1;
      if (unsigned) score += 0.08;
      if (unfamiliar) score += 0.05;
      if (PERSIST.test(text)) score += 0.05;
      if (OFF_HOURS.test(text)) score += 0.05;
      if (m.tech.some((id) => mitre.includes(id))) score += 0.03;
      if (count >= REPEAT_SOME) score += 0.05;
      if (NO_FOLLOWUP.test(text)) score -= 0.1;
      return score;
    });
    const best = Math.max(...scores) + 0.05 * (matches.length - 1);
    const confidence = round2(Math.min(0.99, best));
    return {
      action: actionFor(confidence),
      confidence,
      reason: matches.map((m) => m.pattern.name).join(' + '),
    };
  }

  // 정상으로 보이는 경우: 평소 작업이라는 말이 있고, 위 조건에는 걸리지 않았습니다.
  if (BENIGN.test(text)) {
    return { action: 'record', confidence: 0.1, reason: '평소 작업으로 보여 기록만 합니다.' };
  }

  // 애매한 경우: 서비스·예약 작업·시작 항목 이야기가 있지만 조건이 일부만 맞습니다.
  const weak = [];
  if (SERVICE.test(text)) weak.push(PATTERNS[0]);
  if (TASK.test(text)) weak.push(PATTERNS[1]);
  if (STARTUP.test(text)) weak.push(PATTERNS[2]);
  if (weak.length === 0 && temp && EXE_TEXT.test(text)) weak.push(PATTERNS[0]);
  if (weak.length === 0) {
    return { action: 'record', confidence: 0.1, reason: '맞는 패턴이 뚜렷하지 않아 기록만 합니다.' };
  }
  let score = 0.5;
  if (temp) score += 0.05;
  if (UNKNOWN_SIG.test(text)) score += 0.05;
  if (mitre.includes('T1543') || mitre.includes('T1053')) score += 0.03;
  const confidence = round2(Math.min(0.8, score));
  return {
    action: actionFor(confidence),
    confidence,
    reason: `${weak[0].name} (일부만 맞아 애매함)`,
  };
}
