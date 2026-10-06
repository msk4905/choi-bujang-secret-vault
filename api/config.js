// 로그인 화면용 공개 설정만 돌려줍니다(Project URL, publishable key). 화면 코드에는 이 값을 적지 않습니다.
// 값은 Vercel 환경변수 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY에서만 읽습니다. 서버 전용 키는 싣지 않습니다.
export default function handler(request, response) {
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
