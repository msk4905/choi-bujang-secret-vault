const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPO = /^[A-Za-z0-9._-]{1,100}$/u;
const SHA = /^[a-f0-9]{40}$/iu;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/iu;

export function deploymentIdentity(env, config) {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const repo = env.VERCEL_GIT_REPO_SLUG;
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  const host = env.VERCEL_URL;
  if (env.VERCEL_GIT_PROVIDER !== 'github' || !OWNER.test(owner || '')
      || !REPO.test(repo || '') || repo === '.' || repo === '..'
      || repo.toLowerCase().endsWith('.git') || !SHA.test(commit || '')
      || !HOST.test(host || '') || ![1, 2, 3, 4, 5].includes(config?.step)
      || typeof config.judgeIssuer !== 'string'
      || !/^https:\/\/[a-z0-9-]+\.up\.railway\.app\/defense\/judge$/iu.test(config.judgeIssuer)
      || (config.step === 1 && (typeof config.sampleMarker !== 'string'
        || !/^[A-Z0-9_]{1,80}$/u.test(config.sampleMarker)))) {
    throw new Error('배포 식별 정보를 확인할 수 없습니다. Vercel 시스템 환경변수와 1~5단계 설정을 확인하세요.');
  }
  const identity = {
    schema: 'aleph.defense.deployment.v1',
    step: config.step,
    repoUrl: `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`,
    commit: commit.toLowerCase(),
    publicAppUrl: `https://${host.toLowerCase()}`,
    judgeIssuer: config.judgeIssuer,
  };
  // 시작 틀 확인 표시는 1단계 공개 자료에만 둔다. 2단계 이후 정적 응답에 내보내지 않는다.
  if (config.step === 1) identity.sampleMarker = config.sampleMarker;
  // 3단계부터는 허용 경로를 공개 확인 파일에도 싣는다(경로 문자열뿐, 비밀값 없음).
  if (config.step >= 3 && Array.isArray(config.allowedRoutes) && config.allowedRoutes.length
      && config.allowedRoutes.every(route => typeof route === 'string')) {
    identity.allowedRoutes = [...config.allowedRoutes];
  }
  // 5단계부터는 원본 자료 주소(쿼리·계정 정보 없는 HTTPS 경로, 비밀값 없음)도 공개 확인 파일에 싣는다.
  if (config.step >= 5 && typeof config.originalApiUrl === 'string') {
    let original;
    try { original = new URL(config.originalApiUrl); } catch { original = null; }
    if (original && original.protocol === 'https:' && !original.username && !original.password
        && !original.search && !original.hash) identity.originalApiUrl = original.href;
  }
  // 5단계부터는 쿼리 없는 원본 자료 HTTPS 경로를 공개 확인 파일에도 싣는다(주소뿐, 비밀값 없음).
  if (config.step >= 5 && typeof config.originalApiUrl === 'string') {
    let original;
    try {
      original = new URL(config.originalApiUrl);
    } catch {
      original = null;
    }
    if (original && original.protocol === 'https:' && !original.username && !original.password
        && !original.search && !original.hash) {
      identity.originalApiUrl = config.originalApiUrl;
    }
  }
  return identity;
}
