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

// ---------- 14단계 보조 함수: 업무 앱 접속 판정 표시 (renderDecision 전용) ----------
// 13단계 보조 함수(makeNode, plainText, MODE_TEXT, modeNote)는 바꾸지 않고 그대로 쓴다.
// DOM은 createElement 와 textContent 로만 만든다. 이전 판정을 모듈 안에 저장하지 않는다.
// 호출할 때마다 받은 입력만으로 새 요소를 만들기 때문에, 새 입력이 오면 이전 판정은 남지 않는다.

// 판정은 한국어 뜻과 원래 값을 함께 보여 준다. 목록에 없는 값은 unknown 으로 읽는다.
const DECISION_TEXT = {
  allow: {
    label: '허용',
    className: 'decision decision-allow',
    note: '서버 정책상 접근이 허용되었습니다. 실제 앱 접속 성공을 보장하지는 않습니다.',
  },
  deny: {
    label: '거부',
    className: 'decision decision-deny',
    note: '서버가 접근을 거부했습니다.',
  },
  challenge: {
    label: '추가 확인 필요',
    className: 'decision decision-challenge',
    note: '서버가 추가 확인을 요구했습니다. 이 앱은 확인 절차를 대신 수행하지 않으며, 접근이 허용된 것은 아닙니다.',
  },
  unknown: {
    label: '확인 불가',
    className: 'decision decision-unknown',
    note: '서버가 판정을 확인하지 못했습니다. 허용으로 간주하지 마세요.',
  },
};

function decisionTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '시각 정보 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `시각 형식 오류(${value})`;
  return `${date.toLocaleString('ko-KR')} (${value})`;
}

function decisionSection(input) {
  const { status, mode, data, error, appId } = input && typeof input === 'object' ? input : {};
  const app = plainText(appId, '');
  const section = makeNode('section');
  section.append(makeNode('h3', '업무 앱 접속 판정'));

  if (status === 'idle') {
    section.append(makeNode('p', '앱을 골라 접속을 요청하세요', 'state state-empty'));
    return section;
  }
  if (status === 'loading') {
    const loading = makeNode('p', `${app ? `${app}: ` : ''}판정 확인 중…`, 'state state-loading');
    loading.setAttribute('role', 'status');
    section.append(loading);
    return section;
  }

  // ok·error 는 서버가 알려 준 연결 상태(mode)를 함께 보여 준다.
  const modeLine = modeNote({ status, mode });
  if (modeLine) section.append(modeLine);

  if (status === 'error') {
    const detail = error && typeof error === 'object' ? error : {};
    const message = plainText(detail.message, '서버가 자세한 내용을 알려 주지 않았습니다.');
    section.append(makeNode('p', `요청 실패: ${message}`, 'decision decision-failed'));
    section.append(makeNode('p', '이 결과는 접근 거부 판정이 아닙니다. 접근이 허용된 것도 아닙니다. 필요하면 직접 다시 요청하세요.', 'muted'));
    return section;
  }

  if (status !== 'ok' || !data || typeof data !== 'object') {
    section.append(makeNode('p', `${DECISION_TEXT.unknown.label}(unknown)`, DECISION_TEXT.unknown.className));
    section.append(makeNode('p', '판정 결과를 받지 못했거나 형식을 확인하지 못했습니다. 허용으로 간주하지 마세요.', 'muted'));
    return section;
  }

  const received = typeof data.decision === 'string' ? data.decision : '';
  const known = received !== '' && Object.hasOwn(DECISION_TEXT, received);
  const code = known ? received : 'unknown';
  const entry = DECISION_TEXT[code];
  section.append(makeNode('p', `${entry.label}(${code})`, entry.className));
  section.append(makeNode('p', entry.note));
  if (!known && received && received !== 'unknown') {
    section.append(makeNode('p', `받은 판정값: ${received} (목록에 없는 값이라 확인 불가로 처리했습니다)`, 'muted'));
  }

  const list = makeNode('dl', null, 'kv');
  list.append(
    makeNode('dt', '대상 앱'), makeNode('dd', plainText(data.appId, app || '확인 불가')),
    makeNode('dt', '사유'), makeNode('dd', plainText(data.reason, '사유 정보 없음')),
    makeNode('dt', '판정 시각'), makeNode('dd', decisionTime(data.checkedAt)),
  );
  section.append(list);
  return section;
}

// ---------- 15단계 보조 함수: 접속 기록·XDR 경보 목록과 상세 (renderEvents 전용) ----------
// 앞 단계 보조 함수(makeNode, plainText, describeState, modeNote, decisionTime 등)는 바꾸지 않고 그대로 쓴다.
// 필터·선택 상태는 renderEvents 가 호출될 때마다 새로 만든 화면 안에만 둔다(모듈에 저장하지 않는다).
// 그래서 새 자료(다시 불러오기, 오류, 로딩)가 오면 이전 목록·필터·상세 선택이 남지 않는다.

const KIND_TEXT = { access: '접속 기록', xdr: 'XDR 경보' };
const ACCESS_TEXT = {
  allowed: { label: '허용', note: '서버가 접근을 허용한 기록입니다.' },
  denied: { label: '거부', note: '서버가 접근을 거부한 기록입니다.' },
  unknown: { label: '확인 불가', note: '서버가 접속 상태를 확인하지 못했습니다. 허용으로 간주하지 마세요.' },
};
const ALL_VALUE = 'all';
const NO_APP_VALUE = '__no_app__';

function eventTime(value) {
  if (typeof value !== 'string' || !value.trim()) return '시각 정보 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return `시각 형식 오류(${value})`;
  const kst = date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  return `${kst} 한국 시각 (${value})`;
}

function eventTimeValue(value) {
  const time = typeof value === 'string' ? new Date(value).getTime() : NaN;
  return Number.isNaN(time) ? null : time;
}

function eventKindText(kind) {
  const raw = typeof kind === 'string' && kind ? kind : 'unknown';
  return Object.hasOwn(KIND_TEXT, raw) ? `${KIND_TEXT[raw]}(${raw})` : `확인 불가 종류(${raw})`;
}

function eventAppText(appId) {
  return typeof appId === 'string' && appId.trim() ? appId : '앱 확인 불가(appId 없음)';
}

function eventAccess(event) {
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  return typeof state.access === 'string' && state.access ? state.access : 'unknown';
}

// 받은 배열을 복사해 at 기준 최신순으로 정렬한다. 원본 배열과 항목은 바꾸지 않는다.
function sortedEvents(data) {
  return data
    .filter((item) => item && typeof item === 'object')
    .map((event, index) => ({ event, index, time: eventTimeValue(event.at) }))
    .sort((a, b) => {
      if (a.time === null && b.time === null) return a.index - b.index;
      if (a.time === null) return 1;
      if (b.time === null) return -1;
      return b.time - a.time || a.index - b.index;
    })
    .map((entry) => entry.event);
}

function filterField(labelText, options, onPick) {
  const label = makeNode('label', `${labelText} `);
  const select = makeNode('select');
  select.setAttribute('aria-label', labelText);
  for (const [value, text] of options) {
    const option = makeNode('option', text);
    option.value = value;
    select.append(option);
  }
  select.value = ALL_VALUE;
  select.addEventListener('change', () => onPick(select.value));
  label.append(select);
  return label;
}

function detailBlock(title, items, emptyText) {
  const block = makeNode('div');
  block.append(makeNode('h5', title));
  if (!Array.isArray(items) || items.length === 0) {
    block.append(makeNode('p', emptyText, 'state state-empty'));
    return block;
  }
  const list = makeNode('ul', null, 'plain-list');
  for (const item of items) {
    const entry = item && typeof item === 'object' ? item : {};
    const row = makeNode('li');
    row.append(makeNode('span', `ID ${plainText(entry.id)}`, 'item-title'));
    row.append(makeNode('span', ` · ${plainText(entry.text, '내용 없음')}`));
    list.append(row);
  }
  block.append(list);
  return block;
}

function detailState(label, table, value) {
  const state = describeState(table, value);
  const row = makeNode('li');
  row.append(makeNode('span', `${label}: `, 'item-title'));
  row.append(makeNode('span', state.text, state.normal ? 'muted' : 'state state-empty'));
  if (state.note) row.append(makeNode('span', ` ${state.note}`, 'muted'));
  return row;
}

