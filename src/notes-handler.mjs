// 가상 메모 CRUD 처리입니다. api/notes.js가 이 함수를 그대로 내보냅니다.
// 로그인 확인은 틀의 src/verify-login.mjs가 합니다. 사용자 ID는 그 결과(principal.userId)만 쓰고,
// 요청 본문·헤더·쿼리의 userId·owner_id·role 같은 값은 읽지 않습니다.
// 주의(4단계 과제): 아직 소유자 검사를 하지 않아서 GET·PUT·DELETE /:id는 로그인만 하면
// 남의 메모에도 닿습니다. 목록 GET만 본인 메모로 좁혀 둡니다.
// 키 값은 응답·로그에 넣지 않고, 오류 응답에는 일반 오류 이름만 담습니다.
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';

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

export function createNotesHandler({ getDeps = envDeps, newId = randomUUID } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const rawId = request.query?.id;
    const hasId = rawId !== undefined;
    const allowed = hasId ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
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
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHENTICATED' });
    }

    if (hasId && (typeof rawId !== 'string' || !UUID.test(rawId))) {
      return response.status(400).json({ error: 'INVALID_ID' });
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
      if (request.method === 'GET') {
        const { data, error } = await notes.select('id, title, content').eq('id', rawId).maybeSingle();
        if (error) throw error;
        if (!data) return response.status(404).json({ error: 'NOT_FOUND' });
        return response.status(200).json({ id: data.id, title: data.title, body: data.content });
      }
      if (request.method === 'PUT') {
        const { data, error } = await notes.update({ title: input.title, content: input.body })
          .eq('id', rawId).select('id');
        if (error) throw error;
        if (!data?.length) return response.status(404).json({ error: 'NOT_FOUND' });
        return response.status(200).json({ id: rawId });
      }
      const { data, error } = await notes.delete().eq('id', rawId).select('id');
      if (error) throw error;
      if (!data?.length) return response.status(404).json({ error: 'NOT_FOUND' });
      return response.status(204).end();
    } catch {
      console.error('notes request failed');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createNotesHandler();
