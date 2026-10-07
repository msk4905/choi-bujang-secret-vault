// 무차별 로그인 경보 판단 모듈입니다. 경보를 patterns.json의 패턴과 맞춰 보고,
// 애매한 경보만 Jev에게 물어 확신도(0~1)를 받습니다. 원본 경보는 고치지 않습니다.
//
// 확신도 기준: 0.85 이상 block, 0.5 이상 alert, 그 아래 record.
// Jev 호출: 환경변수 JEV_URL(주소)이 있을 때만 POST로 보냅니다. 주소·토큰은 코드에 적지 않습니다.
//   보내는 값: { id, time, srcip, srcuser, level, description, pattern } (비밀값처럼 보이는 값은 가림)
//   받는 값:   { "confidence": 0~1 }
// 주소가 없거나, 응답이 없거나, 시간이 넘거나, 값이 틀리면 alert로 떨어집니다.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractAlert } from './read-alerts.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const patternFile = JSON.parse(await readFile(join(here, 'patterns.json'), 'utf8'));
const KNOWN = new Set(patternFile.patterns.map((p) => p.name));

const BURST = 'same-address-failure-burst';
const SPRAY = 'multi-account-same-password';
for (const name of [BURST, SPRAY]) {
  if (!KNOWN.has(name)) throw new Error(`patterns.json에 없는 패턴 이름: ${name}`);
}

export const BLOCK_AT = 0.85;
export const ALERT_AT = 0.5;
const CLEAR_LEVEL = 10; // 규칙 수준이 이 이상이고
const CLEAR_COUNT = 15; // 실패가 이 건수 이상이면 명확한 공격으로 봅니다(수업 경보 기준).
const MIN_FAILS = 3; // 실패가 이보다 적으면 정상 이벤트로 기록합니다.
const JEV_TIMEOUT_MS = 3000;

export function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

function matchPattern(alert) {
  const description = String(alert?.rule?.description ?? '');
  const accounts = String(alert?.data?.accounts ?? '').split(',').filter(Boolean).length;
  const manyAccounts = accounts >= 3 || /계정\s*\d+개|여러 계정/.test(description);
  const fails = Number.parseInt(alert?.data?.count, 10);
  const failCount = Number.isFinite(fails) ? fails : 0;
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const pattern = manyAccounts ? SPRAY : BURST;
  return { pattern, failCount, level, hasSignal: manyAccounts || failCount >= MIN_FAILS };
}

async function defaultAskJev(payload) {
  const url = process.env.JEV_URL;
  if (!url) return null;
  const headers = { 'content-type': 'application/json' };
  if (process.env.JEV_TOKEN) headers.authorization = `Bearer ${process.env.JEV_TOKEN}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.confidence;
}

export function createDecide(askJev = defaultAskJev) {
  return async function decide(alert) {
    const { pattern, failCount, level, hasSignal } = matchPattern(alert);

    if (!hasSignal) {
      return { action: 'record', confidence: 0.05, reason: '로그인 실패가 몰린 신호가 없어 기록만 합니다.' };
    }

    if (level >= CLEAR_LEVEL && (failCount >= CLEAR_COUNT || pattern === SPRAY)) {
      const confidence = Math.min(0.97, Number((0.7 + level * 0.02).toFixed(2)));
      return { action: 'block', confidence, reason: `${pattern}: 규칙 수준 ${level}, 패턴과 분명히 맞습니다.` };
    }

    let confidence = null;
    try {
      const row = extractAlert(alert);
      confidence = await askJev({ id: alert?.id, ...row, pattern });
    } catch {
      confidence = null;
    }
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { action: 'alert', confidence: ALERT_AT, reason: `${pattern}: 애매한데 Jev 응답이 없어 alert로 둡니다.` };
    }
    return { action: actionFor(confidence), confidence, reason: `${pattern}: Jev 확신도 ${confidence}` };
  };
}

export const decide = createDecide();