function eventDetail(event) {
  const detail = makeNode('section', null, 'event-detail');
  detail.setAttribute('data-student-event-detail', String(event.id));
  detail.append(makeNode('h4', `${plainText(event.id)} 상세`));
  const facts = makeNode('dl', null, 'kv');
  facts.append(
    makeNode('dt', '사건 ID'), makeNode('dd', plainText(event.id)),
    makeNode('dt', '종류'), makeNode('dd', eventKindText(event.kind)),
    makeNode('dt', '업무 앱(appId)'), makeNode('dd', eventAppText(event.appId)),
    makeNode('dt', '시각'), makeNode('dd', eventTime(event.at)),
    makeNode('dt', '요약'), makeNode('dd', plainText(event.summary, '요약 없음')),
  );
  detail.append(facts);
  detail.append(detailBlock('근거(evidence)', event.evidence, '근거 정보가 없습니다.'));
  detail.append(detailBlock('규칙(rules)', event.rules, '적용된 규칙 정보가 없습니다.'));
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  const states = makeNode('div');
  states.append(makeNode('h5', '상태(state)'));
  const list = makeNode('ul', null, 'plain-list');
  list.append(
    detailState('접속 상태(access)', ACCESS_TEXT, state.access),
    detailState('세션(session)', SESSION_TEXT, state.session),
    detailState('기기(device)', DEVICE_TEXT, state.device),
  );
  states.append(list);
  detail.append(states);
  // 16단계: 서버가 넘겨 준 조치가 있을 때만 안내한다. 비활성 버튼이며 어떤 요청도 보내지 않는다.
  const actions = Array.isArray(event.supportedActions)
    ? event.supportedActions.filter((action) => typeof action === 'string' && action.trim())
    : [];
  if (actions.length > 0) {
    const block = makeNode('div');
    block.append(makeNode('h5', '조치(supportedActions)'));
    block.append(makeNode('p', '조치 실행 연결은 준비 중입니다. 아래 조치는 아직 지원하지 않으며, 이 화면은 어떤 조치 요청도 보내지 않습니다.', 'state state-empty'));
    for (const action of actions) {
      const button = makeNode('button', `${action} 미지원`);
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      block.append(button);
    }
    detail.append(block);
  }
  return detail;
}

function eventsSection(resource) {
  const section = makeNode('section');
  section.append(makeNode('h3', '내 접속 기록·XDR 경보'));
  const mode = modeNote(resource);
  if (mode) section.append(mode);

  if (!resource || typeof resource !== 'object') {
    section.append(makeNode('p', '기록 확인 불가: 자료를 받지 못했습니다.', 'state state-error'));
    return section;
  }
  if (resource.status === 'loading') {
    const loading = makeNode('p', '기록을 불러오는 중…', 'state state-loading');
    loading.setAttribute('role', 'status');
    section.append(loading);
    return section;
  }
  if (resource.status === 'error') {
    const error = resource.error && typeof resource.error === 'object' ? resource.error : {};
    const message = plainText(error.message, '서버가 자세한 내용을 알려 주지 않았습니다.');
    if (error.code === 'CONTRACT_MISMATCH') {
      section.append(makeNode('p', `기록 확인 불가: 서버 응답이 약속된 형식과 다릅니다. ${message}`, 'state state-error'));
      section.append(makeNode('p', '이전 목록은 지웠습니다. 기록이 없다는 뜻이 아닙니다.', 'muted'));
    } else {
      section.append(makeNode('p', `기록을 불러오지 못했습니다: ${message}`, 'state state-error'));
      section.append(makeNode('p', '이전 목록은 표시하지 않습니다. 기록이 없다는 뜻이 아닙니다.', 'muted'));
    }
    return section;
  }
  if (resource.status !== 'ok') {
    section.append(makeNode('p', '기록 확인 불가: 알 수 없는 상태입니다.', 'state state-error'));
    return section;
  }
  if (!Array.isArray(resource.data)) {
    section.append(makeNode('p', '기록 확인 불가: 응답 형식이 배열이 아닙니다.', 'state state-error'));
    return section;
  }

  const all = sortedEvents(resource.data);
  if (all.length === 0) {
    section.append(makeNode('p', '표시할 기록이 없습니다.', 'state state-empty'));
    section.append(makeNode('p', '본인의 최근 기록만 조회합니다. 전체 직원의 로그가 아닙니다.', 'muted'));
    return section;
  }

  const filters = { kind: ALL_VALUE, app: ALL_VALUE, access: ALL_VALUE };
  let selectedId = null;

  const unique = (values) => [...new Set(values)];
  const kindOptions = [[ALL_VALUE, '전체'], ...unique(['access', 'xdr', ...all.map((e) => (typeof e.kind === 'string' ? e.kind : ''))].filter(Boolean)).map((k) => [k, eventKindText(k)])];
  const appIds = unique(all.map((e) => e.appId).filter((id) => typeof id === 'string' && id.trim()));
  const appOptions = [[ALL_VALUE, '전체'], ...appIds.map((id) => [id, id])];
  if (all.some((e) => !(typeof e.appId === 'string' && e.appId.trim()))) appOptions.push([NO_APP_VALUE, '앱 확인 불가(appId 없음)']);
  const accessOptions = [[ALL_VALUE, '전체'], ...unique(['allowed', 'denied', 'unknown', ...all.map(eventAccess)]).map((a) => [a, describeState(ACCESS_TEXT, a).text])];

  const controls = makeNode('div', null, 'filters');
  const summary = makeNode('p', null, 'muted');
  summary.setAttribute('role', 'status');
  const listHost = makeNode('div');
  const detailHost = makeNode('div');

  const matches = (event) => {
    if (filters.kind !== ALL_VALUE && event.kind !== filters.kind) return false;
    if (filters.app !== ALL_VALUE) {
      const hasApp = typeof event.appId === 'string' && event.appId.trim();
      if (filters.app === NO_APP_VALUE ? hasApp : event.appId !== filters.app) return false;
    }
    if (filters.access !== ALL_VALUE && eventAccess(event) !== filters.access) return false;
    return true;
  };

  const redraw = () => {
    const shown = all.filter(matches);
    if (selectedId !== null && !shown.some((e) => e.id === selectedId)) selectedId = null;
    summary.textContent = `표시 ${shown.length}건 / 받은 기록 ${all.length}건 (본인의 최근 기록만, 전체 로그 아님)`;

    if (shown.length === 0) {
      listHost.replaceChildren(makeNode('p', '선택한 필터에 맞는 기록이 없습니다. 필터를 전체로 바꿔 보세요.', 'state state-empty'));
    } else {
      const list = makeNode('ul', null, 'plain-list');
      for (const event of shown) {
        const row = makeNode('li');
        row.setAttribute('data-student-event-id', String(event.id));
        row.append(makeNode('span', `${plainText(event.id)} `, 'item-title'));
        row.append(makeNode('span', `${eventTime(event.at)} · ${eventKindText(event.kind)} · 앱: ${eventAppText(event.appId)} · `));
        row.append(makeNode('span', plainText(event.summary, '요약 없음')));
        row.append(makeNode('span', ' '));
        const button = makeNode('button', `${plainText(event.id)} 상세`);
        button.type = 'button';
        button.setAttribute('aria-expanded', String(event.id === selectedId));
        button.addEventListener('click', () => {
          selectedId = event.id;
          redraw();
        });
        row.append(button);
        list.append(row);
      }
      listHost.replaceChildren(list);
    }

    const selected = selectedId === null ? null : shown.find((e) => e.id === selectedId);
    detailHost.replaceChildren(selected ? eventDetail(selected) : makeNode('p', '기록의 「상세」 버튼을 누르면 근거·규칙·상태가 표시됩니다.', 'muted'));
  };

  controls.append(
    filterField('기록 종류', kindOptions, (value) => { filters.kind = value; redraw(); }),
    filterField('업무 앱', appOptions, (value) => { filters.app = value; redraw(); }),
    filterField('접속 상태', accessOptions, (value) => { filters.access = value; redraw(); }),
  );
  section.append(controls, summary, listHost, detailHost);
  redraw();
  return section;
}

// ---------- 16단계 보조 함수: 기기·세션·알림·도움정보 (renderStatus 전용) ----------
// 앞 단계 보조 함수(makeNode, plainText, stateBadge, modeNote 등)는 바꾸지 않고 그대로 쓴다.
// 이 화면은 서버를 직접 부르지 않고 자동으로 다시 요청하지도 않는다. 다시 시도는 사용자가 위쪽
// 「다시 불러오기」 버튼을 직접 누르는 것이다. 이전 실패·성공 값을 모듈에 저장하지 않으므로
// 새 입력이 오면 이전 실패 안내는 남지 않는다.

