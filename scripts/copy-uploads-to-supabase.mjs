import { createClient } from "@supabase/supabase-js";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// No dotenv: production credentials must be supplied by the invoking environment.
const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("Only --apply is supported.");
const root = path.resolve("public/uploads");
const types = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp", ".pdf":"application/pdf", ".mp3":"audio/mpeg", ".wav":"audio/wav", ".ogg":"audio/ogg", ".m4a":"audio/mp4", ".mp4":"video/mp4", ".webm":"video/webm" };
let storage;
let bucket;
if (apply) {
  const { SUPABASE_URL:url, SUPABASE_STORAGE_BUCKET:name } = process.env;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret || !name) throw new Error("Missing Supabase server environment.");
  if (new URL(url).protocol !== "https:" || !/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error("Invalid Storage configuration.");
  bucket = name;
  storage = createClient(url, secret, { auth: { persistSession:false, autoRefreshToken:false } }).storage.from(bucket);
}
async function hash(stream) {
  const result = createHash("sha256");
  let size = 0;
  for await (const bytes of stream) { result.update(bytes); size += bytes.length; }
  return { sha256:result.digest("hex"), size };
}
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const key = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not supported.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name) || entry.name === "supabase" && !prefix) throw new Error("Unsupported legacy object path.");
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { await walk(target, `${key}/`); continue; }
    if (!entry.isFile()) throw new Error("Unsupported filesystem entry.");
    const contentType = types[path.extname(entry.name).toLowerCase()];
    if (!contentType) throw new Error("Unsupported legacy file type.");
    const manifest = { key, contentType, ...await hash(createReadStream(target)) };
    if (storage) {
      const existing = await storage.download(key);
      if (existing.error) {
        // Only explicit missing-object errors permit a new upload.
        const code = String(existing.error.statusCode);
        if (code !== "404" && existing.error.message !== "Object not found") throw new Error(`Cannot inspect object ${key}.`);
        const uploaded = await storage.upload(key, createReadStream(target), { contentType, upsert:false, cacheControl:"31536000", duplex:"half" });
        if (uploaded.error) throw new Error(`Cannot copy object ${key}.`);
      }
      const remote = existing.data || (await storage.download(key)).data;
      if (!remote) throw new Error(`Cannot verify object ${key}.`);
      const verified = await hash(remote.stream());
      if (verified.sha256 !== manifest.sha256 || verified.size !== manifest.size) throw new Error(`Hash mismatch: ${key}. No overwrite performed.`);
    }
    console.log(JSON.stringify({ ...manifest, mode:apply ? "copied-and-verified" : "dry-run" }));
  }
}
await walk(root);
