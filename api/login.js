import {
  secretsReady,
  checkPassword,
  issueToken,
  requireAuth,
  isLocked,
  recordFail,
  clearFails
} from "./_auth.js";

/*
 * POST /api/login  { password } -> { token, expiresAt }
 * GET  /api/login  (Authorization 헤더) -> 로그인 상태 확인
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {

  res.setHeader("Cache-Control", "no-store");

  if (!secretsReady()) {
    return res.status(500).json({
      error: "FAMILY_PASSWORD / AUTH_SECRET 환경변수가 없습니다."
    });
  }

  /* 토큰이 아직 유효한지 확인 */
  if (req.method === "GET") {
    if (!requireAuth(req, res)) return;
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  if (isLocked(req)) {
    return res.status(429).json({
      error: "시도가 너무 많습니다. 10분 뒤에 다시 시도해 주세요."
    });
  }

  let password = "";

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    password = String(body.password || "").slice(0, 200);
  } catch {
    return res.status(400).json({ error: "잘못된 요청입니다." });
  }

  if (!password || !checkPassword(password)) {
    recordFail(req);
    await sleep(700); // 무작위 대입 속도 늦추기
    return res.status(401).json({ error: "비밀번호가 올바르지 않습니다." });
  }

  clearFails(req);

  return res.status(200).json(issueToken());
}
