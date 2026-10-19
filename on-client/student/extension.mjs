// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.

// ---------- 13단계 보조 함수: 로그인 사용자·기기·세션 표시 (renderIdentity 전용) ----------
// DOM은 createElement 와 textContent 로만 만든다. 서버가 준 값은 HTML 로 해석하지 않는다.
// 이전 값을 모듈 안에 저장하지 않는다. 호출할 때마다 받은 입력만으로 새 요소를 만든다.

const MODE_TEXT = {
  connected: '연결됨(connected)',
  demo: '예제 자료(demo) · 실제 연결이 아닙니다',
  disconnected: '연결 없음(disconnected)',
  unknown: '확인 불가(unknown) · 연결 상태를 알 수 없습니다',
};

// note 가 빈 값이면 정상 상태이고, 값이 있으면 정상처럼 보이면 안 되는 상태다.
const DEVICE_TEXT = {
  compliant: { label: '보안 기준 충족', note: '' },
  noncompliant: { label: '보안 기준 미충족', note: '점검이 필요합니다. 정상 상태가 아닙니다.' },
  unknown: { label: '확인 불가', note: '서버가 상태를 확인하지 못했습니다. 정상으로 간주하지 마세요.' },
};

const SESSION_TEXT = {
  active: { label: '활성', note: '' },
  expired: { label: '만료', note: '이미 끝난 세션입니다. 정상 상태가 아닙니다.' },
  revoked: { label: '철회됨', note: '철회된 세션입니다. 정상 상태가 아닙니다.' },
  unknown: { label: '확인 불가', note: '서버가 상태를 확인하지 못했습니다. 정상으로 간주하지 마세요.' },
};