const RETRY_GUIDE = '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요. 이 화면은 자동으로 다시 요청하지 않습니다.';
const TIMEOUT_CODES = ['TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT'];
const RESOURCE_TEXT = {
  me: '로그인 정보', devices: '기기 목록', sessions: '세션', events: '접속·XDR 기록', diagnostics: '도움정보', apps: '업무 앱',
};
const SECRET_LIKE = /(api[_-]?key|token|secret|passw(or)?d|bearer|authorization|sk-[A-Za-z0-9])/i;

function resourceName(resource) {
  const key = typeof resource === 'string' ? resource : '';
  return Object.hasOwn(RESOURCE_TEXT, key) ? `${RESOURCE_TEXT[key]}(${key})` : `확인 불가 자료(${key || 'resource 없음'})`;
}

// 서버가 준 값 중 화면에 쓸 수 있는 짧은 글자만 남긴다. 비밀로 보이는 글자는 쓰지 않는다.
function safeValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || !value.trim()) return '확인 불가';
  if (SECRET_LIKE.test(value)) return '[민감 정보로 보여 표시하지 않음]';
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : '확인 불가';
}

function failureLines(resource, label) {
  const error = resource.error && typeof resource.error === 'object' ? resource.error : {};
  const message = plainText(error.message, '서버가 자세한 내용을 알려 주지 않았습니다.');
  const code = safeCode(error.code);
  const lines = [];
  if (TIMEOUT_CODES.includes(error.code)) {
    lines.push(makeNode('p', `${label}: 시간 초과로 불러오지 못했습니다(${code}): ${message}`, 'state state-error'));
  } else if (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED') {
    lines.push(makeNode('p', `${label}: 확인 불가(${code}): ${message}`, 'state state-error'));
  } else {
    lines.push(makeNode('p', `${label}: 불러오지 못했습니다(${code}): ${message}`, 'state state-error'));
  }
  lines.push(makeNode('p', `연결 상태를 확인한 뒤 다시 시도하세요. ${RETRY_GUIDE}`, 'muted'));
  return lines;
}

function statusResourceBlock(resource, cfg) {
  const block = makeNode('div');
  block.append(makeNode('h4', cfg.title));
  if (!resource || typeof resource !== 'object') {
    block.append(makeNode('p', `${cfg.title}: 확인 불가 (자료를 받지 못했습니다)`, 'state state-error'));
    return block;
  }
  if (resource.status === 'loading') {
    const loading = makeNode('p', `${cfg.title}: 불러오는 중…`, 'state state-loading');
    loading.setAttribute('role', 'status');
    block.append(loading);
    return block;
  }
  if (resource.status === 'error') {
    block.append(...failureLines(resource, cfg.title));
    return block;
  }
  if (resource.status !== 'ok') {
    block.append(makeNode('p', `${cfg.title}: 확인 불가 (알 수 없는 상태)`, 'state state-error'));
    return block;
  }
  if (!Array.isArray(resource.data)) {
    block.append(makeNode('p', `${cfg.title}: 확인 불가 (응답 형식 불일치)`, 'state state-error'));
    return block;
  }
  if (resource.data.length === 0) {
    block.append(makeNode('p', cfg.empty, 'state state-empty'));
  } else {
    const list = makeNode('ul', null, 'plain-list');
    for (const item of resource.data) {
      const row = makeNode('li');
      cfg.describe(row, item && typeof item === 'object' ? item : {});
      list.append(row);
    }
    block.append(list);
  }
  if (cfg.scope) block.append(makeNode('p', cfg.scope, 'muted'));
  return block;
}

function notificationBlock(notifications) {
  const block = makeNode('div');
  block.append(makeNode('h4', '알림'));
  if (!Array.isArray(notifications)) {
    block.append(makeNode('p', '알림: 확인 불가 (자료를 받지 못했습니다)', 'state state-error'));
    return block;
  }
  if (notifications.length === 0) {
    block.append(makeNode('p', '주의할 알림이 없습니다.', 'state state-empty'));
    return block;
  }
  const list = makeNode('ul', null, 'plain-list');
  for (const item of notifications) {
    const note = item && typeof item === 'object' ? item : {};
    const row = makeNode('li');
    const code = safeCode(note.code);
    const failed = /^[A-Z][A-Z0-9_]+$/.test(code);
    row.append(makeNode('span', `자료: ${resourceName(note.resource)}`, 'item-title'));
    row.append(makeNode('span', ` · 코드: ${code}`, 'muted'));
    row.append(makeNode('span', ` · ${plainText(note.message, '내용 없음')}`));
    if (failed) {
      row.append(makeNode('span', ` ${TIMEOUT_CODES.includes(code) ? '시간 초과입니다. ' : ''}연결 상태를 확인한 뒤 위쪽 다시 불러오기 버튼을 직접 누르세요.`, 'muted'));
    }
    list.append(row);
  }
  block.append(list);
  return block;
}

// 도움 요청에 쓰는 안전한 값만 고른다. 원본 diagnostics 를 통째로 복사하거나 표시하지 않는다.
function diagnosticsFields(data) {
  const source = data && typeof data === 'object' ? data : {};
  const engine = source.engine && typeof source.engine === 'object' ? source.engine : {};
  return [
    ['requestId', safeValue(source.requestId)],
    ['component', safeValue(source.component)],
    ['version', safeValue(source.version)],
    ['checkedAt', safeValue(source.checkedAt)],
    ['engine.mode', safeValue(engine.mode)],
    ['engine.code', safeValue(engine.code)],
  ];
}

function diagnosticsBlock(diagnostics) {
  const block = makeNode('div');
  block.append(makeNode('h4', '도움정보'));
  const copyButton = makeNode('button', '도움정보 복사');
  copyButton.type = 'button';
  const result = makeNode('p', null, 'muted');
  result.setAttribute('role', 'status');

  const d = diagnostics && typeof diagnostics === 'object' ? diagnostics : null;
  if (!d || d.status === 'idle') {
    block.append(makeNode('p', '도움정보를 아직 불러오지 않았습니다. 필요하면 위쪽 도움정보 영역에서 직접 불러오세요.', 'state state-empty'));
  } else if (d.status === 'loading') {
    const loading = makeNode('p', '도움정보를 불러오는 중…', 'state state-loading');
    loading.setAttribute('role', 'status');
    block.append(loading);
  } else if (d.status === 'error') {
    block.append(...failureLines(d, '도움정보'));
  } else if (d.status !== 'ok' || !d.data || typeof d.data !== 'object') {
    block.append(makeNode('p', '도움정보: 확인 불가 (응답 형식 불일치)', 'state state-error'));
  } else {
    const fields = diagnosticsFields(d.data);
    const list = makeNode('dl', null, 'kv');
    for (const [name, value] of fields) list.append(makeNode('dt', name), makeNode('dd', value));
    block.append(list);
    const text = fields.map(([name, value]) => `${name}: ${value}`).join('\n');
    copyButton.addEventListener('click', async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(text);
        result.textContent = '도움정보를 클립보드에 복사했습니다. 어디에도 자동으로 전송되지 않았습니다.';
      } catch {
        result.textContent = '복사하지 못했습니다. 위에 표시된 값을 직접 선택해 복사하세요.';
      }
    });
    block.append(makeNode('p', '도움 요청에 쓰도록 복사하는 정보입니다. 비밀번호·토큰·API 키는 포함하지 않으며, 「도움정보 복사」 버튼을 누를 때만 복사됩니다.', 'muted'));
  }
  if (!d || d.status !== 'ok' || !d.data || typeof d.data !== 'object') {
    copyButton.disabled = true;
    copyButton.setAttribute('aria-disabled', 'true');
    block.append(makeNode('p', '도움정보를 불러온 뒤에만 복사할 수 있습니다.', 'muted'));
  }
  block.append(copyButton, result);
  return block;
}

