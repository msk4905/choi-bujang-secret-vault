// 심판(로그인 검사가 kind: 'judge'로 구분한 요청)이 이 서버에 어떤 모양의 요청을 보내고 어떤 응답을 받는지 서버 로그에 한 줄로 남깁니다.
// 값은 남기지 않습니다: 메모 내용·제목·ID·해시·토큰은 찍지 않고, 본문 키 이름과 값의 "종류"(uuid, 64자리 16진수 해시, 문자열 길이 구간 등)만 남깁니다.
// 학생 본인의 요청은 기록하지 않습니다. 동작은 바꾸지 않고 응답을 가로채 기록만 합니다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const KEY_OK = /^[A-Za-z0-9_.-]{1,30}$/u;
const SAFE_RESULT = new Set(['created', 'updated', 'unchanged']);
const SAFE_ERROR = /^[A-Z_]{1,40}$/u;

const bucket = (length) => (length === 0 ? '0' : length <= 10 ? '<=10' : length <= 100 ? '<=100' : length <= 1000 ? '<=1000' : '>1000');

export function shapeOf(value, depth = 0) {
  if (value === undefined) return 'none';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return 'num';
  if (typeof value === 'string') {
    if (UUID.test(value)) return 'uuid';
    if (/^[0-9a-f]{64}$/iu.test(value)) return 'hex64';
    if (/^sha256:[0-9a-f]{64}$/iu.test(value)) return 'sha256:hex64';
    if (/^[A-Za-z0-9+/]{43}=$/u.test(value)) return 'base64-32B';
    if (/^[A-Za-z0-9_-]{43}$/u.test(value)) return 'base64url-32B';
    return `str${bucket(value.length)}`;
  }
  if (typeof value === 'object') {
    if (depth >= 3) return 'obj...';
    const keys = Object.keys(value).sort().slice(0, 12);
    return `{${keys.map((k) => `${KEY_OK.test(k) ? k : '?'}:${shapeOf(value[k], depth + 1)}`).join(',')}}`;
  }
  return typeof value;
}

const contentType = (request) => String(request.headers?.['content-type'] ?? '').split(';')[0].trim().slice(0, 40).replace(/[^\w/+.-]/gu, '?') || 'none';
const userAgent = (request) => String(request.headers?.['user-agent'] ?? '').slice(0, 40).replace(/[^\w ./()-]/gu, '?') || 'none';

// label: 'collection' | 'item' | 'restore'. 반환값은 없고, 응답 status(...).json/end를 감싸 상태 코드가 정해질 때 한 줄을 남깁니다.
export function traceJudge(request, principal, response, label) {
  const started = Date.now();
  const query = { ...(request.query ?? {}) };
  delete query.id;
  const head = `trace: judge/${principal.identity === 'a' || principal.identity === 'b' ? principal.identity : '?'} ${String(request.method).slice(0, 8)} ${label}`;
  const request_ = `q=${shapeOf(query)} body=${typeof request.body === 'string' ? `text${bucket(request.body.length)}` : shapeOf(request.body)} ct=${contentType(request)} ua=${userAgent(request)}`;
  const originalStatus = response.status.bind(response);
  const emit = (code, payload) => {
    const parts = [];
    if (typeof payload?.error === 'string' && SAFE_ERROR.test(payload.error)) parts.push(`error=${payload.error}`);
    if (typeof payload?.restored === 'string' && SAFE_RESULT.has(payload.restored)) parts.push(`restored=${payload.restored}`);
    if (payload?.preview === true) parts.push('preview');
    if (payload?.verified === true) parts.push('verified');
    console.info(`${head} ${request_} -> ${code}${parts.length ? ` ${parts.join(' ')}` : ''} ${Date.now() - started}ms`);
  };
  response.status = (code) => {
    const out = originalStatus(code);
    return {
      json: (payload) => { emit(code, payload); return out.json(payload); },
      end: (...args) => { emit(code); return out.end(...args); },
    };
  };
}

// 로그인 검사에 실패한 요청은 본문 없이 최소한만 남깁니다(심판의 토큰이 만료·거부되는 경우를 알아보기 위해).
export function traceAnonymous(request, label) {
  console.info(`trace: anon ${String(request.method).slice(0, 8)} ${label} ua=${userAgent(request)} -> 401`);
}
