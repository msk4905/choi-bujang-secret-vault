// 가상 메모 CRUD 처리입니다. api/notes.js가 이 함수를 그대로 내보냅니다.
// 로그인 확인은 틀의 src/verify-login.mjs가 합니다. 사용자 ID는 그 결과(principal.userId)만 쓰고,
// 요청 본문·헤더·쿼리의 userId·owner_id·role 같은 값은 읽지 않습니다.
// 4단계: 모든 메모 요청에서 서버가 확인한 사용자 ID와 DB의 owner_id를 비교합니다.
// GET·PUT·DELETE /:id는 기존 행의 owner_id가 본인일 때만 처리하고, 남의 메모·주인 없는 메모·없는 메모는
// 모두 같은 404로 답합니다(존재 여부를 알려 주지 않음). 쓰기·삭제에도 owner_id 조건을 다시 걸고,
// 수정은 owner_id를 바꾸지 않으며 수정 뒤 행의 소유자도 본인인지 확인합니다.
// 키 값은 응답·로그에 넣지 않고, 오류 응답에는 일반 오류 이름만 담습니다.
// 10단계: POST /api/notes/restore는 비공개 사본에서 본인 메모 한 건만 복원합니다(src/note-restore.mjs).
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { noteResourceId } from './resources.mjs';
import { restoreOneNote } from './note-restore.mjs';
import { buildWarRoom } from './war-room.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_TITLE = 200;
const MAX_BODY = 5000;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

let cached = null;
function envDeps() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  if (!cached || cached.key !== key || cached.url !== url) {
    cached = {
      url, key,
      verify: createLoginVerifier({ config, supabaseSecretKey: key }),
      db: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    };
  }
  return cached;
}

function readInput(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { id, title, body: text } = body;
  if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) return null;
  if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) return null;
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_BODY) return null;
  return { id, title: title.trim(), body: text };
}

// 10단계 복원 요청 처리: 401 로그인 없음 · 400 INVALID_RESTORE 본문 형식 · 405 POST 외 · 그 밖의 상태 코드는 src/note-restore.mjs의 응답 규약을 따릅니다.
// 10단계 복원 요청: 본문에서 id만 필수이고, contentSha256은 보내면 사본과 대조합니다(보내지 않아도 됨).
// 소유자 칸 같은 모르는 값은 무시하며 읽지 않습니다. 소유자는 서버가 확인한 사용자 ID로만 사본과 대조합니다.
function readRestoreInput(request) {
  let body = request.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return null;
  const sent = body.contentSha256;
  if (sent !== undefined && (typeof sent !== 'string' || !SHA256_HEX.test(sent.toLowerCase()))) return null;
  return { id: body.id.toLowerCase(), contentSha256: sent === undefined ? undefined : sent.toLowerCase() };
}

// 거부 사유는 서버 로그에만 짧은 코드로 남깁니다. 사용자·메모 ID, 토큰, 본문은 싣지 않고 응답도 바꾸지 않습니다.
function logDenied(request, reason) {
  console.warn(`notes denied: ${reason} ${request.method}`);
}

