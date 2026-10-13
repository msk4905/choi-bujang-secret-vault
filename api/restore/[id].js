// 메모 한 건 복구 경로: POST /api/restore/:id (Vercel이 파일 이름의 [id]를 request.query.id로 채워 줍니다).
// 실제 처리는 src/notes-handler.mjs의 복구 분기(src/notes-restore.mjs)에 있습니다. 이 파일은 그 분기를 부르기만 합니다.
// 복구 분기는 이 파일이 만든 요청 객체의 restoreRoute 표시로만 열립니다. 쿼리 값으로는 열 수 없어, 선언한 경로 하나만 입구가 됩니다.
import handler from '../../src/notes-handler.mjs';

export default function route(request, response) {
  return handler({
    method: request.method,
    query: { id: request.query?.id },
    headers: request.headers,
    body: request.body,
    restoreRoute: true,
  }, response);
}
