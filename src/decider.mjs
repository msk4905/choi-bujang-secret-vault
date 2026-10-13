// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 규칙에 걸리지 않은 요청은 모두 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
//
// 10단계: 판정 정책의 "데이터"(규칙 이름, 기기 확인, 추가 확인 기준, 구역 표)를 아래 POLICY 블록 한 곳에 모았습니다.
// 판정 "논리"(decide 안의 순서와 입력 검사)는 블록 밖에 있습니다. npm run policy:diff / policy:restore는
// 이 블록 안만 비교하고 다시 씁니다(scripts/policy-restore.mjs). 블록 밖의 코드는 건드리지 않습니다.
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

// 이 블록의 검증된 안전 사본: policy/safe-policy.snapshot.json (safe-v9). 사본과의 차이는 npm run policy:diff로 봅니다.
// POLICY-BLOCK-BEGIN
export const POLICY = deepFreeze({
  "schema": "aleph.decider.policy.v1",
  "ruleIds": [
    "device_registered",
    "step_up_required",
    "zone_notes_own_route",
    "zone_announcement_edit",
    "zone_unknown_route"
  ],
  "reasonCodes": {
    "allow": "approved",
    "deviceNotRegistered": "device_not_registered",
    "zoneNotAllowed": "zone_not_allowed",
    "stepUpRequired": "step_up_required"
  },
  "deviceGate": {
    "requireRegistered": true
  },
  "stepUp": {
    "enabled": true,
    "unusualHours": [
      0,
      1,
      2,
      3,
      4,
      5
    ],
    "unusualNetwork": "unusual",
    "burstKind": "risk_signal",
    "burstMinCount": 10,
    "burstWindowSeconds": 600,
    "maxAuthAgeSeconds": 900
  },
  "zoneCommon": {
    "denyUnknownRoutes": true,
    "queryMustBeEmpty": true,
    "reservedItemNames": [
      "export",
      "import",
      "search",
      "list",
      "all",
      "new",
      "admin",
      "config",
      "download",
      "bulk",
      "backup",
      "share",
      "public"
    ]
  },
  "services": {
    "notes": {
      "zones": {
        "GET /notes/:id": {
          "ruleId": "zone_notes_own_route",
          "method": "GET",
          "base": "/notes",
          "allow": true
        },
        "PUT /notes/:id": {
          "ruleId": "zone_notes_own_route",
          "method": "PUT",
          "base": "/notes",
          "allow": true
        },
        "GET /api/notes/:id": {
          "ruleId": "zone_notes_own_route",
          "method": "GET",
          "base": "/api/notes",
          "allow": true
        },
        "PUT /api/notes/:id": {
          "ruleId": "zone_notes_own_route",
          "method": "PUT",
          "base": "/api/notes",
          "allow": true
        }
      }
    },
    "announcements": {
      "zones": {
        "PUT /announcements/:id": {
          "ruleId": "zone_announcement_edit",
          "method": "PUT",
          "base": "/announcements",
          "allow": false
        },
        "PUT /api/announcements/:id": {
          "ruleId": "zone_announcement_edit",
          "method": "PUT",
          "base": "/api/announcements",
          "allow": false
        }
      }
    }
  }
});
// POLICY-BLOCK-END

export const RULE_IDS = POLICY.ruleIds;

// 엔진이 넘긴 request.signals의 출처를 구분합니다. 판정은 바꾸지 않고 입력만 읽습니다.
// 계약에 있는 출처는 'none'(실제 경로)과 'judge_fixture'(연습용)뿐이며, 둘 다 실제 위치 증거가 아닙니다.
// 헤더·쿼리 같은 클라이언트 값은 계약의 18개 이름에 없으므로 읽지 않습니다.
// 없거나 형식이 틀린 값은 null로 두고 정상값으로 채우지 않습니다.
const KNOWN_SOURCES = Object.freeze(['none', 'judge_fixture']);
const label = value => (typeof value === 'string' && /^[a-z0-9_-]{1,32}$/u.test(value)
  && value !== 'unknown' ? value : null);

export function readSignals(request) {
  const raw = request?.signals;
  const plain = raw && typeof raw === 'object' && !Array.isArray(raw);
  const source = plain && KNOWN_SOURCES.includes(raw.source) ? raw.source : 'unverified';
  const none = { origin: source, verified: false, region: null, network: null, hour: null };
  // 실제 위치 증거로 인정하는 출처가 계약에 아직 없으므로 verified는 항상 false입니다.
  if (!plain || source === 'none' || source === 'unverified') return none;
  return {
    origin: source,
    verified: false,
    region: label(raw.region),
    network: label(raw.network),
    hour: Number.isInteger(raw.hour) && raw.hour >= 0 && raw.hour <= 23 ? raw.hour : null,
  };
}

