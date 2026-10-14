// decide 결과 가운데 차단 후보만 거부 규칙 파일로 만들고, 알림을 xdr/alerts.log 에 한 줄씩 쌓습니다.
// decide.mjs 는 판단만 하고, 파일 쓰기는 이 파일에서만 합니다. src/decider.mjs 는 고치지 않습니다.
// 규칙은 출발 주소(srcip)에만 겁니다. 계정 이름으로 막으면 같은 계정의 정상 사용자도 막히기 때문입니다.
// 거부 규칙 파일은 다른 xdr 모듈과 같이 쓰므로, 규칙 이름(ruleId)이 xdr.privilege. 로 시작하는 것만 고칩니다.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decide } from './decide.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(root, 'xdr', 'fixtures', 'privilege.json');
const RULES_FILE = join(root, 'xdr', 'deny-rules.json');
const ALERT_LOG = join(root, 'xdr', 'alerts.log');
const RULE_TTL_MS = 60 * 60 * 1000;
const SCHEMA = 'aleph.xdr.deny-rules.v1';
const RULE_PREFIX = 'xdr.privilege.deny.';

function isIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/u.test(p) && Number(p) <= 255);
}

// 차단 후보: decide 가 block 으로 답한 경보. 같은 주소의 정상(record) 경보가 있으면 제외합니다.
export function buildDenyRules(alerts, now = Date.now(), ttlMs = RULE_TTL_MS) {
  const judged = alerts.map((alert) => ({ alert, result: decide(alert) }));
  const normalIps = new Set(judged
    .filter(({ result }) => result.action === 'record')
    .map(({ alert }) => alert?.data?.srcip));
  const bySource = new Map();
  const skipped = [];
  for (const { alert, result } of judged) {
    if (result.action !== 'block') continue;
    const srcip = alert?.data?.srcip;
    if (!isIpv4(srcip) || typeof alert.id !== 'string' || !alert.id) {
      skipped.push({ alertId: alert?.id ?? null, why: '주소나 경보 번호가 올바르지 않습니다.' });
      continue;
    }
    if (normalIps.has(srcip)) {
      skipped.push({ alertId: alert.id, why: '같은 주소에 정상 이벤트가 있어 막지 않습니다.' });
      continue;
    }
    const rule = bySource.get(srcip) ?? {
      ruleId: `${RULE_PREFIX}${srcip}`,
      srcip,
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
    bySource.set(srcip, rule);
  }
  return { rules: [...bySource.values()], skipped };
}

// 만료된 규칙은 맞지 않습니다. 주소가 없거나 규칙에 없으면 null 이라 요청은 통과합니다.
export function findDenyRule(rules, srcip, now = Date.now()) {
  if (typeof srcip !== 'string') return null;
  return rules.find((rule) => rule.srcip === srcip && Date.parse(rule.expiresAt) > now) ?? null;
}

// 파일이 없으면 빈 목록이지만, 있는데 읽을 수 없으면 멈춥니다. 다른 모듈의 규칙을 지우지 않기 위해서입니다.
async function loadRules(rulesFile) {
  let text;
  try {
    text = await readFile(rulesFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const stored = JSON.parse(text);
  if (!Array.isArray(stored?.rules)) throw new TypeError('invalid_deny_rules_file');
  return stored.rules;
}

const isMine = (rule) => typeof rule?.ruleId === 'string' && rule.ruleId.startsWith(RULE_PREFIX);

// 남의 규칙은 그대로 둡니다. 내 규칙만 만료된 것을 버리고, 같은 규칙 이름은 근거 경보를 합칩니다.
function mergeRules(stored, fresh, now) {
  const others = stored.filter((rule) => !isMine(rule));
  const mine = new Map();
  for (const rule of stored.filter(isMine)) {
    if (Date.parse(rule.expiresAt) > now) mine.set(rule.ruleId, rule);
  }
  for (const rule of fresh) {
    const old = mine.get(rule.ruleId);
    if (!old) { mine.set(rule.ruleId, rule); continue; }
    old.evidenceAlertIds = [...new Set([...old.evidenceAlertIds, ...rule.evidenceAlertIds])];
    old.expiresAt = rule.expiresAt;
    if (rule.confidence > old.confidence) { old.confidence = rule.confidence; old.reason = rule.reason; }
  }
  return [...others, ...mine.values()];
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
  if (lines.length) {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  }
  return lines.length;
}

export async function respond(alerts, now = Date.now(), { rulesFile = RULES_FILE, logFile = ALERT_LOG } = {}) {
  const { rules, skipped } = buildDenyRules(alerts, now);
  const merged = mergeRules(await loadRules(rulesFile), rules, now);
  await mkdir(dirname(rulesFile), { recursive: true });
  const temp = `${rulesFile}.tmp`;
  await writeFile(temp, `${JSON.stringify({ schema: SCHEMA, rules: merged }, null, 2)}\n`, 'utf8');
  await rename(temp, rulesFile);
  const logged = await writeAlertLog(alerts, logFile);
  return { rules: merged, mine: rules, skipped, logged };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const { rules, mine, skipped, logged } = await respond(fixture.alerts);
  console.log(`권한 상승 거부 규칙 ${mine.length}개 저장(파일 전체 ${rules.length}개), 알림 ${logged}줄 추가, 제외 ${skipped.length}건`);
  for (const item of skipped) console.log(`제외 ${item.alertId}: ${item.why}`);
}
