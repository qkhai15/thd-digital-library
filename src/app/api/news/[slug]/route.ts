import { NextResponse } from "next/server";
import { getNewsBySlug } from "@/lib/library-repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const item = await getNewsBySlug(slug);

  if (!item) {
    return NextResponse.json({ message: "Không tìm thấy tin tức." }, { status: 404 });
  }

  return NextResponse.json(item);
}