function statusSection(input) {
  const { devices, sessions, notifications, diagnostics, mode } = input && typeof input === 'object' ? input : {};
  const section = makeNode('section');
  section.append(makeNode('h3', '기기·세션·알림·도움정보'));
  const modeLine = modeNote({ status: 'ok', mode });
  if (modeLine) section.append(modeLine);
  section.append(
    statusResourceBlock(devices, {
      title: '기기 목록',
      empty: '등록된 기기가 없습니다.',
      scope: '내 이름으로 등록되고 회수되지 않은 기기만 최대 100개까지 표시합니다.',
      describe(row, device) {
        row.append(makeNode('span', plainText(device.label, plainText(device.id)), 'item-title'));
        if (typeof device.id === 'string' && device.id) row.append(makeNode('span', ` (${device.id}) `, 'muted'));
        row.append(stateBadge(DEVICE_TEXT, device.status));
      },
    }),
    statusResourceBlock(sessions, {
      title: '세션',
      empty: '현재 연결(세션)이 없습니다.',
      scope: '지금 검증된 연결 한 개만 표시합니다. 지난 세션 목록이 아닙니다.',
      describe(row, session) {
        row.append(makeNode('span', plainText(session.id), 'item-title'));
        row.append(makeNode('span', ' '));
        row.append(stateBadge(SESSION_TEXT, session.status));
      },
    }),
    notificationBlock(notifications),
    diagnosticsBlock(diagnostics),
  );
  return section;
}

// ---------- 17단계 보조 함수: 앱 내부 AI 연결 점검·사건 설명 기본 표시 (renderAiConnection, renderExplanation 전용) ----------
// 앞 단계 보조 함수(makeNode, plainText, modeNote, eventTime 등)는 바꾸지 않고 그대로 쓴다.
// 이 화면은 서버를 부르지 않고 자동으로 다시 점검하지도 않는다. 점검·승인·취소 버튼은 제공 화면에 있다.
// 이전 점검 결과를 모듈에 저장하지 않으므로 새 입력(성공, idle, 오류)이 오면 이전 안내는 남지 않는다.

const AI_RETRY_GUIDE = '다시 점검은 위쪽 「현재 API 연결 점검」 버튼을 직접 누르세요. 이 화면은 자동으로 다시 점검하지 않습니다.';
const AI_ROLE_NOTE = '이 칸은 앱 서버가 수업용 AI에 연결되는지만 점검한 결과입니다. 사건 설명은 보안 기록에서 따로 요청하고 확인합니다. 워크벤치의 수업용 AI, 앱 안의 AI 설명 기능, ALEPH의 공식 과제 판정 AI는 서로 다른 역할입니다.';

// 원인별 안내. code 는 제공 화면이 걸러서 넘긴 안전한 값이다. 목록에 없는 값은 확인 불가로 읽는다.
const AI_ERROR_GROUPS = {
  provisioning: { label: '권한 준비 중·확인 불가', guide: '담당자에게 계정 연결과 앱 권한 확인을 요청하세요. 학생 잘못이 아니며, 연결 완료로 간주하지 마세요.' },
  auth: { label: '인증 실패', guide: '계정 연결을 다시 확인하고, 계속되면 담당자에게 확인을 요청하세요.' },
  blocked: { label: '접근 제한', guide: '학생 앱의 이용 권한을 담당자에게 확인하세요.' },
  budget: { label: '반 사용량·이용 한도', guide: '담당자에게 사용량과 한도를 확인하세요.' },
  hours: { label: '이용 시간 아님', guide: '현재 AI 이용 시간인지 확인하세요.' },
  transient: { label: '요청 제한·시간 초과·네트워크', guide: '잠시 뒤 직접 다시 점검하세요.' },
  cancelled: { label: '취소됨', guide: '점검을 취소했습니다. 이전 응답은 현재 결과가 아닙니다.' },
  nomodel: { label: '쓸 수 있는 모델 없음', guide: '담당자에게 모델 허용 설정 확인을 요청하세요.' },
  unverified: { label: '확인 불가', guide: '연결 또는 응답을 확인하지 못했습니다. 성공으로 간주하지 말고, 계속되면 담당자에게 알리세요.' },
};
const AI_ERROR_GROUP_BY_CODE = {
  ON_AI_PROVISIONING_PENDING: 'provisioning',
  ON_AI_AUTHORIZATION_CHANGED: 'provisioning',
  AI_REQUEST_UNVERIFIED: 'unverified',
  SUBJECT_SCOPE_UNVERIFIED: 'unverified',
  ON_AI_INVALID_INPUT: 'unverified',
  ON_AI_INVALID_OUTPUT: 'unverified',
  WB_CLCO_AUTH_REQUIRED: 'auth',
  WB_CLCO_ACCESS_BLOCKED: 'blocked',
  WB_CLCO_COHORT_BUDGET_EXHAUSTED: 'budget',
  WB_CLCO_LIMIT_REACHED: 'budget',
  WB_CLCO_SESSION_CLOSED: 'hours',
  WB_CLCO_RATE_LIMITED: 'transient',
  WB_CLCO_TIMEOUT: 'transient',
  REQUEST_TIMEOUT: 'transient',
  ENGINE_TIMEOUT: 'transient',
  TIMEOUT: 'transient',
  WB_CLCO_CANCELLED: 'cancelled',
  CANCELLED: 'cancelled',
  REQUEST_CANCELLED: 'cancelled',
  ON_AI_MODEL_LIST_EMPTY: 'nomodel',
  MODEL_NOT_CONFIGURED: 'nomodel',
};

function aiSafeMessage(value) {
  const message = plainText(value, '서버가 자세한 내용을 알려 주지 않았습니다.');
  return SECRET_LIKE.test(message) ? '[민감 정보로 보여 표시하지 않음]' : message;
}

function aiErrorLines(error, title) {
  const detail = error && typeof error === 'object' ? error : {};
  const code = safeCode(detail.code);
  const groupKey = Object.hasOwn(AI_ERROR_GROUP_BY_CODE, detail.code) ? AI_ERROR_GROUP_BY_CODE[detail.code] : 'unverified';
  const group = AI_ERROR_GROUPS[groupKey];
  const message = aiSafeMessage(detail.message);
  return [
    makeNode('p', `${title}: ${group.label}`, 'state state-error'),
    makeNode('p', `오류 코드: ${code} · ${message}`),
    makeNode('p', group.guide, 'muted'),
  ];
}

function aiCheckedAt(value) {
  return typeof value === 'string' && value.trim() ? eventTime(value) : '점검 시각 확인 불가';
}

function aiConnectionSection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const { status, mode, data, error, checkedAt } = source;
  const section = makeNode('section');
  section.append(makeNode('h3', '앱 내부 AI 연결 점검'));

  if (status === 'loading') {
    const loading = makeNode('p', 'AI 연결 점검 중', 'state state-loading');
    loading.setAttribute('role', 'status');
    section.append(loading, makeNode('p', '이전 점검 결과는 현재 결과가 아니므로 표시하지 않습니다.', 'muted'));
    section.append(makeNode('p', AI_ROLE_NOTE, 'muted'));
    return section;
  }
  if (status === 'error') {
    section.append(...aiErrorLines(error, 'AI 연결 점검 실패'));
    section.append(makeNode('p', '이 결과는 사건 설명이 아니라 연결 점검 결과입니다. 이전 성공 결과는 표시하지 않습니다.', 'muted'));
    section.append(makeNode('p', AI_RETRY_GUIDE, 'muted'), makeNode('p', AI_ROLE_NOTE, 'muted'));
    return section;
  }
  if (status === 'ok') {
    const valid = data && typeof data === 'object' && data.transportChecked === true
      && (data.audienceAuthorization === 'test' || data.audienceAuthorization === 'verified')
      && Number.isInteger(data.modelCount) && data.modelCount >= 0;
    if (!valid) {
      section.append(makeNode('p', 'AI 연결 점검: 확인 불가 (응답 형식 불일치)', 'state state-error'));
      section.append(makeNode('p', '성공으로 간주하지 마세요. 사건 설명은 아직 실행하지 않았습니다.', 'muted'));
      section.append(makeNode('p', AI_RETRY_GUIDE, 'muted'), makeNode('p', AI_ROLE_NOTE, 'muted'));
      return section;
    }
    const modeLine = modeNote({ status, mode });
    if (modeLine) section.append(modeLine);
    const verified = data.audienceAuthorization === 'verified';
    section.append(makeNode('p', verified ? '앱 권한 확인 후 점검(verified)' : '시험 연결 점검(test)', 'state state-ok'));
    section.append(makeNode('p', verified
      ? '그 시각 기준으로 앱 권한 확인과 모델 응답을 확인했습니다.'
      : '시험 연결에서 모델 목록 응답만 확인했습니다. 앱 권한 확인이 끝난 것이 아닙니다.', 'muted'));
    const list = makeNode('dl', null, 'kv');
    list.append(
      makeNode('dt', '응답 모델 수'), makeNode('dd', `${data.modelCount}개`),
      makeNode('dt', '점검 시각'), makeNode('dd', aiCheckedAt(checkedAt)),
    );
    section.append(list);
    section.append(makeNode('p', '연결만 점검했고 사건 설명은 아직 실행하지 않았습니다. 모델 목록 응답은 사건 설명이 아닙니다.', 'state state-empty'));
    section.append(makeNode('p', AI_RETRY_GUIDE, 'muted'), makeNode('p', AI_ROLE_NOTE, 'muted'));
    return section;
  }
  // idle 이거나 알 수 없는 값: 점검 전. 이전 결과를 남기지 않는다.
  section.append(makeNode('p', 'AI 연결 점검 전', 'state state-empty'));
  section.append(makeNode('p', '위쪽 제공 화면에서 「AI 연결 시작」 → 「승인 페이지 열기」 → 승인 → 「승인했으며 연결 확인」을 마친 뒤 「현재 API 연결 점검」을 직접 누르세요.', 'muted'));
  section.append(makeNode('p', '이 화면은 자동으로 점검하지 않습니다.', 'muted'), makeNode('p', AI_ROLE_NOTE, 'muted'));
  return section;
}

