// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 규칙에 걸리지 않은 요청은 모두 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

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

export async function decide(request) {
  // 등록 기기(deviceRegistered === true)일 때만 허용합니다. false나 값 없음은 거부합니다.
  if (request?.deviceRegistered === true) {
    return {
      schema: 'aleph.decision.v1',
      requestId: request.requestId,
      decision: 'allow',
      reasonCode: 'approved',
      ruleIds: ['device_registered'],
    };
  }
  return {
    schema: 'aleph.decision.v1',
    requestId: request?.requestId,
    decision: 'deny',
    reasonCode: 'device_not_registered',
    ruleIds: ['device_registered'],
  };
}
