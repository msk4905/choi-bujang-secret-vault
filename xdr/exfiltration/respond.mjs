// decide 결과 가운데 차단 후보만 거부 규칙 파일로 만들고, 알림을 xdr/alerts.log 에 한 줄씩 쌓습니다.
// decide.mjs 는 판단만 하고, 파일 쓰기는 이 파일에서만 합니다. src/decider.mjs 와 기존 규칙은 고치지 않습니다.
// 규칙은 자료가 나간 목적지(dstip)에 겁니다. 출발 주소나 계정으로 막으면 같은 사람의 정상 요청도 막히기 때문입니다.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide } from './decide.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(root, 'xdr', 'fixtures', 'exfiltration.json');
const RULES_FILE = join(root, 'xdr', 'deny-rules.json');
const ALERT_LOG = join(root, 'xdr', 'alerts.log');
const RULE_TTL_MS = 60 * 60 * 1000;
const SCHEMA = 'aleph.xdr.deny-rules.v1';
const RULE_PREFIX = 'xdr.exfiltration.deny.';

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

// 차단 후보: decide 가 block 으로 답한 경보. 정상(record) 경보가 같은 목적지를 쓰면 제외합니다.
export function buildDenyRules(alerts, now = Date.now(), ttlMs = RULE_TTL_MS) {
  const judged = alerts.map((alert) => ({ alert, result: decide(alert) }));
  const normalDestinations = new Set(judged
    .filter(({ result }) => result.action === 'record')
    .map(({ alert }) => alert?.data?.dstip)
    .filter(Boolean));
  const byDestination = new Map();
  const skipped = [];
  for (const { alert, result } of judged) {
    if (result.action !== 'block') continue;
    const dstip = alert?.data?.dstip;
    if (typeof dstip !== 'string' || !IPV4.test(dstip) || typeof alert.id !== 'string') {
      skipped.push({ alertId: alert?.id ?? null, why: '목적지나 경보 번호가 올바르지 않습니다.' });
      continue;
    }
    if (normalDestinations.has(dstip)) {
      skipped.push({ alertId: alert.id, why: '정상 이벤트가 쓰는 목적지라 막지 않습니다.' });
      continue;
    }
    const rule = byDestination.get(dstip) ?? {
      ruleId: `${RULE_PREFIX}${dstip}`,
      dstip,
      direction: 'outbound',
      action: 'deny',
      evidenceAlertIds: [],
      confidence: 0,
      reason: result.reason,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };
    rule.evidenceAlertIds.push(alert.id);
    if (result.confidence > rule.confidence) {
      rule.confidence = result.confidence;
      rule.reason = result.reason;
    }
    byDestination.set(dstip, rule);
  }
  return { rules: [...byDestination.values()], skipped };
}

// 만료된 규칙은 맞지 않습니다. 목적지가 없거나 규칙에 없으면 null 이라 요청은 통과합니다.
export function findDenyRule(rules, dstip, now = Date.now()) {
  if (typeof dstip !== 'string') return null;
  return rules.find((rule) => rule.ruleId?.startsWith(RULE_PREFIX)
    && rule.dstip === dstip && Date.parse(rule.expiresAt) > now) ?? null;
}

async function loadRules() {
  try {
    const stored = JSON.parse(await readFile(RULES_FILE, 'utf8'));
    return Array.isArray(stored.rules) ? stored.rules : [];
  } catch {
    return [];
  }
}

// 다른 모듈의 규칙은 그대로 둡니다. 이 모듈 규칙은 ruleId 로만 합치고, 만료된 것은 버립니다.
function mergeRules(stored, fresh, now) {
  const kept = stored.filter((rule) => !rule.ruleId?.startsWith(RULE_PREFIX) || Date.parse(rule.expiresAt) > now);
  for (const rule of fresh) {
    const old = kept.find((item) => item.ruleId === rule.ruleId);
    if (!old) { kept.push(rule); continue; }
    old.evidenceAlertIds = [...new Set([...old.evidenceAlertIds, ...rule.evidenceAlertIds])];
    old.expiresAt = rule.expiresAt;
    if (rule.confidence > old.confidence) { old.confidence = rule.confidence; old.reason = rule.reason; }
  }
  return kept;
}

function logLine(alert, result) {
  return [alert.timestamp, result.action, alert.id, alert.data?.srcip, result.confidence, result.reason].join(' | ');
}

// 알림은 block 과 alert 만 한 줄씩 쌓습니다. 같은 경보·같은 행동은 다시 쌓지 않습니다.
export async function writeAlertLog(alerts, logPath = ALERT_LOG) {
  let existing = '';
  try { existing = await readFile(logPath, 'utf8'); } catch { /* 첫 실행 */ }
  const seen = new Set(existing.split('\n').filter(Boolean).map((line) => {
    const [, action, id] = line.split(' | ');
    return `${id}:${action}`;
  }));
  const lines = [];
  for (const alert of alerts) {
    const result = decide(alert);
    if (result.action === 'record' || seen.has(`${alert.id}:${result.action}`)) continue;
    lines.push(logLine(alert, result));
  }
  if (lines.length) await appendFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  return lines.length;
}

export async function respond(alerts, now = Date.now()) {
  const { rules, skipped } = buildDenyRules(alerts, now);
  const merged = mergeRules(await loadRules(), rules, now);
  await mkdir(dirname(RULES_FILE), { recursive: true });
  await writeFile(RULES_FILE, `${JSON.stringify({ schema: SCHEMA, rules: merged }, null, 2)}\n`, 'utf8');
  const logged = await writeAlertLog(alerts);
  return { rules: merged, skipped, logged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const { rules, skipped, logged } = await respond(fixture.alerts);
  const mine = rules.filter((rule) => rule.ruleId?.startsWith(RULE_PREFIX));
  console.log(`이 모듈 거부 규칙 ${mine.length}개 저장(전체 ${rules.length}개), 알림 ${logged}줄 추가, 제외 ${skipped.length}건`);
  for (const item of skipped) console.log(`제외 ${item.alertId}: ${item.why}`);
}