// ---------- 18단계 보조 함수: 근거에 연결된 AI 사건 설명 (renderExplanation 전용) ----------
// 설명이 쓸 수 있는지는 제공 코드의 검사에 더해, 현재 선택한 기록(event)의 근거 ID 와 다시 대조해 정한다.
// 맞지 않으면 내용을 지어내지 않고 쓸 수 없다고만 보여 준다. 성공 표식은 쓸 수 있는 설명에만 붙인다.

const EXPLANATION_FAILURE_REASON = {
  ON_AI_INVALID_INPUT: '근거 부족: 이 기록의 근거·규칙을 확인할 수 없어 설명을 만들지 못했습니다.',
  ON_AI_INVALID_OUTPUT: '근거 불일치: AI 응답의 근거·조치·형식이 이 기록과 맞지 않아 쓸 수 없습니다. 이미 실행했다고 답한 설명도 쓰지 않습니다.',
  SUBJECT_SCOPE_UNVERIFIED: '확인 불가: 현재 로그인과 이 기록의 연결을 확인할 수 없습니다.',
};
// 설명 요청 실패에서는 「점검」이 아니라 「설명 요청」을 다시 누르라고 안내한다.
const EXPLANATION_FAILURE_GUIDE = {
  transient: '잠시 뒤 보안 기록에서 「AI 설명 요청」을 직접 다시 누르세요.',
  cancelled: 'AI 설명 요청을 취소했습니다. 이전 응답은 현재 결과가 아닙니다.',
};
const EXPLANATION_STATE_FIELDS = [
  ['access', '접속', ACCESS_TEXT],
  ['session', '세션', SESSION_TEXT],
  ['device', '기기', DEVICE_TEXT],
];

function explanationHeader() {
  return makeNode('h3', 'AI 설명(참고용)');
}

function listOrNone(items, text) {
  if (items.length === 0) return makeNode('p', text, 'muted');
  const list = makeNode('ul', null, 'plain-list');
  for (const item of items) list.append(item);
  return list;
}

// 설명을 현재 기록에 맞춰 검사한다. 쓸 수 없으면 까닭 한 줄을, 쓸 수 있으면 화면에 쓸 값을 돌려준다.
function checkExplanation(event, data) {
  const record = data && typeof data === 'object' ? data : null;
  if (!record || typeof record.summary !== 'string' || !record.summary.trim()) {
    return { reason: '설명 요약이 없어 쓸 수 없습니다(근거가 맞지 않음).' };
  }
  if (record.executed !== false) return { reason: '이미 실행했다고 답한 설명은 쓸 수 없습니다.' };
  if (record.requiresHumanConfirmation !== true) return { reason: '사람 확인이 필요하다는 표시가 없는 설명은 쓸 수 없습니다.' };
  const evidence = Array.isArray(event.evidence) ? event.evidence.filter((row) => row && typeof row === 'object' && typeof row.id === 'string') : [];
  if (evidence.length === 0) return { reason: '근거 부족: 이 기록에 근거가 없어 AI 설명을 쓸 수 없습니다.' };
  const ids = Array.isArray(record.evidenceIds) ? record.evidenceIds : [];
  if (ids.length === 0) return { reason: '근거 부족: AI 설명이 인용한 근거 ID가 없어 쓸 수 없습니다.' };
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const cited = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !byId.has(id)) {
      return { reason: `근거가 맞지 않음: 인용한 근거 ID(${safeCode(id)})가 이 기록(${event.id})의 근거에 없어 이 설명을 쓸 수 없습니다.` };
    }
    cited.push(byId.get(id));
  }
  const proposals = Array.isArray(record.proposals) ? record.proposals : [];
  const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];
  for (const proposal of proposals) {
    const row = proposal && typeof proposal === 'object' ? proposal : {};
    const proofs = Array.isArray(row.evidenceIds) ? row.evidenceIds : [];
    if (typeof row.action !== 'string' || !supported.includes(row.action) || proofs.length === 0 || !proofs.every((id) => byId.has(id))) {
      return { reason: '근거가 맞지 않음: 제안한 조치나 그 근거가 이 기록과 맞지 않아 이 설명을 쓸 수 없습니다.' };
    }
  }
  return { summary: record.summary, cited, proposals, supported };
}

function stateNodes(event) {
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  const unknownRows = [];
  const currentRows = [];
  for (const [key, label, table] of EXPLANATION_STATE_FIELDS) {
    const raw = typeof state[key] === 'string' && state[key] ? state[key] : 'unknown';
    const known = Object.hasOwn(table, raw) && raw !== 'unknown';
    const described = describeState(table, raw);
    if (known) {
      currentRows.push(makeNode('li', `${label}: ${described.text}${described.note ? ` — ${described.note}` : ''}`));
    } else {
      unknownRows.push(makeNode('li', `${label}: 확인 불가(${raw})`, 'state state-empty'));
    }
  }
  return { unknownRows, currentRows };
}

function proposalNodes(result) {
  if (result.proposals.length === 0) {
    return [makeNode('p', result.supported.length === 0
      ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
      : 'AI가 제안한 조치가 없습니다.', 'muted')];
  }
  const rows = result.proposals.map((proposal) => {
    const row = makeNode('li');
    row.append(makeNode('span', `조치: ${plainText(proposal.action)}`, 'item-title'));
    row.append(makeNode('span', ` · 이유: ${plainText(proposal.reason, '이유 없음')}`));
    row.append(makeNode('span', ` · 근거 ID: ${proposal.evidenceIds.map((id) => safeCode(id)).join(', ')}`, 'muted'));
    row.append(makeNode('span', ' · 사람 확인이 필요하며 실행되지 않았습니다.', 'muted'));
    return row;
  });
  return [listOrNone(rows, '')];
}

