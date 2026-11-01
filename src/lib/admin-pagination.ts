import { NextResponse } from "next/server";
import { db } from "./db";
import { boundedInt } from "./backend-utils";

export async function adminList(request: Request, from: string, select: string, order: string, defaultSize: number, maxSize = 500) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") || "";
  const values: unknown[] = [];
  let where = "";
  if (status && select !== "audit") { values.push(status); where = `WHERE ${select}.status=$1`; }
  const source = `${from} ${where}`;
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM ${source}`,values);
  const size = boundedInt(url.searchParams.get("limit"),defaultSize,maxSize);
  const total = Number(count.rows[0].total);
  const totalPages = Math.max(1,Math.ceil(total/size));
  const page = Math.min(boundedInt(url.searchParams.get("page"),1,1000000),totalPages);
  const fields = select === "audit" ? "*" : `${select}.*,i.title AS item_title${select === "b" ? ",i.stock" : ""}`;
  const result = await db.query(`SELECT ${fields} FROM ${source} ORDER BY ${order} LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,size,(page-1)*size]);
  return NextResponse.json(result.rows,{headers:{"X-Total-Count":String(total),"X-Total-Pages":String(totalPages),"X-Page":String(page)}});
}
