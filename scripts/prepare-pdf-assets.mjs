import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const source = path.join(process.cwd(), "node_modules", "pdfjs-dist");
const { version } = JSON.parse(await readFile(path.join(source, "package.json"), "utf8"));
const destination = path.join(process.cwd(), "public", "pdfjs", version);
await mkdir(destination, { recursive: true });
await cp(path.join(source, "build", "pdf.worker.min.mjs"), path.join(destination, "pdf.worker.min.mjs"));
await cp(path.join(source, "legacy", "build", "pdf.worker.min.mjs"), path.join(destination, "pdf.worker.legacy.min.mjs"));
await Promise.all(["cmaps", "standard_fonts", "wasm", "iccs"].map(folder => cp(path.join(source, folder), path.join(destination, folder), { recursive: true })));