function explanationSection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const { event, explanation, checkedAt } = source;
  const exp = explanation && typeof explanation === 'object' ? explanation : {};
  const record = event && typeof event === 'object' ? event : null;
  const eventId = record && typeof record.id === 'string' && record.id ? record.id : '';
  const wrapper = makeNode('div');
  wrapper.append(explanationHeader());

  // 1) 실패: event 가 null 이어도 안전한 오류 코드와 까닭을 먼저 보여 준다.
  if (exp.status === 'error') {
    const detail = exp.error && typeof exp.error === 'object' ? exp.error : {};
    const groupKey = Object.hasOwn(AI_ERROR_GROUP_BY_CODE, detail.code) ? AI_ERROR_GROUP_BY_CODE[detail.code] : 'unverified';
    wrapper.append(makeNode('p', `AI 설명 실패: ${AI_ERROR_GROUPS[groupKey].label}`, 'state state-error'));
    wrapper.append(makeNode('p', `오류 코드: ${safeCode(detail.code)} · ${aiSafeMessage(detail.message)}`));
    if (Object.hasOwn(EXPLANATION_FAILURE_REASON, detail.code)) wrapper.append(makeNode('p', EXPLANATION_FAILURE_REASON[detail.code], 'state state-empty'));
    wrapper.append(makeNode('p', EXPLANATION_FAILURE_GUIDE[groupKey] || AI_ERROR_GROUPS[groupKey].guide, 'muted'));
    wrapper.append(makeNode('p', '기록은 그대로입니다. 업무 앱 판정과 보안 기록은 계속 동작하며, 이 실패는 과제 실패가 아닙니다.', 'muted'));
    return wrapper;
  }
  // 2) 오류 없이 기록만 없는 경우
  if (!record) {
    wrapper.append(makeNode('p', '보안 기록에서 기록을 먼저 고르세요', 'state state-empty'));
    wrapper.append(makeNode('p', '기록을 고르고 「AI 설명 요청」을 누르면 이 칸에 설명이 표시됩니다. 연결 점검만으로는 사건 설명이 만들어지지 않습니다.', 'muted'));
    return wrapper;
  }
  // 3) 요청 중
  if (exp.status === 'loading') {
    const loading = makeNode('p', `${eventId ? `${eventId}: ` : ''}AI 설명을 요청하는 중…`, 'state state-loading');
    loading.setAttribute('role', 'status');
    wrapper.append(loading, makeNode('p', '이전 설명은 현재 기록의 설명이 아니므로 표시하지 않습니다.', 'muted'));
    return wrapper;
  }
  // 4) 성공: 현재 기록의 근거와 대조해 쓸 수 있을 때만
  if (exp.status === 'ok') {
    const result = eventId ? checkExplanation(record, exp.data) : { reason: '사건 ID를 확인할 수 없어 쓸 수 없습니다.' };
    if (result.reason) {
      wrapper.append(makeNode('p', 'AI 설명을 쓸 수 없습니다', 'state state-error'));
      wrapper.append(makeNode('p', result.reason));
      wrapper.append(makeNode('p', '내용을 지어내지 않고 표시하지 않았습니다. 기록은 그대로입니다. 필요하면 「AI 설명 요청」을 직접 다시 누르세요.', 'muted'));
      return wrapper;
    }
    wrapper.setAttribute('data-student-explanation-event', eventId);
    const facts = makeNode('dl', null, 'kv');
    facts.append(
      makeNode('dt', '사건 ID'), makeNode('dd', eventId),
      makeNode('dt', 'AI 요약(참고용)'), makeNode('dd', result.summary),
      makeNode('dt', '확인 시각'), makeNode('dd', aiCheckedAt(checkedAt)),
    );
    wrapper.append(facts);
    wrapper.append(makeNode('p', 'AI 설명은 해석입니다. 사실 판단은 아래 근거 글과 연동 시스템이 알려 준 상태로 하세요.', 'muted'));

    wrapper.append(makeNode('h4', '인용한 근거'));
    wrapper.append(listOrNone(result.cited.map((row) => makeNode('li', `${row.id} — ${plainText(row.text, '근거 글 없음')}`)), '근거 없음'));

    wrapper.append(makeNode('h4', '적용된 규칙'));
    const rules = Array.isArray(record.rules) ? record.rules.filter((row) => row && typeof row === 'object') : [];
    wrapper.append(listOrNone(rules.map((row) => makeNode('li', `${plainText(row.id)} — ${plainText(row.text, '규칙 글 없음')}`)), '규칙 없음'));

    const { unknownRows, currentRows } = stateNodes(record);
    wrapper.append(makeNode('h4', '확인 불가 상태'));
    wrapper.append(listOrNone(unknownRows, '없음'));
    if (unknownRows.length > 0) wrapper.append(makeNode('p', '확인할 수 없는 상태는 정상이나 안전으로 간주하지 마세요.', 'muted'));
    if (currentRows.length > 0) {
      wrapper.append(makeNode('h4', '연동 시스템이 알려 준 상태'));
      wrapper.append(listOrNone(currentRows, ''));
    }

    wrapper.append(makeNode('h4', '제안'));
    wrapper.append(...proposalNodes(result));
    wrapper.append(makeNode('p', '이 설명과 제안만으로 보안 조치가 실행되지는 않습니다. 실행 버튼도 만들지 않았습니다.', 'muted'));
    return wrapper;
  }
  // 5) 아직 요청하지 않음
  wrapper.append(makeNode('p', `${eventId ? `${eventId}: ` : ''}AI 설명 전`, 'state state-empty'));
  wrapper.append(makeNode('p', '이 기록에 대해 아직 AI 설명을 요청하지 않았습니다. 「AI 설명 요청」을 직접 누르세요. 이전 기록의 설명은 표시하지 않습니다.', 'muted'));
  return wrapper;
}

// ---------- 19단계 보조 함수: 조치 제안·사람 확인·서버 접수·실제 효과 구분 (renderAction 전용) ----------
// 이 화면에는 버튼·요청·확인 번호가 없다. 준비·집행·재조회·취소는 제공 화면의 버튼을 쓴다.
// 이전 표시를 모듈에 저장하지 않는다. 호출할 때마다 받은 입력만으로 새로 그리므로 새 값이 오면 이전 대상·요청·결과는 남지 않는다.

const ACTION_BUTTON_GUIDE = '이 칸에는 버튼이 없습니다. 조치 준비·집행·결과 재조회·취소는 위쪽 제공 화면의 버튼을 사용하세요. 「조치 화면 취소」는 이미 서버에 전달된 조치의 효과를 되돌리지 않습니다.';

// 상태별 제목·설명·단계. 모르는 값은 확인 불가로 읽는다.
const ACTION_STATUS_TEXT = {
  idle: {
    title: '아직 미실행(idle)',
    stage: '조치 제안 전 · 아무 요청도 없습니다.',
    note: '조치 제안은 아직 실행되지 않았습니다. 연동 시스템이 지원하는 조치가 없으면(supportedActions 빈 배열) 「조치 준비」 버튼이 나오지 않는 것이 정상입니다.',
    tone: 'state state-empty',
  },
  loading: {
    title: '조치 준비 또는 결과 조회 중(loading) · 완료 아님',
    stage: '서버 응답을 기다리는 중입니다.',
    note: '결과가 아직 확인되지 않았습니다.',
    tone: 'state state-loading',
  },
  prepared: {
    title: '준비됨·미실행(prepared)',
    stage: '사람 확인 대기 · 아직 서버에 전달하지 않았습니다.',
    note: '대상과 확인 기한을 읽고, 집행하려면 위쪽 제공 화면의 「대상과 조치를 확인했으며 집행합니다」를 사람이 직접 눌러야 합니다.',
    tone: 'state state-empty',
  },
  executing: {
    title: '서버에 전달 중(executing)',
    stage: '서버 전달 중 · 결과가 아직 없습니다.',
    note: '결과가 아직 확인되지 않았습니다. 이 상태는 효과를 뜻하지 않습니다.',
    tone: 'state state-loading',
  },
  pending: {
    title: '서버 접수·처리 중(pending)',
    stage: '서버 접수(ACK) · 효과는 아직 확인되지 않았습니다.',
    note: '서버가 요청을 받았다는 응답(ACK)은 효과 확인이 아닙니다. 연동 시스템의 결과는 위쪽 「연동 시스템 결과만 재조회」로 확인하세요.',
    tone: 'state state-loading',
  },
  denied: {
    title: '거절(denied)',
    stage: '연동 시스템이 이 조치를 거절했습니다.',
    note: '거절된 조치는 적용되지 않았다고 단정하지 말고, 아래 사유와 결과 재조회로 확인하세요.',
    tone: 'state state-error',
  },
  failed: {
    title: '실패(failed)',
    stage: '연동 시스템이 이 조치를 처리하지 못했습니다.',
    note: '아래 사유를 확인하고 필요하면 결과만 재조회하세요.',
    tone: 'state state-error',
  },
  unknown: {
    title: '결과 불명(unknown)',
    stage: '결과를 확인하지 못했습니다.',
    note: '효과가 없다고도, 성공했다고도 판단하지 마세요. 위쪽 「연동 시스템 결과만 재조회」로 결과만 다시 조회하세요. 같은 조치를 중복해서 집행하지 마세요.',
    tone: 'state state-error',
  },
  expired: {
    title: '확인 기한 지남(expired)',
    stage: '이번 준비로는 집행할 수 없습니다.',
    note: '조치를 다시 준비하고 대상을 다시 확인하세요.',
    tone: 'state state-error',
  },
  error: {
    title: '요청 처리 안 됨(error)',
    stage: '요청이 처리되지 않았습니다.',
    note: '아래 오류 코드와 message를 확인하세요.',
    tone: 'state state-error',
  },
};

function actionId(value) {
  return typeof value === 'string' && value.trim() ? safeValue(value) : '';
}

// 값이 있어 실제로 행을 추가했으면 true 를 돌려준다. 표준 DOM 에 없는 속성(예: 자식 배열)을 읽지 않기 위해 개수를 직접 센다.
function actionRow(list, name, value) {
  if (value === '' || value == null) return false;
  list.append(makeNode('dt', name), makeNode('dd', String(value)));
  return true;
}

