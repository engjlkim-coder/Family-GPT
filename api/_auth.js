import crypto from "node:crypto";

/*
 * 가족 GPT 로그인 공용 모듈 (api 폴더에 두세요)
 *
 * 필요한 환경변수 (Vercel > Settings > Environment Variables)
 *   FAMILY_PASSWORD : 가족이 입력할 비밀번호
 *   AUTH_SECRET     : 토큰 서명용 긴 무작위 문자열 (32자 이상)
 *
 * 비밀번호를 바꾸거나 AUTH_SECRET을 바꾸면 기존 로그인은 모두 무효가 됩니다.
 */

const TOKEN_DAYS = 30;          // 로그인 유지 기간
const MAX_FAILS = 5;            // 허용 실패 횟수
const WINDOW_MS = 10 * 60 * 1000; // 실패 집계/잠금 시간 (10분)

const fails = new Map(); // ip -> { count, first }  (서버 인스턴스별 임시 기록)

export function secretsReady() {
  return !!(process.env.FAMILY_PASSWORD && process.env.AUTH_SECRET);
}

function sha(s) {
  return crypto.createHash("sha256").update(String(s)).digest();
}

/* 비밀번호 비교 (길이/타이밍 노출 방지) */
export function checkPassword(input) {
  return crypto.timingSafeEqual(
    sha(input),
    sha(process.env.FAMILY_PASSWORD || "")
  );
}

function sign(exp) {
  const key = sha(process.env.AUTH_SECRET + ":" + process.env.FAMILY_PASSWORD);
  return crypto.createHmac("sha256", key).update(String(exp)).digest("hex");
}

export function issueToken() {
  const exp = Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000;
  return { token: `${exp}.${sign(exp)}`, expiresAt: exp };
}

export function verifyToken(token) {

  if (!secretsReady() || typeof token !== "string") return false;

  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);

  if (!exp || exp < Date.now()) return false;
  if (!/^[0-9a-f]{64}$/.test(sig || "")) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig, "hex"),
      Buffer.from(sign(exp), "hex")
    );
  } catch {
    return false;
  }
}

/* 각 API 맨 앞에서 호출: if (!requireAuth(req, res)) return; */
export function requireAuth(req, res) {

  if (!secretsReady()) {
    res.status(500).json({
      error: "FAMILY_PASSWORD / AUTH_SECRET 환경변수가 없습니다."
    });
    return false;
  }

  const h = String(req.headers?.authorization || "");
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";

  if (!verifyToken(token)) {
    res.status(401).json({
      error: "로그인이 필요합니다.",
      code: "AUTH_REQUIRED"
    });
    return false;
  }

  return true;
}

/* ---------- 로그인 시도 제한 (best-effort) ---------- */

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  return (
    (typeof xf === "string" ? xf.split(",")[0].trim() : "") ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function prune() {
  const now = Date.now();
  for (const [k, v] of fails) {
    if (now - v.first > WINDOW_MS) fails.delete(k);
  }
}

export function isLocked(req) {
  prune();
  const v = fails.get(clientIp(req));
  return !!v && v.count >= MAX_FAILS;
}

export function recordFail(req) {
  prune();
  const ip = clientIp(req);
  const v = fails.get(ip);
  if (v) v.count += 1;
  else fails.set(ip, { count: 1, first: Date.now() });
}

export function clearFails(req) {
  fails.delete(clientIp(req));
}
