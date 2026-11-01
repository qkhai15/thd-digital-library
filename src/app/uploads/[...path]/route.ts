import { storagePublicUrl, validStorageKey } from "@/lib/upload-storage";
import path from "path";
import { realpath, stat } from "fs/promises";
import { createReadStream } from "fs";
import { Readable } from "stream";
import { mediaRange } from "@/lib/media-range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params:Promise<{path:string[]}>};
const mime: Record<string,string> = {
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp",
  ".pdf":"application/pdf", ".mp3":"audio/mpeg", ".wav":"audio/wav", ".ogg":"audio/ogg",
  ".m4a":"audio/mp4", ".mp4":"video/mp4", ".webm":"video/webm",
};

async function serve(request: Request, context: Context, head = false) {
  const segments = (await context.params).path;
  if (!segments.length || segments.some(segment=>!segment || segment === "." || segment === ".." || /[\\/\u0000]/.test(segment))) return new Response(null,{status:404});
  const key = segments.join("/");
  const query = new URL(request.url).searchParams;
  const download = query.has("download");
  const inlinePdf = query.get("inline") === "1" && path.extname(key).toLowerCase() === ".pdf" && !download;
  const filename = (segments.at(-1) || "document.pdf").replace(/[^a-zA-Z0-9_.-]/g,"_");
  const remote = async () => {
    try {
      const source = new URL(storagePublicUrl(segments[0] === "supabase" ? segments.slice(1).join("/") : key));
      if (download) source.searchParams.set("download",filename);
      if (!inlinePdf) return new Response(null, { status: 307, headers: { Location: source.href, "Cache-Control": "no-store" } });
      // Only validated keys in this project's public bucket, never arbitrary URLs.
      // Stream bytes and propagate cancellation; do not buffer the PDF in Railway.
      const range = request.headers.get("range");
      if (range && !/^bytes=\d*-\d*$/.test(range)) return new Response(null,{status:416});
      const upstream = await fetch(source, { method: head ? "HEAD" : "GET", headers: range ? { Range: range, "Accept-Encoding":"identity" } : { "Accept-Encoding":"identity" }, signal: request.signal, redirect: "error" });
      const headers = new Headers({"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${filename}"`,"Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff","Cache-Control":"public, max-age=3600","Vary":"Range"});
      for (const name of ["content-length","content-range","etag","last-modified"]) {
        const value = upstream.headers.get(name); if (value) headers.set(name,value);
      }
      if (![200,206].includes(upstream.status)) {
        await upstream.body?.cancel();
        headers.set("Cache-Control","no-store"); headers.delete("Content-Length");
        return new Response(null,{status:[404,416].includes(upstream.status)?upstream.status:502,headers});
      }
      if (!upstream.headers.get("content-type")?.toLowerCase().startsWith("application/pdf")) { await upstream.body?.cancel(); return new Response(null,{status:415}); }
      return new Response(head ? null : upstream.body,{status:upstream.status,headers});
    } catch { return new Response(null, { status: 503 }); }
  };
  if (segments[0] === "supabase" || process.env.PRODUCTION_REMOTE_ONLY === "true") {
    if (!validStorageKey(segments[0] === "supabase" ? segments.slice(1).join("/") : key)) return new Response(null, { status: 404 });
    return remote();
  }
  try {
    const root = await realpath(path.join(process.cwd(),"public","uploads"));
    const target = await realpath(path.join(root,...segments));
    const relative = path.relative(root,target);
    if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return new Response(null,{status:404});
    const file = await stat(target);
    if (!file.isFile()) return new Response(null,{status:404});
    const etag = `"${file.size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}"`;
    const type = mime[path.extname(target).toLowerCase()];
    const headers = new Headers({
      "Content-Type":type || "application/octet-stream", "Accept-Ranges":"bytes",
      "ETag":etag, "Last-Modified":file.mtime.toUTCString(),
      "Cache-Control":"public, max-age=31536000, immutable", "X-Content-Type-Options":"nosniff",
    });
    if (!type) headers.set("Content-Disposition","attachment");
    if (download || inlinePdf) headers.set("Content-Disposition",`${download?"attachment":"inline"}; filename="${filename}"`);
    if (request.headers.get("if-none-match") === etag) return new Response(null,{status:304,headers});
    const rangeHeader = request.headers.get("range");
    const ifRange = request.headers.get("if-range");
    const useRange = rangeHeader && (!ifRange || ifRange === etag || ifRange === file.mtime.toUTCString());
    let range;
    if (useRange) {
      range = mediaRange(rangeHeader,file.size);
      if (!range) { headers.set("Content-Range",`bytes */${file.size}`); return new Response(null,{status:416,headers}); }
      headers.set("Content-Range",`bytes ${range.start}-${range.end}/${file.size}`);
    }
    headers.set("Content-Length",String(range ? range.end-range.start+1 : file.size));
    const status = range ? 206 : 200;
    if (head) return new Response(null,{status,headers});
    const stream = createReadStream(target,range || undefined);
    return new Response(Readable.toWeb(stream) as ReadableStream,{status,headers});
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "") && process.env.STORAGE_LEGACY_REMOTE === "true" && validStorageKey(key)) return remote();
    if (!["ENOENT","ENOTDIR"].includes((error as NodeJS.ErrnoException).code || "")) console.error("SERVE UPLOAD",error);
    return new Response(null,{status:404});
  }
}

export async function GET(request:Request,context:Context) { return serve(request,context); }
export async function HEAD(request:Request,context:Context) { return serve(request,context,true); }
