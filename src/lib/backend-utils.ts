import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { readLimitedText, RequestBodyTooLargeError } from "@/lib/request-body";

export const VISITOR_COOKIE = "thd_visitor_id";

export function parsePositiveInt(value: string | number | null | undefined) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function boundedInt(value: unknown, fallback: number, max = 100) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function cleanText(value: unknown, max = 2000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

export const JSON_BODY_MAX_BYTES = 1024 * 1024;

// Content fields are bounded below this cap, including Vietnamese UTF-8 and
// 100 gallery URLs. Count stream bytes before parsing, rather than trusting
// Content-Length, and make callers return the rejection before any mutation.
export async function jsonBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body: unknown = JSON.parse(await readLimitedText(request, JSON_BODY_MAX_BYTES));
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string,unknown> : {};
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ message: "Dữ liệu yêu cầu vượt giới hạn 1 MiB." }, {
        status: 413, headers: { "Cache-Control": "no-store" },
      });
    }
    return {};
  }
}

export function clientIp(request: Request) {
  const headers = request.headers;
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  ).slice(0, 120);
}

export function sha256(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

export function visitorIdFromRequest(request: NextRequest) {
  const value = request.cookies.get(VISITOR_COOKIE)?.value;
  return value && /^[a-zA-Z0-9_-]{16,120}$/.test(value) ? value : null;
}

const requestVisitors = new WeakMap<NextRequest, string>();

export function ensureVisitorId(request: NextRequest, response: NextResponse) {
  const existing = visitorIdFromRequest(request);
  const id = existing || requestVisitors.get(request) || randomUUID();
  requestVisitors.set(request, id);
  if (!existing) {
    response.cookies.set({
      name: VISITOR_COOKIE,
      value: id,
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(requestOrigin(request)).protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return id;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

export function logBackendError(context: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  console.error(context, { code: typeof code === "string" && /^[A-Z0-9_]{1,20}$/.test(code) ? code : "UNKNOWN" });
}

function configuredPublicOrigins() {
  const values = [process.env.APP_ORIGIN, ...(process.env.PUBLIC_ORIGINS || "").split(",")];
  return values.filter((value): value is string => Boolean(value?.trim())).map((value) => {
    const origin = new URL(value.trim());
    if (origin.protocol !== "https:" || origin.origin !== value.trim() || origin.hostname.includes("*")) {
      throw new Error("Invalid configured public origin");
    }
    return origin;
  });
}

// The proxy's internal URL can be HTTP/localhost even for public HTTPS requests.
// Forwarded headers are trusted only for explicitly configured exact origins.
export function requestOrigin(request: Request) {
  const internal = new URL(request.url);
  const host = request.headers.get("host") || internal.host;
  const direct = new URL(`${internal.protocol}//${host}`);
  if (!["http:", "https:"].includes(direct.protocol) || direct.username || direct.password ||
    direct.pathname !== "/" || direct.search || direct.hash || /[\\\s]/.test(host)) {
    throw new Error("Invalid request host");
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  for (const publicUrl of configuredPublicOrigins()) {
    if (direct.host === publicUrl.host ||
      (forwardedHost === publicUrl.host && `${forwardedProtocol}:` === publicUrl.protocol)) {
      return publicUrl.origin;
    }
  }
  if (process.env.PRODUCTION_REMOTE_ONLY === "true") throw new Error("Unconfigured public host");
  return direct.origin;
}

export function sameOriginAllowed(request: Request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  try {
    const destination = requestOrigin(request);
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site") return false;
    // Same-site non-browser clients can omit Origin; destination validation still
    // runs first, so an arbitrary Host/forwarded Host cannot mint admin sessions.
    if (!origin) return true;
    const originUrl = new URL(origin);
    return ["http:", "https:"].includes(originUrl.protocol) &&
      origin === originUrl.origin && originUrl.origin === destination;
  } catch {
    return false;
  }
}

export function safeContentUrl(value: unknown) {
  const url = cleanText(value, 2000);
  if (!url) return "";
  if (url.startsWith("/") && !url.startsWith("//") && !/[\\\s]/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : "";
  } catch {
    return "";
  }
}