function actionSection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const event = source.event && typeof source.event === 'object' ? source.event : null;
  const target = source.target && typeof source.target === 'object' ? source.target : null;
  const receipt = source.receipt && typeof source.receipt === 'object' ? source.receipt : null;
  const observation = source.observation && typeof source.observation === 'object' ? source.observation : null;
  const wrapper = makeNode('div');
  wrapper.append(makeNode('h3', '보안 조치 요청 상태'));

  const eventId = event && typeof event.id === 'string' ? event.id : '';
  const actionName = typeof source.actionId === 'string' ? source.actionId : '';
  const requestId = receipt && typeof receipt.requestId === 'string' ? receipt.requestId : '';

  // 현재 사건·조치와 서버 영수증이 가리키는 사건·조치가 다르면 이 영수증을 현재 요청의 결과로 쓰지 않는다.
  const mismatch = receipt && (
    (typeof receipt.eventId === 'string' && eventId && receipt.eventId !== eventId)
    || (typeof receipt.actionId === 'string' && actionName && receipt.actionId !== actionName)
  );
  if (mismatch) {
    wrapper.append(makeNode('p', '결과 확인 불가: 서버 영수증이 현재 사건·조치와 맞지 않습니다.', 'state state-error'));
    wrapper.append(makeNode('p', '이 영수증은 현재 요청의 결과로 쓰지 않습니다. 성공이나 효과 없음으로 판단하지 마세요.', 'muted'));
    wrapper.append(makeNode('p', ACTION_BUTTON_GUIDE, 'muted'));
    return wrapper;
  }

  const known = Object.hasOwn(ACTION_STATUS_TEXT, source.status) || source.status === 'succeeded';
  let key = known ? source.status : 'unknown';
  let downgraded = false;
  // 효과 확인은 succeeded 이면서 observation.effectApplied 가 true 일 때만 인정한다.
  if (key === 'succeeded') {
    key = observation && observation.effectApplied === true && typeof observation.observedAt === 'string' && observation.observedAt.trim()
      ? 'succeeded' : 'unknown';
    downgraded = key === 'unknown';
  }

  let entry;
  if (key === 'succeeded') {
    entry = {
      title: '효과 확인(succeeded)',
      stage: '연동 시스템이 효과를 관측했습니다.',
      note: '아래 관측 시각과 영수증 ID는 연동 시스템이 알려 준 값입니다.',
      tone: 'state state-ok',
    };
  } else {
    entry = ACTION_STATUS_TEXT[key];
  }
  const rawStatus = typeof source.status === 'string' && source.status ? source.status : '값 없음';

  wrapper.append(makeNode('p', entry.title, entry.tone));
  if (!known) wrapper.append(makeNode('p', `받은 상태값: ${safeValue(rawStatus)} (목록에 없는 값이라 결과 불명으로 처리했습니다)`, 'muted'));
  if (downgraded) {
    wrapper.append(makeNode('p', `받은 상태값: succeeded · 효과 관측(observation.effectApplied: true)이 확인되지 않아 성공으로 보지 않습니다.`, 'muted'));
  }
  wrapper.append(makeNode('p', `현재 단계: ${entry.stage}`));
  wrapper.append(makeNode('p', entry.note, 'muted'));

  if (key === 'error') {
    const detail = source.error && typeof source.error === 'object' ? source.error : {};
    wrapper.append(makeNode('p', `오류 코드: ${safeCode(detail.code)} · ${aiSafeMessage(detail.message || source.message)}`));
  } else if ((key === 'denied' || key === 'failed' || key === 'unknown' || key === 'expired') && (source.message || (source.error && source.error.message))) {
    const detail = source.error && typeof source.error === 'object' ? source.error : {};
    const code = detail.code ? `${safeCode(detail.code)} · ` : '';
    wrapper.append(makeNode('p', `사유: ${code}${aiSafeMessage(detail.message || source.message)}`));
  } else if (key === 'loading' && typeof source.message === 'string' && source.message) {
    wrapper.append(makeNode('p', aiSafeMessage(source.message), 'muted'));
  }

  // 받은 범위에서만 표시한다. 없는 값을 만들거나 추측하지 않는다.
  const facts = makeNode('dl', null, 'kv');
  let factCount = 0;
  const addFact = (name, value) => { if (actionRow(facts, name, value)) factCount += 1; };
  addFact('사건 ID', eventId ? safeValue(eventId) : '');
  if (event && Array.isArray(event.evidence)) {
    const ids = event.evidence.map((row) => (row && typeof row.id === 'string' ? safeValue(row.id) : '')).filter(Boolean);
    addFact('근거 ID', ids.join(', '));
  }
  addFact('조치(actionId)', actionId(actionName));
  if (target) {
    addFact('실제 대상(target.id)', typeof target.id === 'string' ? safeValue(target.id) : '');
    addFact('대상 세대(generation)', Number.isSafeInteger(target.generation) ? target.generation : '');
  }
  if (receipt) {
    addFact('요청 ID(requestId)', requestId ? safeValue(requestId) : '');
    addFact('영수증 ID(receiptId)', typeof receipt.receiptId === 'string' && receipt.receiptId ? safeValue(receipt.receiptId) : '');
    addFact('버전(version)', Number.isSafeInteger(receipt.version) ? receipt.version : '');
  }
  if (key === 'prepared' || key === 'expired') {
    const expires = source.confirmationExpiresAt;
    addFact('확인 기한', typeof expires === 'string' && expires.trim() ? eventTime(expires) : '확인 불가');
  }
  if (key === 'succeeded') {
    addFact('관측 시각(observedAt)', eventTime(observation.observedAt));
    addFact('실제 효과(effectApplied)', 'effectApplied: true');
    if (!(typeof receipt?.receiptId === 'string' && receipt.receiptId)) addFact('영수증 ID(receiptId)', '확인 불가');
  }
  if (factCount > 0) wrapper.append(facts);
  if (receipt && receipt.superseded === true) {
    wrapper.append(makeNode('p', '이전 조회는 최신 결과를 대신하지 않습니다(superseded).', 'muted'));
  }
  wrapper.append(makeNode('p', ACTION_BUTTON_GUIDE, 'muted'));

  // 성공적으로 그린 요청 화면에만 표식을 붙인다. 요청 자체가 없거나(idle) 처리되지 않았으면(error) 붙이지 않는다.
  if (known && key !== 'idle' && key !== 'error' && eventId && requestId) {
    wrapper.setAttribute('data-student-action-event', eventId);
    wrapper.setAttribute('data-student-action-request', requestId);
  }
  return wrapper;
}

// ---------- 20단계 보조 함수: 설치 패키지 버전과 알려진 취약점 조회 결과 (renderVulnerabilities 전용) ----------
// 조회 실패·미조회는 "취약점 없음"이 아니다. 이전 표는 저장하지 않고, 받은 입력만으로 매번 새로 그린다.

const VULN_SCAN_TEXT = {
  complete: { label: '모두 조회', note: '' },
  partial: { label: '일부 조회 실패', note: '일부 패키지는 조회하지 못했습니다. 아래 상태를 패키지별로 확인하세요.' },
  not_checked: { label: '아직 조회 안 함', note: '승인된 공개 패키지가 없어 조회하지 않았습니다. 취약점이 없다는 뜻이 아닙니다.' },
  not_configured: { label: '조회 준비 미완료', note: '조회 대상 프로젝트 설정이 없어 조회하지 않았습니다. 취약점이 없다는 뜻이 아닙니다.' },
  unverifiable: { label: 'lock 파일 확인 불가', note: 'package-lock.json을 확인하지 못해 조회하지 못했습니다. 취약점이 없다는 뜻이 아닙니다.' },
  unknown: { label: '확인 불가', note: '서버가 알 수 없는 조회 상태를 보냈습니다. 결과로 간주하지 마세요.' },
};

const VULN_PACKAGE_TEXT = {
  known_vulnerabilities: { label: '알려진 항목 있음', note: '' },
  none_found: { label: '알려진 항목 없음', note: '조회 범위·조회 시점 기준이며 안전을 보장하지 않습니다.' },
  unverifiable: { label: '조회 확인 불가', note: '이 패키지의 조회 결과를 확인하지 못했습니다. 취약점이 없다는 뜻이 아닙니다.' },
  unknown: { label: '확인 불가', note: '알 수 없는 상태입니다. 결과로 간주하지 마세요.' },
};

// 정확한 설치 버전(예: 1.2.3, 1.2.3-rc.1)만 버전으로 인정한다. ^1.2.0 같은 범위는 설치 버전이 아니다.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function vulnTime(value) {
  return typeof value === 'string' && value.trim() ? eventTime(value) : '시각 확인 불가';
}

