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
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
