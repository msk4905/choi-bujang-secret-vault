// 학습용 가상 메모를 서버 쪽에서만 Supabase에서 읽는 함수입니다.
// 주의: 3단계 로그인 전까지 이 주소는 누구나 부를 수 있습니다. 가상 메모만 두세요.
// SUPABASE_URL과 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽습니다.
// 키 값은 응답·로그·브라우저 파일에 절대 넣지 않습니다.
import { createClient } from '@supabase/supabase-js';

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
