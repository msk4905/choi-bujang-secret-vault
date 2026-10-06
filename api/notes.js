// 가상 메모 API입니다. 실제 처리는 src/notes-handler.mjs에 있습니다.
// 경로: GET·POST /api/notes, GET·PUT·DELETE /api/notes/:id (vercel.json이 /:id를 ?id=로 넘깁니다).
// SUPABASE_URL과 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고, 키 값은 응답·로그·브라우저에 넣지 않습니다.
import handler from '../src/notes-handler.mjs';

// 로그인 전에 화면이 받는 공개 설정(/api/config → ?config=1)입니다. 메모 자료는 싣지 않고, 값은 Vercel 환경변수에서만 읽습니다.
function publicConfig(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey || !publishableKey.startsWith('sb_publishable_')) {
    return response.status(503).json({ error: 'CONFIG_NOT_CONFIGURED' });
  }
  return response.status(200).json({ supabaseUrl, publishableKey });
}

export default function route(request, response) {
  const query = new URL(request.url ?? '/', 'http://localhost').searchParams;
  if (query.get('config') === '1' && !query.has('id')) return publicConfig(request, response);
  return handler(request, response);
}
