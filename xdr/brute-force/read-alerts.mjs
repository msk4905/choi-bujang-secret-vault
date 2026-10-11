// 확인용 읽기 모듈입니다. decide.mjs 가 불러오지 않습니다.
// xdr/fixtures/brute-force.json 의 경보에서 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다.
// 원본 경보는 읽기만 하고 고치지 않으며, 비밀값처럼 보이는 문자열은 [가림]으로 바꿔 출력합니다.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(root, 'xdr', 'fixtures', 'brute-force.json');

const SECRET_PATTERNS = [
  /\b(password|passwd|pwd|token|secret|api[_-]?key|authorization)\b\s*[=:]\s*\S+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g,
];

export function mask(value) {
  let text = String(value ?? '');
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[가림]');
  return text;
}

export function pickAlert(alert) {
  return {
    time: mask(alert?.timestamp),
    srcip: mask(alert?.data?.srcip),
    user: mask(alert?.data?.srcuser),
    level: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: mask(alert?.rule?.description),
  };
}

export async function readAlerts(path = FIXTURE) {
  const fixture = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(fixture.alerts)) throw new TypeError('invalid_fixture_alerts');
  return { total: fixture.alerts.length, rows: fixture.alerts.map(pickAlert) };
}

export function formatRow(row) {
  return `${row.time} | ${row.srcip} | ${row.user} | level ${row.level} | ${row.description}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { total, rows } = await readAlerts();
  for (const row of rows) console.log(formatRow(row));
  console.log(`경보 ${total}건, 뽑은 줄 ${rows.length}줄`);
  if (total !== rows.length) {
    console.error('건수 불일치');
    process.exitCode = 1;
  }
}
