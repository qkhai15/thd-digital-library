import { boundedInt } from "@/lib/backend-utils";
import { NextRequest, NextResponse } from "next/server";
import { getNewsPosts } from "@/lib/library-repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limit = boundedInt(request.nextUrl.searchParams.get("limit"),50,100);

  return NextResponse.json(await getNewsPosts(limit));
}
