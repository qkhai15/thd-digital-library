import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { cleanText, safeContentUrl, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 450);
}

async function uniqueSlug(base: string, excludeId?: number) {
  let candidate = base || `tin-tuc-${Date.now()}`;
  let suffix = 1;

  while (true) {
    const values: unknown[] = [candidate];
    let sql = `SELECT 1 FROM news_posts WHERE slug=$1`;

    if (excludeId) {
      values.push(excludeId);
      sql += ` AND id<>$2`;
    }

    const exists = await db.query(sql, values);
    if (!exists.rowCount) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, 500);
  }
}

export async function GET() {
  await ensureSchema();

  if (!(await isAdmin())) {
    return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  }

  const result = await db.query(`
    SELECT *
    FROM news_posts
    ORDER BY COALESCE(published_at, created_at) DESC, id DESC
  `);

  return NextResponse.json(result.rows);
}

export async function POST(request: Request) {
  await ensureSchema();

  if (!(await isAdmin())) {
    return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  }

  if (!sameOriginAllowed(request)) {
    return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  }

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;

  const title = cleanText(body.title, 500);
  const excerpt = cleanText(body.excerpt, 2000);
  const content = cleanText(body.content, 50_000);
  const coverUrl = safeContentUrl(body.cover_url) || null;
  if (cleanText(body.cover_url,2000) && !coverUrl) return NextResponse.json({message:"URL ảnh không hợp lệ."},{status:400});
  const requestedSlug = cleanText(body.slug, 520);
  const status = ["draft", "published", "archived"].includes(String(body.status))
    ? String(body.status)
    : "published";

  if (!title) {
    return NextResponse.json({ message: "Bạn chưa nhập tiêu đề." }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ message: "Bạn chưa nhập nội dung bài viết." }, { status: 400 });
  }

  const slug = await uniqueSlug(slugify(requestedSlug || title));

  let result;
  try {
  result = await db.query(
    `INSERT INTO news_posts
     (title,slug,excerpt,content,cover_url,status,is_featured,published_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6::varchar='published' THEN NOW() ELSE NULL END)
     RETURNING *`,
    [title, slug, excerpt, content, coverUrl, status, Boolean(body.is_featured)]
  );

  } catch (error) {
    if ((error as {code?:string}).code === "23505") return NextResponse.json({message:"Đường dẫn tin vừa được sử dụng. Vui lòng lưu lại."},{status:409});
    logBackendError("SAVE NEWS",error);
    return NextResponse.json({message:"Không thể lưu tin tức."},{status:500});
  }

  await auditLog("create", "news", String(result.rows[0].id), { title, slug });

  return NextResponse.json(result.rows[0], { status: 201 });
}
