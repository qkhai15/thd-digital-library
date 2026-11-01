import { retainedMedia } from "@/lib/upload-references";
import { jsonBody } from "@/lib/backend-utils";
import { NextResponse } from "next/server";
import { auditLog, isAdmin } from "@/lib/admin-auth";
import { cleanText, safeContentUrl, parsePositiveInt, sameOriginAllowed, logBackendError } from "@/lib/backend-utils";
import { db, ensureSchema } from "@/lib/db";

type Context = {
  params: Promise<{ id: string }>;
};

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

async function uniqueSlug(base: string, excludeId: number) {
  let candidate = base || `tin-tuc-${Date.now()}`;
  let suffix = 1;

  while (true) {
    const exists = await db.query(
      `SELECT 1 FROM news_posts WHERE slug=$1 AND id<>$2`,
      [candidate, excludeId]
    );

    if (!exists.rowCount) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`.slice(0, 500);
  }
}

export async function PUT(request: Request, context: Context) {
  await ensureSchema();

  if (!(await isAdmin())) {
    return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  }

  if (!sameOriginAllowed(request)) {
    return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  }

  const { id } = await context.params;
  const itemId = parsePositiveInt(id);

  if (!itemId) {
    return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });
  }

  const current = await db.query(`SELECT * FROM news_posts WHERE id=$1 LIMIT 1`, [itemId]);
  if (!current.rows[0]) {
    return NextResponse.json({ message: "Không tìm thấy tin." }, { status: 404 });
  }

  const body = await jsonBody(request);
  if (body instanceof NextResponse) return body;
  const title = cleanText(body.title, 500);
  const excerpt = cleanText(body.excerpt, 2000);
  const content = cleanText(body.content, 50_000);
  const coverUrl = safeContentUrl(body.cover_url) || null;
  if (cleanText(body.cover_url,2000) && !coverUrl) return NextResponse.json({message:"URL ảnh không hợp lệ."},{status:400});
  const status = ["draft", "published", "archived"].includes(String(body.status))
    ? String(body.status)
    : "published";

  if (!title) {
    return NextResponse.json({ message: "Bạn chưa nhập tiêu đề." }, { status: 400 });
  }

  if (!content) {
    return NextResponse.json({ message: "Bạn chưa nhập nội dung bài viết." }, { status: 400 });
  }

  const requestedSlug = cleanText(body.slug, 520) || current.rows[0].slug || title;
  const slug = await uniqueSlug(slugify(requestedSlug), itemId);

  let result;
  try {
  result = await db.query(
    `UPDATE news_posts
     SET title=$1,
         slug=$2,
         excerpt=$3,
         content=$4,
         cover_url=$5,
         status=$6,
         is_featured=$7,
         published_at=CASE
           WHEN $6::varchar='published' THEN COALESCE(published_at,NOW())
           ELSE published_at
         END,
         updated_at=NOW()
     WHERE id=$8
     RETURNING *`,
    [title, slug, excerpt, content, coverUrl, status, Boolean(body.is_featured), itemId]
  );

  } catch (error) {
    if ((error as {code?:string}).code === "23505") return NextResponse.json({message:"Đường dẫn tin vừa được sử dụng. Vui lòng lưu lại."},{status:409});
    logBackendError("SAVE NEWS",error);
    return NextResponse.json({message:"Không thể lưu tin tức."},{status:500});
  }

  await auditLog("update", "news", String(itemId), { title, slug, ...retainedMedia(current.rows[0], result.rows[0]) });

  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: Request, context: Context) {
  await ensureSchema();

  if (!(await isAdmin())) {
    return NextResponse.json({ message: "Chưa đăng nhập." }, { status: 401 });
  }

  if (!sameOriginAllowed(request)) {
    return NextResponse.json({ message: "Yêu cầu không hợp lệ." }, { status: 403 });
  }

  const { id } = await context.params;
  const itemId = parsePositiveInt(id);

  if (!itemId) {
    return NextResponse.json({ message: "ID không hợp lệ." }, { status: 400 });
  }

  const result = await db.query(`DELETE FROM news_posts WHERE id=$1 RETURNING title,slug,cover_url`, [itemId]);

  if (!result.rows[0]) {
    return NextResponse.json({ message: "Không tìm thấy tin." }, { status: 404 });
  }

  await auditLog("delete", "news", String(itemId), { ...result.rows[0], ...retainedMedia(result.rows[0]) });

  return NextResponse.json({ ok: true });
}
