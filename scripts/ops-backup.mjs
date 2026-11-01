import dotenv from "dotenv";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createS3Client, ensure, fileMetadata, OpsError, parseEncryptionKey, s3Config, safeObjectKey, sha256 } from "./ops-backup/core.mjs";
import { backupDatabase, backupStorage, newRun, verifyBackup } from "./ops-backup/jobs.mjs";

// Local adapter is deliberately only available under explicit local-rehearsal.
// It verifies the entire encryption/receipt/restore pipeline without pretending
// that an independent off-site backup exists or needing external credentials.
export async function localRehearsalTarget(root) {
  const directory = path.resolve(root);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const location = key => {
    safeObjectKey(key);
    const result = path.resolve(directory, ...key.split("/"));
    ensure(result.startsWith(`${directory}${path.sep}`), "BACKUP_LOCAL_TARGET_PATH_INVALID");
    return result;
  };
  return {
    async put(key, source, metadata = {}) {
      const destination = location(key);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      // COPYFILE_EXCL: an immutable local fixture exactly like conditional PUT.
      await copyFile(source, destination, 1);
      await writeFile(`${destination}.metadata.json`, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
    },
    async get(key, destination) { await copyFile(location(key), destination, 1); return fileMetadata(destination); },
    async head(key) {
      try {
        const source = location(key), metadata = JSON.parse(await readFile(`${source}.metadata.json`, "utf8"));
        return { headers: { "content-length": String((await stat(source)).size), ...Object.fromEntries(Object.entries(metadata).map(([name, value]) => [`x-amz-meta-${name}`, value])) } };
      } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
  };
}

export function scheduledActions(date = new Date()) {
  // 19:15 UTC = 02:15 next day Vietnam. Saturday UTC = Sunday Vietnam.
  return date.getUTCDay() === 6 ? ["db", "storage"] : ["db"];
}

export async function main(action = process.argv[2], suppliedEnv = process.env) {
  ensure(["db", "storage", "all", "verify", "restore-dry-run", "scheduled", "local-rehearsal"].includes(action), "BACKUP_COMMAND_REQUIRED_DB_STORAGE_ALL_VERIFY_RESTORE_DRY_RUN_SCHEDULED");
  const env = suppliedEnv.BACKUP_ENV_FILE ? { ...dotenv.parse(await readFile(suppliedEnv.BACKUP_ENV_FILE)), ...suppliedEnv } : { ...suppliedEnv };
  ensure(env.NODE_TLS_REJECT_UNAUTHORIZED !== "0", "BACKUP_TLS_VERIFICATION_REQUIRED");
  const local = action === "local-rehearsal";
  const key = local && !env.BACKUP_ENCRYPTION_KEY ? randomBytes(32) : parseEncryptionKey(env.BACKUP_ENCRYPTION_KEY);
  const keyId = sha256(key).slice(0, 12);
  const outputDirectory = path.resolve(env.BACKUP_OUTPUT_DIR || "deploy/data/ops-backups");
  const privateTempRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(privateTempRoot, "thd-ops-"));
  const results = [];
  try {
    const s3 = local ? await localRehearsalTarget(path.join(outputDirectory, `local-rehearsal-${Date.now()}`)) : createS3Client(s3Config(env));
    const actions = action === "all" ? ["db", "storage"] : action === "scheduled" ? scheduledActions() : [action];
    for (const job of actions) {
      const runDirectory = path.join(directory, `job-${results.length}`);
      await mkdir(runDirectory, { recursive: true, mode: 0o700 });
      const context = { env, key, keyId, directory: runDirectory, outputDirectory, s3, run: newRun(job === "local-rehearsal" ? "db" : job) };
      if (["db", "storage"].includes(job)) results.push(job === "db" ? await backupDatabase(context) : await backupStorage(context));
      else if (job === "local-rehearsal") {
        const backedUp = await backupDatabase(context);
        const verifyDirectory = path.join(directory, "verify");
        await mkdir(verifyDirectory, { mode: 0o700 });
        const verified = await verifyBackup({ ...context, directory: verifyDirectory, env: { ...env, BACKUP_RECEIPT_FILE: backedUp.receiptFile, BACKUP_RESTORE_DOCKER: "true" } }, { restore: true });
        results.push({ ...verified, localRehearsalOnly: true, externalBackup: false, recoveryKeyPersisted: Boolean(env.BACKUP_ENCRYPTION_KEY), note: env.BACKUP_ENCRYPTION_KEY ? "Verification fixture retained under ignored output directory." : "One-time rehearsal key discarded; retained encrypted test fixture is not a recoverable backup." });
      } else results.push(await verifyBackup(context, { restore: action === "restore-dry-run" && env.BACKUP_RESTORE_DOCKER === "true" }));
    }
    return { result: "PASS", action, externalBackup: !local, retentionDeletes: false, results };
  } finally {
    key.fill(0);
    // Never enumerate/delete existing artifacts. Only fresh private invocation
    // scratch (including temporary decrypted PII) is removed, after confinement.
    ensure(path.dirname(directory) === privateTempRoot && /^thd-ops-[\w-]+$/.test(path.basename(directory)), "BACKUP_TEMP_CONFINEMENT_FAILED");
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(), null, 2)); }
  catch (error) {
    // All provider, libpq, TLS, SQL and filesystem messages remain private.
    console.error(JSON.stringify({ result: "FAIL", code: error instanceof OpsError ? error.code : "BACKUP_FAILED_PRIVATE_DETAILS_SUPPRESSED", productionRestore: false, retentionDeletes: false }));
    process.exitCode = 1;
  }
}