export function createNotesHandler({ getDeps = envDeps, newId = randomUUID, newAuditId = randomUUID } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const rawId = request.query?.id;
    const hasId = rawId !== undefined;
    // 10단계: POST /api/notes/restore (vercel.json이 ?restore=1로 넘김). 주소에 id가 있으면 복원 경로가 아닙니다.
    const isRestore = !hasId && request.query?.restore === '1';
    // 12단계: GET /api/war-room (vercel.json이 ?warRoom=1로 넘김). 로그인한 본인의 가린 요약만 돌려줍니다.
    const isWarRoom = !hasId && !isRestore && request.query?.warRoom === '1';
    const allowed = isWarRoom ? ['GET'] : isRestore ? ['POST'] : hasId ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
    if (!allowed.includes(request.method)) {
      response.setHeader('Allow', allowed.join(', '));
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    let deps;
    try { deps = getDeps(); } catch {
      console.error('notes setup failed');
      deps = null;
    }
    if (!deps) return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });

    let principal = null;
    try { principal = await deps.verify(request.headers?.authorization); } catch {
      console.error('login verifier failed');
    }
    if (!principal) {
      logDenied(request, 'unauthenticated');
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    if (isWarRoom) {
      try {
        return response.status(200).json(await buildWarRoom({ db: deps.db, userId: principal.userId }));
      } catch {
        console.error('war room failed');
        return response.status(502).json({ error: 'WAR_ROOM_UNAVAILABLE' });
      }
    }
    if (hasId && (typeof rawId !== 'string' || !UUID.test(rawId))) {
      return response.status(400).json({ error: 'INVALID_ID' });
    }
    // 8단계: 이 요청이 가리키는 자원 ID를 서버가 경로에서만 계산합니다(응답에는 싣지 않음).
    request.resourceId = noteResourceId(hasId ? rawId : undefined);
    if (isRestore) {
      // 복원: 로그인 확인 뒤, 요청의 id(필수)와 contentSha256(선택)으로 본인의 사본 한 건만 복원합니다.
      const restoreInput = readRestoreInput(request);
      if (!restoreInput) return response.status(400).json({ error: 'INVALID_RESTORE' });
      request.resourceId = noteResourceId(restoreInput.id);
      try {
        const result = await restoreOneNote({ db: deps.db, userId: principal.userId, input: restoreInput, newAuditId });
        if (result.status !== 200) logDenied(request, `restore_${result.json.error.toLowerCase()}`);
        return response.status(result.status).json(result.json);
      } catch {
        console.error('notes restore failed');
        return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
      }
    }
    const input = request.method === 'POST' || request.method === 'PUT' ? readInput(request) : null;
    if ((request.method === 'POST' || request.method === 'PUT') && !input) {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }

    try {
      const notes = deps.db.from('notes');
      if (!hasId && request.method === 'GET') {
        const { data, error } = await notes.select('id, title, content')
          .eq('owner_id', principal.userId)
          .order('created_at', { ascending: true }).order('id', { ascending: true });
        if (error) throw error;
        return response.status(200).json(data.map(row => ({ id: row.id, title: row.title, body: row.content })));
      }
      if (!hasId && request.method === 'POST') {
        const id = input.id ?? newId();
        const { error } = await notes.insert({
          id, title: input.title, content: input.body, owner_id: principal.userId,
        });
        if (error?.code === '23505') return response.status(409).json({ error: 'ID_EXISTS' });
        if (error) throw error;
        return response.status(201).json({ id });
      }
      // 기존 행의 owner_id를 DB에서 읽어 확인된 사용자 ID와 비교한다. URL·본문의 값은 쓰지 않는다.
      const { data: existing, error: readError } = await notes
        .select('id, title, content, owner_id').eq('id', rawId).maybeSingle();
      if (readError) throw readError;
      if (!existing || existing.owner_id !== principal.userId) {
        logDenied(request, !existing ? 'not_found' : existing.owner_id ? 'not_owner' : 'no_owner');
        return response.status(404).json({ error: 'NOT_FOUND' });
      }
      if (request.method === 'GET') {
        return response.status(200).json({ id: existing.id, title: existing.title, body: existing.content });
      }
      if (request.method === 'PUT') {
        // owner_id는 바꾸지 않고, 조건에도 owner_id를 걸어 그 사이 소유자가 바뀐 행은 건드리지 않는다.
        const { data, error } = await deps.db.from('notes')
          .update({ title: input.title, content: input.body })
          .eq('id', rawId).eq('owner_id', principal.userId).select('id, owner_id');
        if (error) throw error;
        if (!data?.length) { logDenied(request, 'owner_changed'); return response.status(404).json({ error: 'NOT_FOUND' }); }
        if (data.some(row => row.owner_id !== principal.userId)) throw new Error('owner changed');
        return response.status(200).json({ id: rawId });
      }
      const { data, error } = await deps.db.from('notes').delete()
        .eq('id', rawId).eq('owner_id', principal.userId).select('id');
      if (error) throw error;
      if (!data?.length) { logDenied(request, 'owner_changed'); return response.status(404).json({ error: 'NOT_FOUND' }); }
      return response.status(204).end();
    } catch {
      console.error('notes request failed');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createNotesHandler();
