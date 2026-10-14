// 12단계 탈환 작전실이 읽는 요약입니다(GET /api/war-room, 로그인 필요).
// 항목마다 status를 붙입니다: confirmed(이 응답의 출처에서 실제로 읽음) · not_run(이 저장소에는 읽을 출처가 없음)
// · unavailable(읽으려 했으나 실패). 통과·성공 같은 판정은 만들지 않고, 심판의 판정도 아닙니다.
// 메모 제목·본문·사용자 ID·전체 메모 ID·전체 해시는 담지 않습니다. 복구 기록은 로그인한 본인 것만, 끝 4자리·앞 8자리로 가려 보냅니다.
import snapshot from '../policy/safe-policy.snapshot.json' with { type: 'json' };
import { POLICY, RULE_IDS } from './decider.mjs';
import { policyHash } from './policy-restore.mjs';

const MAX_ROWS = 50;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const mask = id => (typeof id === 'string' && id.length >= 4 ? `…${id.slice(-4)}` : '…');

async function readOwn(db, table, columns, userId) {
  const { data, error } = await db.from(table).select(columns).eq('owner_id', userId)
    .order('created_at', { ascending: false }).limit(MAX_ROWS + 1);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function buildWarRoom({ db, userId, now = () => new Date().toISOString() }) {
  const decider = {
    status: 'confirmed',
    source: 'server_code',
    ruleIds: [...RULE_IDS],
    ruleCount: RULE_IDS.length,
    policyVersion: snapshot.version,
    snapshotSha256: String(snapshot.sha256).slice(0, 12),
    matchesSnapshot: policyHash(POLICY) === policyHash(snapshot.policy),
  };
  // 이 저장소에는 사건을 쌓는 곳도 반 엔진의 회수 상태를 읽는 길도 없습니다. 값을 만들어 보여 주지 않습니다.
  const detect = { status: 'not_run', reason: 'no_event_source' };
  const revocation = { status: 'not_run', reason: 'no_engine_link' };

  let restore;
  try {
    // 사본 표는 id만 읽어 개수만 셉니다. 제목·본문 칸은 요청하지 않습니다.
    const { data: copies, error } = await db.from('notes_backup_copy_v10').select('id').eq('owner_id', userId).limit(MAX_ROWS + 1);
    if (error) throw error;
    const audit = await readOwn(db, 'notes_restore_audit_v10', 'id, note_id, content_sha256, created_at', userId);
    const copyCount = Math.min((copies ?? []).length, MAX_ROWS);
    const records = audit.slice(0, MAX_ROWS).map(row => ({
      at: typeof row.created_at === 'string' ? row.created_at : null,
      noteIdEnd: mask(row.note_id),
      sha256Head: SHA256_HEX.test(row.content_sha256 ?? '') ? row.content_sha256.slice(0, 8) : null,
    }));
    restore = {
      status: 'confirmed',
      backupCopies: copyCount,
      restoreCount: records.length,
      truncated: audit.length > MAX_ROWS || (copies ?? []).length > MAX_ROWS,
      records,
    };
  } catch {
    restore = { status: 'unavailable', reason: 'read_failed' };
  }
  return { schema: 'aleph.war-room.v1', checkedAt: now(), decider, detect, revocation, restore };
}
