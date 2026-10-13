// 가상 메모 CRUD 처리입니다. api/notes.js가 이 함수를 그대로 내보냅니다.
// 로그인 확인은 틀의 src/verify-login.mjs가 합니다. 사용자 ID는 그 결과(principal.userId)만 쓰고,
// 요청 본문·헤더·쿼리의 userId·owner_id·role 같은 값은 읽지 않습니다.
// 4단계: 모든 메모 요청에서 서버가 확인한 사용자 ID와 DB의 owner_id를 비교합니다.
// GET·PUT·DELETE /:id는 기존 행의 owner_id가 본인일 때만 처리하고, 남의 메모·주인 없는 메모·없는 메모는
// 모두 같은 404로 답합니다(존재 여부를 알려 주지 않음). 쓰기·삭제에도 owner_id 조건을 다시 걸고,
// 수정은 owner_id를 바꾸지 않으며 수정 뒤 행의 소유자도 본인인지 확인합니다.
// 키 값은 응답·로그에 넣지 않고, 오류 응답에는 일반 오류 이름만 담습니다.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { noteResourceId } from './resources.mjs';
import { saveBackup } from './notes-backup.mjs';
import { traceAnonymous, traceJudge } from './judge-trace.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_TITLE = 200;
const MAX_BODY = 5000;

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

// 거부 사유는 서버 로그에만 짧은 코드로 남깁니다. 사용자·메모 ID, 토큰, 본문은 싣지 않고 응답도 바꾸지 않습니다.
function logDenied(request, reason) {
  console.warn(`notes denied: ${reason} ${request.method}`);
}

export function createNotesHandler({ getDeps = envDeps, newId = randomUUID, saveBackup: backup = saveBackup } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const rawId = request.query?.id;
    const hasId = rawId !== undefined;
    // 복구 요청은 api/restore/[id].js(POST /api/restore/:id)가 자기 restore 함수를 붙여 넘긴 것뿐입니다. 쿼리 값으로는 열리지 않고 POST만 받습니다.
    const isRestore = typeof request.restore === 'function';
    const allowed = isRestore ? ['POST'] : hasId ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
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
    const label = isRestore ? 'restore' : hasId ? 'item' : 'collection';
    if (!principal) {
      traceAnonymous(request, label);
      logDenied(request, 'unauthenticated');
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    // 심판의 요청은 모양만 서버 로그에 남깁니다(값 없음). 동작은 바꾸지 않습니다. 학생 본인의 요청은 기록하지 않습니다.
    if (principal.kind === 'judge') traceJudge(request, principal, response, label);

    if ((hasId || isRestore) && (typeof rawId !== 'string' || !UUID.test(rawId))) {
      // 복구 경로는 형식이 틀린 ID도 없는 메모와 같은 404로 답합니다(존재 여부를 알려 주지 않음).
      return isRestore ? response.status(404).json({ error: 'NOT_FOUND' }) : response.status(400).json({ error: 'INVALID_ID' });
    }
    // 8단계: 이 요청이 가리키는 자원 ID를 서버가 경로에서만 계산합니다(응답에는 싣지 않음).
    request.resourceId = noteResourceId(hasId ? rawId : undefined);
    if (isRestore) {
      try {
        const result = await request.restore({ db: deps.db, principal, id: rawId.toLowerCase(), body: request.body });
        return response.status(result.code).json(result.json);
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
        // 10단계: 만든 직후 검증용 사본을 한 번 남깁니다(실패해도 메모 만들기는 성공, 서버 로그에만 남음).
        await backup({ db: deps.db, principal, noteId: id.toLowerCase(), title: input.title, content: input.body, source: 'create' });
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
      // 10단계: 처음 고치거나 지우기 직전 상태도 사본으로 남깁니다. 사본이 이미 있으면 그대로 두므로 변조가 사본을 덮어쓸 수 없고,
      // 사본이 없던 옛 메모도 이때부터 복원할 수 있습니다. 저장할 내용은 이미 읽어 둔 값이라 실제 수정·삭제와 동시에 하며,
      // 응답은 둘 다 끝난 뒤에 돌려줍니다. 사본 저장이 실패해도 수정·삭제는 그대로 진행하고 서버 로그에만 남습니다.
      const snapshot = typeof existing.title === 'string' && typeof existing.content === 'string'
        ? backup({ db: deps.db, principal, noteId: String(existing.id).toLowerCase(), title: existing.title, content: existing.content, source: 'before_change' })
        : Promise.resolve();
      if (request.method === 'PUT') {
        // owner_id는 바꾸지 않고, 조건에도 owner_id를 걸어 그 사이 소유자가 바뀐 행은 건드리지 않는다.
        const [{ data, error }] = await Promise.all([deps.db.from('notes')
          .update({ title: input.title, content: input.body })
          .eq('id', rawId).eq('owner_id', principal.userId).select('id, owner_id'), snapshot]);
        if (error) throw error;
        if (!data?.length) { logDenied(request, 'owner_changed'); return response.status(404).json({ error: 'NOT_FOUND' }); }
        if (data.some(row => row.owner_id !== principal.userId)) throw new Error('owner changed');
        return response.status(200).json({ id: rawId });
      }
      const [{ data, error }] = await Promise.all([deps.db.from('notes').delete()
        .eq('id', rawId).eq('owner_id', principal.userId).select('id'), snapshot]);
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
