// 가상 메모 API입니다. 실제 처리는 src/notes-handler.mjs에 있습니다.
// 경로: GET·POST /api/notes, GET·PUT·DELETE /api/notes/:id (vercel.json이 /:id를 ?id=로 넘깁니다).
// SUPABASE_URL과 SUPABASE_SECRET_KEY는 Vercel 환경변수에서만 읽고, 키 값은 응답·로그·브라우저에 넣지 않습니다.
import handler from '../src/notes-handler.mjs';

export default handler;