// 8단계 구역 규칙: 엔진이 확인한 method·route·path와 subjectId·deviceId만 봅니다. 쿼리로 기능을 고르지 않고
// (queryLength가 0이 아니면 거부) 자료 ID는 경로의 한 칸에서만 고릅니다. 표에 없는 경로는 모두 거부합니다.
// :id 칸의 기능 이름(export 등)은 자료 ID가 아니므로 거부합니다.
// 한계: 요청 계약에 메모 주인(owner)과 사용자 역할이 없고 subjectId는 가명이라 Supabase 사용자와 비교할 수 없습니다.
// 그래서 "자기 메모인지"는 여기서 판정하지 못하고 서버 함수(src/notes-handler.mjs)가 DB의 owner_id로 막습니다.
// 강사 공지 수정은 강사임을 확인할 값이 계약에 없어 누구에게도 허용하지 않습니다.
// 메모 전체 목록(/notes, /api/notes)은 여러 사람의 자료를 한꺼번에 여는 경로이고 판정기는 주인을 모르므로 열지 않습니다.
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

function buildZones(policy) {
  const reserved = policy.zoneCommon.reservedItemNames.map(escapeRegExp).join('|');
  const item = `${reserved ? `(?!(?:${reserved})$)` : ''}[A-Za-z0-9][A-Za-z0-9_-]{0,63}`;
  return Object.entries(policy.services).flatMap(([, service]) => Object.entries(service.zones).map(([route, zone]) => ({
    ruleId: zone.ruleId, method: zone.method, route, allow: zone.allow === true,
    path: new RegExp(`^${escapeRegExp(zone.base)}/${item}$`, 'iu'),
  })));
}

const reply = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1', requestId: request?.requestId, decision, reasonCode, ruleIds,
});

// 정책 데이터를 받아 decide 함수를 만듭니다. 기본 decide는 위 POLICY로 만든 것이고,
// 시험에서는 변조된 정책으로 만들어 허용·거부가 어떻게 달라지는지 봅니다.
export function createDecider(policy) {
  const zones = buildZones(policy);
  const { stepUp, reasonCodes } = policy;

  // step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 최근 대량 조회, 세 가지가 함께일 때만 추가 확인을 요청합니다.
  // 지역(region)은 판정에 쓰지 않으므로 지역 하나만으로는 거부·추가 확인 어느 쪽도 되지 않습니다.
  // 기준값은 연습 자료에 맞춘 가정입니다: 새벽 0~5시, network === 'unusual', risk_signal 합계 10건 이상(최근 10분).
  function burstCount(request) {
    if (!Array.isArray(request?.recentEvents)) return 0;
    return request.recentEvents.reduce((sum, event) => (
      event && event.kind === stepUp.burstKind && Number.isInteger(event.count) && event.count > 0
        && Number.isInteger(event.ageSeconds) && event.ageSeconds >= 0
        && event.ageSeconds <= stepUp.burstWindowSeconds ? sum + event.count : sum), 0);
  }

  function isUnusualAccess(request) {
    if (stepUp.enabled !== true) return false;
    const signals = readSignals(request);
    return stepUp.unusualHours.includes(signals.hour) && signals.network === stepUp.unusualNetwork
      && burstCount(request) >= stepUp.burstMinCount;
  }

  function recentlyVerified(request) {
    const step = request?.stepUp;
    return step?.verified === true && Number.isInteger(step.authAgeSeconds)
      && step.authAgeSeconds >= 0 && step.authAgeSeconds <= stepUp.maxAuthAgeSeconds;
  }

  function findZone(request) {
    if (typeof request?.subjectId !== 'string' || !request.subjectId) return null;
    if (typeof request.deviceId !== 'string' || !/^[0-9a-f]{16}$/u.test(request.deviceId)) return null;
    if (policy.zoneCommon.queryMustBeEmpty === true && request.queryLength !== 0) return null;
    return zones.find(zone => request.method === zone.method && request.route === zone.route
      && typeof request.path === 'string' && zone.path.test(request.path)) ?? null;
  }

  return async function decide(request) {
    // 등록 기기(deviceRegistered === true)일 때만 허용합니다. false나 값 없음은 거부합니다.
    if (policy.deviceGate.requireRegistered !== true || request?.deviceRegistered === true) {
      const zone = findZone(request);
      if (!zone) return reply(request, 'deny', reasonCodes.zoneNotAllowed, ['zone_unknown_route']);
      if (!zone.allow) return reply(request, 'deny', reasonCodes.zoneNotAllowed, [zone.ruleId]);
      if (isUnusualAccess(request) && !recentlyVerified(request)) {
        return reply(request, 'step_up', reasonCodes.stepUpRequired, ['step_up_required']);
      }
      if (isUnusualAccess(request)) return reply(request, 'allow', reasonCodes.allow, ['step_up_required']);
      return reply(request, 'allow', reasonCodes.allow, ['device_registered', zone.ruleId]);
    }
    return reply(request, 'deny', reasonCodes.deviceNotRegistered, ['device_registered']);
  };
}

export const decide = createDecider(POLICY);
