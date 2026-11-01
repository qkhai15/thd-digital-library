import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { db, ensureSchema } from "@/lib/db";
import { sha256 } from "@/lib/backend-utils";

export const ADMIN_COOKIE_NAME = "thd_admin_session";
const SESSION_HOURS = 8;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && Buffer.byteLength(secret, "utf8") < 32) throw new Error("Invalid SESSION_SECRET configuration.");
  if (!secret && process.env.NODE_ENV === "production") throw new Error("Missing SESSION_SECRET configuration.");
  return secret;
}

export function encodeAdminSessionToken(rawToken: string) {
  const secret = sessionSecret();
  if (!secret) return rawToken; // Existing unsigned local sessions stay compatible.
  const signature = createHmac("sha256", secret).update(`thd-admin-session-v1:${rawToken}`).digest("base64url");
  return `v1.${rawToken}.${signature}`;
}

export function decodeAdminSessionToken(cookie: string) {
  const secret = sessionSecret();
  if (!secret) return /^[a-f0-9]{64}$/.test(cookie) ? cookie : null;
  const match = /^v1\.([a-f0-9]{64})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  if (!match) return null;
  const expected = createHmac("sha256", secret).update(`thd-admin-session-v1:${match[1]}`).digest();
  const supplied = Buffer.from(match[2], "base64url");
  return supplied.length === expected.length && supplied.toString("base64url") === match[2] && timingSafeEqual(expected, supplied) ? match[1] : null;
}

export async function createAdminSession(input: {
  username: string;
  ip?: string;
  userAgent?: string;
}) {
  await ensureSchema();

  const token = randomBytes(32).toString("hex");
  const cookie = encodeAdminSessionToken(token);
  const tokenHash = sha256(token);

  await db.query(
    `INSERT INTO admin_sessions(token_hash, username, ip_address, user_agent, expires_at)
     VALUES($1,$2,$3,$4,NOW() + ($5 || ' hours')::interval)`,
    [tokenHash, input.username, input.ip ?? null, input.userAgent ?? null, String(SESSION_HOURS)]
  );

  return cookie;
}

export function setAdminCookie(response: NextResponse, token: string, requestUrl: string) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * SESSION_HOURS,
  });
}

export function clearAdminCookie(response: NextResponse, requestUrl: string) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(requestUrl).protocol === "https:",
    path: "/",
    maxAge: 0,
  });
}

export async function getAdminSession() {
  const store = await cookies();
  const cookie = store.get(ADMIN_COOKIE_NAME)?.value;
  if (!cookie) return null;
  const token = decodeAdminSessionToken(cookie);
  if (!token) return null;
  await ensureSchema();

  const result = await db.query(
    `SELECT username, expires_at, token_hash
     FROM admin_sessions
     WHERE token_hash=$1 AND expires_at > NOW()
       AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
     LIMIT 1`,
    [sha256(token), process.env.ADMIN_SESSION_NOT_BEFORE || null]
  );

  return result.rows[0] ?? null;
}

export async function isAdmin() {
  return Boolean(await getAdminSession());
}

export async function deleteAdminSessionToken(cookie: string | undefined) {
  if (!cookie) return;
  const token = decodeAdminSessionToken(cookie);
  if (!token) return;
  await ensureSchema();
  await db.query(`DELETE FROM admin_sessions WHERE token_hash=$1`, [sha256(token)]);
}

export async function auditLog(action: string, entityType = "", entityId = "", details: unknown = {}) {
  try {
  await ensureSchema();
  const session = await getAdminSession();
  await db.query(
    `INSERT INTO audit_logs(username, action, entity_type, entity_id, details)
     VALUES($1,$2,$3,$4,$5::jsonb)`,
    [session?.username ?? "admin", action, entityType, entityId, JSON.stringify(details ?? {})]
  );
  } catch (error) {
    // A completed mutation must not appear to fail and invite a duplicate retry.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN";
    console.error("AUDIT LOG FAILED", { action, entityType, entityId, code: /^[A-Z0-9_]{1,20}$/.test(code) ? code : "UNKNOWN" });
  }
}