function vulnRaw(table, value) {
  const raw = typeof value === 'string' && value ? value : 'unknown';
  const known = Object.hasOwn(table, raw) && raw !== 'unknown';
  return { raw: known ? raw : 'unknown', received: raw, entry: known ? table[raw] : table.unknown, known };
}

function vulnFindings(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => item && typeof item === 'object' && typeof item.id === 'string' && item.id);
}

function packageRow(pkg) {
  const row = makeNode('tr', null, 'student-vuln-row');
  const item = pkg && typeof pkg === 'object' ? pkg : {};
  const exact = typeof item.version === 'string' && EXACT_VERSION.test(item.version);
  const name = typeof item.name === 'string' && item.name ? safeValue(item.name) : '';
  if (name) row.setAttribute('data-student-package-name', name);
  if (exact) row.setAttribute('data-student-package-version', item.version);
  const findings = vulnFindings(item.vulnerabilities);
  const state = vulnRaw(VULN_PACKAGE_TEXT, item.status);
  let statusText = `${state.entry.label}(${state.known ? state.raw : safeValue(state.received)})`;
  let note = state.entry.note;
  if (state.raw === 'unverifiable' && findings.length > 0) {
    statusText = `일부 확인·전체 조회 확인 불가(${state.raw})`;
    note = '이미 받은 취약점 ID는 아래에 남겼습니다. 전체 조회는 확인하지 못했으므로 이 목록이 전부라고 볼 수 없습니다.';
  }
  const lead = makeNode('th', name || '이름 확인 불가');
  lead.setAttribute('scope', 'row');
  row.append(lead);
  row.append(makeNode('td', exact ? item.version : `${safeValue(item.version)} · 정확한 설치 버전이 아님`));
  const statusCell = makeNode('td');
  const normal = state.raw === 'none_found' || state.raw === 'known_vulnerabilities';
  statusCell.append(makeNode('span', `${normal ? '' : '주의 · '}${statusText}`, normal ? 'muted' : 'state state-error'));
  if (note) statusCell.append(makeNode('div', note, 'muted'));
  row.append(statusCell);
  const ids = makeNode('td');
  if (findings.length > 0) {
    const ul = makeNode('ul');
    for (const finding of findings) {
      ul.append(makeNode('li', `${safeValue(finding.id)} · 수정 시각: ${vulnTime(finding.modified)}`));
    }
    ids.append(ul);
  } else {
    ids.append(makeNode('span', state.raw === 'none_found' ? '알려진 항목 없음' : '받은 취약점 ID 없음', 'muted'));
  }
  row.append(ids);
  row.append(makeNode('td', safeValue(item.source)));
  row.append(makeNode('td', vulnTime(item.checkedAt)));
  return row;
}

function packageTable(packages) {
  const table = makeNode('table', null, 'student-vuln-table');
  const head = makeNode('tr');
  for (const label of ['패키지', '설치 버전', '조회 상태', '취약점 ID · 수정 시각', '출처', '패키지 조회 시각']) {
    const cell = makeNode('th', label);
    cell.setAttribute('scope', 'col');
    head.append(cell);
  }
  const thead = makeNode('thead');
  thead.append(head);
  const tbody = makeNode('tbody');
  for (const pkg of packages) tbody.append(packageRow(pkg));
  table.append(thead, tbody);
  return table;
}

function vulnerabilitiesSection(input) {
  const source = input && typeof input === 'object' ? input : {};
  const { status, mode, data, error } = source;
  const section = makeNode('section');
  section.append(makeNode('h3', '설치 패키지 버전과 알려진 취약점 조회 결과'));
  if (status === 'idle') {
    section.append(makeNode('p', '조회 전: 아직 설치 패키지를 조회하지 않았습니다. 취약점이 없다는 뜻이 아닙니다.', 'state state-empty'));
    return section;
  }
  if (status === 'loading') {
    section.append(makeNode('p', '조회 중: 결과가 오기 전까지 이전 결과는 표시하지 않습니다.', 'state state-loading'));
    return section;
  }
  if (status === 'error') {
    const code = error && typeof error === 'object' ? safeCode(error.code) : '확인 불가';
    const message = error && typeof error === 'object' ? safeValue(error.message) : '확인 불가';
    section.append(makeNode('p', `조회 실패: ${message}`, 'state state-error'));
    section.append(makeNode('p', `오류 코드: ${code}`, 'muted'));
    section.append(makeNode('p', '이전 조회 결과는 현재 결과가 아니므로 표시하지 않습니다. 조회 실패는 "취약점 없음"이 아닙니다. 필요하면 직접 다시 조회하세요.', 'muted'));
    return section;
  }
  if (status !== 'ok' || !data || typeof data !== 'object') {
    section.append(makeNode('p', '확인 불가: 조회 상태를 알 수 없어 결과를 표시하지 않습니다. 취약점이 없다는 뜻이 아닙니다.', 'state state-empty'));
    return section;
  }
  if (mode === 'demo') section.append(makeNode('p', MODE_TEXT.demo, 'muted'));
  const scan = vulnRaw(VULN_SCAN_TEXT, data.status);
  const normal = scan.raw === 'complete';
  const badge = makeNode('p');
  badge.append(makeNode('span', `${normal ? '' : '주의 · '}${scan.entry.label}(${scan.known ? scan.raw : safeValue(scan.received)})`, normal ? 'muted' : 'state state-error'));
  if (scan.entry.note) badge.append(makeNode('span', ` ${scan.entry.note}`, 'muted'));
  section.append(badge);
  const facts = makeNode('dl', null, 'kv');
  const addFact = (name, value) => {
    if (value === '' || value == null) return;
    facts.append(makeNode('dt', name), makeNode('dd', String(value)));
  };
  addFact('lockfileVersion', Number.isFinite(data.lockfileVersion) ? data.lockfileVersion : '');
  addFact('lockfileHash', typeof data.lockfileHash === 'string' && data.lockfileHash ? safeValue(data.lockfileHash) : '');
  addFact('조회 시각', typeof data.checkedAt === 'string' && data.checkedAt ? vulnTime(data.checkedAt) : '');
  if (facts.childElementCount > 0) section.append(facts);
  const packages = Array.isArray(data.packages) ? data.packages : [];
  if (packages.length > 0) {
    section.append(packageTable(packages));
    section.append(makeNode('p', '「알려진 항목 없음」은 이번 조회 범위에서 알려진 항목이 없다는 뜻이며, 패키지나 앱 전체의 안전을 보장하지 않습니다. 설치 버전은 package-lock.json과 설치된 node_modules 정보를 대조한 값입니다.', 'muted'));
  } else if (scan.raw === 'complete') {
    section.append(makeNode('p', '표시할 패키지 조회 결과가 없습니다.', 'muted'));
  } else {
    section.append(makeNode('p', '조회한 패키지가 없습니다. 이 상태는 "취약점 없음"이 아닙니다.', 'muted'));
  }
  return section;
}

export function createStudentView() {
  return {
    renderIdentity({ me, devices, sessions } = {}) {
      const root = makeNode('div', null, 'student-identity');
      root.append(identitySection(me), deviceSection(devices), sessionSection(sessions));
      return root;
    },
    renderDecision(input) {
      const root = makeNode('div', null, 'student-decision');
      root.append(decisionSection(input));
      return root;
    },
    renderEvents(input) {
      const root = makeNode('div', null, 'student-events');
      root.append(eventsSection(input));
      return root;
    },
    renderStatus(input) {
      const root = makeNode('div', null, 'student-status');
      root.append(statusSection(input));
      return root;
    },
    renderVulnerabilities(input) {
      const root = makeNode('div', null, 'student-vulnerabilities');
      root.append(vulnerabilitiesSection(input));
      return root;
    },
    renderAiConnection(input) {
      const root = makeNode('div', null, 'student-ai-connection');
      root.append(aiConnectionSection(input));
      return root;
    },
    renderExplanation(input) {
      // data-student-explanation-event 는 바깥 요소에 붙여야 하므로 감싸지 않고 그대로 돌려준다.
      const root = explanationSection(input);
      root.className = 'student-explanation';
      return root;
    },
    renderAction(input) {
      // data-student-action-* 표식은 바깥 요소에 붙어야 하므로 감싸지 않고 그대로 돌려준다.
      const root = actionSection(input);
      root.className = 'student-action';
      return root;
    },
  };
}
