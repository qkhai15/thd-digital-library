import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { clientIp, requestOrigin, sameOriginAllowed } from "@/lib/backend-utils";
import { createAdminSession, setAdminCookie } from "@/lib/admin-auth";
import { readLimitedFormData, readLimitedText, RequestBodyTooLargeError } from "@/lib/request-body";

function loginError(message: string, status: number) {
  return NextResponse.json({ message }, { status, headers: { "Cache-Control": "no-store" } });
}

function credentialMatches(supplied: string, configured: string | undefined) {
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const configuredDigest = createHash("sha256").update(configured || "").digest();
  return timingSafeEqual(suppliedDigest, configuredDigest) && Boolean(configured);
}

async function checkLogin(username: string, password: string, ip: string) {
  await ensureSchema();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize the count+insert across instances; a concurrent burst must not
    // bypass the shared database limiter. The lock contains no credential data.
    await client.query("SELECT pg_advisory_xact_lock(174812093, hashtext($1))", [process.env.ADMIN_USERNAME || ""]);
    const failures = await client.query(
      `SELECT COUNT(*)::int AS count FROM admin_login_attempts
       WHERE (ip_address=$1 OR username=$2) AND success=FALSE
         AND created_at > NOW() - INTERVAL '15 minutes'`,
      [ip, process.env.ADMIN_USERNAME || ""]
    );
    if (failures.rows[0].count >= 10) {
      await client.query("COMMIT");
      return "limited";
    }
    const usernameMatches = credentialMatches(username, process.env.ADMIN_USERNAME);
    const passwordMatches = credentialMatches(password, process.env.ADMIN_PASSWORD);
    const accepted = usernameMatches && passwordMatches;
    await client.query(
      `INSERT INTO admin_login_attempts(ip_address, username, success) VALUES($1,$2,$3)`,
      [ip, username, accepted]
    );
    await client.query("COMMIT");
    return accepted;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function POST(request: NextRequest) {
  if (!sameOriginAllowed(request)) return loginError("Yêu cầu không hợp lệ.", 403);
  try {
  const origin = requestOrigin(request);

  const contentType = request.headers.get("content-type") || "";
  let username = "";
  let password = "";

  if (contentType.includes("application/json")) {
    let body: unknown;
    try { body = JSON.parse(await readLimitedText(request, 16 * 1024)); }
    catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw error;
      return loginError("Dữ liệu đăng nhập không hợp lệ.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      !("username" in body) || typeof body.username !== "string" ||
      !("password" in body) || typeof body.password !== "string") {
      return loginError("Dữ liệu đăng nhập không hợp lệ.", 400);
    }
    username = body.username.trim();
    password = body.password;
  } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await readLimitedFormData(request, 16 * 1024); }
    catch (error) {
      if (error instanceof RequestBodyTooLargeError) throw error;
      return loginError("Dữ liệu đăng nhập không hợp lệ.", 400);
    }
    if (typeof form.get("username") !== "string" || typeof form.get("password") !== "string") return loginError("Dữ liệu đăng nhập không hợp lệ.", 400);
    username = String(form.get("username") ?? "").trim();
    password = String(form.get("password") ?? "");
  } else {
    return loginError("Định dạng đăng nhập không được hỗ trợ.", 415);
  }
  if (!username || !password || username.length > 120 || password.length > 1024) return loginError("Dữ liệu đăng nhập không hợp lệ.", 400);

  const ip = clientIp(request);

  const ok = await checkLogin(username, password, ip);
  if (ok === "limited") {
    return NextResponse.json(
      { message: "Đăng nhập bị tạm khóa 15 phút do thử sai quá nhiều lần." },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "900" } }
    );
  }

  const wantsJson = contentType.includes("application/json");

  if (!ok) {
    if (wantsJson) {
      return loginError("Sai tài khoản hoặc mật khẩu.", 401);
    }
    const response = NextResponse.redirect(new URL("/admin/login?error=1", origin), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const token = await createAdminSession({
    username,
    ip,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  if (wantsJson) {
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    setAdminCookie(response, token, origin);
    return response;
  }

  const response = NextResponse.redirect(new URL("/admin", origin), 303);
  response.headers.set("Cache-Control", "no-store");
  setAdminCookie(response, token, origin);
  return response;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return loginError("Dữ liệu đăng nhập quá lớn.", 413);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    console.error("ADMIN_LOGIN_FAILED", { code: /^[A-Z0-9_]{1,20}$/.test(code) ? code : "UNKNOWN" });
    return loginError("Không thể đăng nhập lúc này. Vui lòng thử lại.", 503);
  }
}
