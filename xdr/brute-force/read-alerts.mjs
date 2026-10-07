// 무차별 로그인 경보(xdr/fixtures/brute-force.json)에서 시각·출발 주소·계정·규칙 수준·설명만 읽습니다.
// 원본 파일은 읽기만 하고, 비밀값처럼 보이는 값은 [가림]으로 바꿔 출력합니다.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIDDEN = '[가림]';
const KEY_VALUE = /\b(password|passwd|pwd|token|secret|api[_-]?key|apikey|authorization)\b(\s*[=:]\s*)\S+/gi;
const SECRET_PATTERNS = [
  /\bBearer\s+\S+/gi,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g,
  /\b(?:sk|pk|sb|ghp|gho|xox[a-z])[-_][\w-]{16,}/gi,
  /\b[A-Za-z0-9+/_-]{32,}={0,2}/g,
];

export function maskSecrets(text) {
  let out = String(text ?? '').replace(KEY_VALUE, (_match, key, sep) => `${key}${sep}${HIDDEN}`);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, HIDDEN);
  return out;
}

export function extractAlert(alert) {
  return {
    time: maskSecrets(alert?.timestamp),
    srcip: maskSecrets(alert?.data?.srcip),
    srcuser: maskSecrets(alert?.data?.srcuser),
    level: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: maskSecrets(alert?.rule?.description),
  };
}

export async function readAlerts(root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')) {
  const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'brute-force.json'), 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'brute-force' || !Array.isArray(fixture.alerts)) {
    throw new Error('brute-force 경보 묶음 형식이 아닙니다.');
  }
  return { total: fixture.alerts.length, rows: fixture.alerts.map(extractAlert) };
}

export function formatRow(row) {
  return [row.time, row.srcip, row.srcuser, `level ${row.level ?? '?'}`, row.description].join(' | ');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { total, rows } = await readAlerts();
  for (const row of rows) console.log(formatRow(row));
  const same = total === rows.length;
  console.log(`경보 ${total}건, 뽑은 줄 ${rows.length}줄: ${same ? '같음' : '다름'}`);
  if (!same) process.exitCode = 1;
}
