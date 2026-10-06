// 학습용 가상 메모를 서버 쪽에서만 Supabase에서 읽는 함수입니다.
// 3단계: 요청의 Authorization 토큰을 틀의 src/verify-login.mjs로 검사하고, 통과한 로그인에만 돌려줍니다.
// 브라우저가 보낸 userId·role 같은 값은 읽지 않습니다.
// SUPABASE_URL과 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽습니다.
// 키 값은 응답·로그·브라우저 파일에 절대 넣지 않습니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

// 함수 실행 환경에서 한 번만 만들어 공개키 캐시를 재사용합니다.
let verifier = null;

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    return response.status(503).json({ error: 'NOTES_NOT_CONFIGURED' });
  }
  let principal = null;
  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: key });
    principal = await verifier(request.headers.authorization);
  } catch {
    console.error('login verifier failed');
  }
  if (!principal) {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return response.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  try {
    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // owner_id는 응답에 싣지 않고 화면에 필요한 두 칸만 고릅니다.
    const { data, error } = await supabase
      .from('notes')
      .select('title, content')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) {
      console.error('notes query failed');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
    return response.status(200).json({ notes: data });
  } catch {
    console.error('notes request failed');
    return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
  }
}