function makeNode(tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function plainText(value, fallback = '확인 불가') {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

// 상태 코드를 뜻과 함께 보여 준다. 모르는 값은 확인 불가로 읽고, 받은 원래 값은 괄호에 남긴다.
function describeState(table, value) {
  const raw = typeof value === 'string' && value ? value : 'unknown';
  const known = Object.hasOwn(table, raw);
  const entry = known ? table[raw] : table.unknown;
  return { text: `${entry.label}(${raw})`, note: entry.note, normal: known && entry.note === '' };
}

function stateBadge(table, value) {
  const state = describeState(table, value);
  const wrapper = makeNode('span');
  if (state.normal) {
    wrapper.append(makeNode('span', state.text, 'muted'));
    return wrapper;
  }
  const kind = String(value) === 'unknown' || !Object.hasOwn(table, String(value)) ? 'state state-empty' : 'state state-error';
  wrapper.append(makeNode('span', `주의 · ${state.text}`, kind));
  wrapper.append(makeNode('span', ` ${state.note}`, 'muted'));
  return wrapper;
}

function modeNote(resource) {
  const mode = resource && resource.mode;
  if (resource && resource.status === 'loading' && !mode) return null;
  const key = Object.hasOwn(MODE_TEXT, mode) ? mode : 'unknown';
  const className = key === 'demo' ? 'tag tag-demo' : key === 'connected' ? 'muted' : 'state state-empty';
  return makeNode('p', MODE_TEXT[key], className);
}

// loading·error·형식 오류면 알림 요소를, 정상(ok)이면 null 을 돌려준다. 이때 이전 값은 그리지 않는다.
function resourceNotice(resource, name) {
  if (!resource || typeof resource !== 'object') {
    return makeNode('p', `${name}: 확인 불가 (자료를 받지 못했습니다)`, 'state state-error');
  }
  if (resource.status === 'loading') {
    const loading = makeNode('p', `${name}: 불러오는 중…`, 'state state-loading');
    loading.setAttribute('role', 'status');
    return loading;
  }
  if (resource.status === 'error') {
    const error = resource.error && typeof resource.error === 'object' ? resource.error : {};
    const unverified = error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED';
    const message = plainText(error.message, '서버가 자세한 내용을 알려 주지 않았습니다.');
    return makeNode('p', `${name}: ${unverified ? '확인 불가' : '연결 실패'}: ${message}`, 'state state-error');
  }
  if (resource.status !== 'ok') {
    return makeNode('p', `${name}: 확인 불가 (알 수 없는 상태)`, 'state state-error');
  }
  return null;
}

function identitySection(me) {
  const section = makeNode('section');
  section.append(makeNode('h3', '로그인 사용자·기기·세션'));
  const mode = modeNote(me);
  if (mode) section.append(mode);
  const notice = resourceNotice(me, '로그인 정보');
  if (notice) {
    section.append(notice);
    return section;
  }
  const data = me.data && typeof me.data === 'object' ? me.data : {};
  const user = data.user && typeof data.user === 'object' ? data.user : {};
  const device = data.device && typeof data.device === 'object' ? data.device : {};
  const session = data.session && typeof data.session === 'object' ? data.session : {};

  const list = makeNode('dl', null, 'identity');
  const userValue = makeNode('dd');
  userValue.append(makeNode('span', plainText(user.label, plainText(user.id)), 'item-title'));
  if (typeof user.id === 'string' && user.id) userValue.append(makeNode('span', ` (${user.id})`, 'muted'));

  const deviceValue = makeNode('dd');
  deviceValue.append(makeNode('span', plainText(device.label, plainText(device.id)), 'item-title'));
  if (typeof device.id === 'string' && device.id) deviceValue.append(makeNode('span', ` (${device.id}) `, 'muted'));
  deviceValue.append(stateBadge(DEVICE_TEXT, device.status));

  const sessionValue = makeNode('dd');
  sessionValue.append(makeNode('span', plainText(session.id), 'item-title'));
  sessionValue.append(makeNode('span', ' '));
  sessionValue.append(stateBadge(SESSION_TEXT, session.status));

  list.append(makeNode('dt', '사용자'), userValue, makeNode('dt', '현재 기기'), deviceValue, makeNode('dt', '현재 세션'), sessionValue);
  section.append(list);
  return section;
}

function listSection(resource, title, name, emptyText, describeItem) {
  const section = makeNode('section');
  section.append(makeNode('h3', title));
  const mode = modeNote(resource);
  if (mode) section.append(mode);
  const notice = resourceNotice(resource, name);
  if (notice) {
    section.append(notice);
    return section;
  }
  if (!Array.isArray(resource.data)) {
    section.append(makeNode('p', `${name}: 확인 불가 (응답 형식 불일치)`, 'state state-error'));
    return section;
  }
  if (resource.data.length === 0) {
    section.append(makeNode('p', emptyText, 'state state-empty'));
    return section;
  }
  const list = makeNode('ul', null, 'plain-list');
  for (const item of resource.data) {
    const row = makeNode('li');
    describeItem(row, item && typeof item === 'object' ? item : {});
    list.append(row);
  }
  section.append(list);
  return section;
}

function deviceSection(devices) {
  const section = listSection(devices, '기기 목록', '기기 목록', '표시할 기기가 없습니다.', (row, device) => {
    row.append(makeNode('span', plainText(device.label, plainText(device.id)), 'item-title'));
    row.append(stateBadge(DEVICE_TEXT, device.status));
  });
  if (devices && devices.status === 'ok' && Array.isArray(devices.data) && devices.data.length > 0) {
    section.append(makeNode('p', '서버가 알려 준 보안 기준 충족 상태만 표시합니다. 악성코드 검사나 치료 기능이 아닙니다.', 'muted'));
  }
  return section;
}

function sessionSection(sessions) {
  return listSection(sessions, '세션 목록', '세션 목록', '표시할 세션이 없습니다.', (row, session) => {
    row.append(makeNode('span', plainText(session.id), 'item-title'));
    row.append(stateBadge(SESSION_TEXT, session.status));
  });
}

export function createStudentView() {
  return {
    renderIdentity({ me, devices, sessions } = {}) {
      const root = makeNode('div', null, 'student-identity');
      root.append(identitySection(me), deviceSection(devices), sessionSection(sessions));
      return root;
    },
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
