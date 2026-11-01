# Phase 2: local PostgreSQL to Supabase

This records the completed local-to-Supabase migration and the current production
operation procedure. Do not change .env.local, drop/reset the local database, run demo
seeds or replay the original restore over a running hosted application. Website release
is handled separately through RAILWAY.md. The actual Railway public HTTPS service is
now deployed and verified against this hosted database; the unverified school-domain
DNS/certificate and Search Console are tracked there.
Current app authentication is ADMIN_USERNAME/ADMIN_PASSWORD plus hashed sessions in
admin_sessions and SESSION_SECRET-signed cookies; there is no application users table. The historical migration copied all application tables,
including existing sessions, login attempts, audit logs, settings and borrowing history.
Postgres roles are not Supabase Auth users. Do not overwrite Supabase auth/storage.

## Audit and backup

`node scripts/backup-postgres.mjs` uses the local DATABASE_URL (or LOCAL_DATABASE_URL),
an exported repeatable-read snapshot and PostgreSQL 18 client tools. Output is under
ignored deploy/data/backups/local-TIMESTAMP. database.dump is the complete database,
public.dump is the application schema archive, schema.sql is the readable schema,
and manifest.json records columns, tables/counts/digests, indexes, constraints,
sequences, extensions and migration version. Archive TOCs are verified readable.
Archive readability is not a restore rehearsal. Copy encrypted backups off this machine.
Backups/restore SQL contain personal data/session hashes: never commit or expose them.
PG_BIN can point at another directory with matching pg_dump/pg_restore/psql tools.

Run `node scripts/rehearse-postgres.mjs BACKUP_DIRECTORY` to restore into a fresh
isolated local database. It checks all row counts/digests plus index/constraint counts,
retains the restored database and writes rehearsal.json. It never drops/resets the
source. This validates a local backup; it is not a hosted Supabase integration test.

Source migrations are scripts/schema.mjs (current version 2) and scripts/setup-db.mjs.
src/lib/db.ts calls that same migration unless AUTO_MIGRATE=false. Existing legacy
README instructions are not separate migrations. Restoring the real schema archive
preserves existing constraints/indexes beyond the application's minimum schema.

The original verified import had the 12 v1 application tables. The additive v2
direct-upload migration adds storage_upload_intents, including indexes, ownership/
status/expiry metadata, RLS and revocation of browser-role access. Current inventory:

| Area | Public application tables |
|---|---|
| Content | library_items, news_posts, wall_banners |
| Reader interactions | library_comments, library_likes, library_views, borrow_requests |
| Administration | admin_sessions, admin_login_attempts, audit_logs, site_settings |
| Schema/upload operations | thd_schema_migrations, storage_upload_intents |

There are 13 application tables in public; Supabase-managed auth/storage tables and
private historical thd_ops/thd_legacy schemas are outside this count. No application
users table or Supabase Auth account replacement was introduced. The v2 migration was
already applied and backed up during direct-upload work. Do not restore the v1 archive
again to obtain v2; existing content/session/borrow IDs, sequences and history remain.
`scripts/migrate-direct-upload.mjs` is the explicit additive migration tool, not a
production startup task. Verify migration version 2 with AUTO_MIGRATE=false.

## Target configuration and safe restore

Supply SUPABASE_DATABASE_URL through the process environment or a private file named
by DB_TARGET_ENV_FILE. Do not paste passwords into chat/commands or edit .env.local.
Use Supabase Connect's direct or session-pooler endpoint; do not use port 6543 for
restore. Include verified TLS settings/CA for production; tool defaults to encrypted
sslmode=verify-full. If the chain is not trusted by Node/libpq, download the project's
root certificate from Supabase Database Settings / SSL Configuration and set
DB_SSL_CA_FILE to its local path. This is supported by both the restore tool and the
app's pg pool; .env.local is not changed. Do not use NODE_TLS_REJECT_UNAUTHORIZED=0.
The Storage secret is not a PostgreSQL password.

Run preflight:
`node scripts/restore-supabase.mjs deploy/data/backups/local-TIMESTAMP`

After checking target identity/version and backup, append --apply. The command:
- verifies the archive hash and rejects conflicting target app tables/sequences;
- backs up the target before writes (target-before.dump);
- restores public app objects without owner/ACL changes to managed platform schemas;
- verifies each table's count and content digest before commit;
- enables RLS and revokes anon/authenticated access to restored tables;
- records the imported backup fingerprint in private thd_ops.imports;
- runs the entire restore in one transaction; errors roll it back.

Re-running the same backup is a no-op, preserving new writes. A different backup or
preexisting application tables causes refusal, never merge/overwrite. The marker
proves the original import committed, not that later app writes match the old snapshot.
Run preflight/restore only against the intended hosted project. Do not run --apply
against an already-running production application or a shared schema with unreviewed
object conflicts. Target versions below PG17 require a compatibility rehearsal.

An optional `--archive-empty-library-table` handles exactly one preexisting empty
public.library_items table from the old schema: it preserves the table and its owned
objects in private thd_legacy, with an exclusive lock and an empty-table check inside
the restore transaction. Nonempty tables are refused; no DROP or data merge occurs.
`scripts/verify-supabase.mjs BACKUP_DIRECTORY` verifies rows/hashes, indexes, columns,
NOT NULL, other constraints and sequences before application testing changes data.

For a true cutover, pause application writers and take a fresh backup; otherwise this
is a point-in-time test copy and later local writes are not included. No global
read-only setting is changed by the scripts. Review app objects/indexes/constraints,
sequence next values, TLS, and deny anonymous REST access after restore.

## App verification and production DATABASE_URL

Launch a separate local server with process DATABASE_URL set to the hosted connection,
AUTO_MIGRATE=false and STORAGE_DRIVER=supabase; keep .env.local's local URL untouched.
Use session mode for an always-running Node server. Vercel requires a transaction
pooler and a tuned connection budget; current max=10 needs review before serverless.
Keep ADMIN_USERNAME/ADMIN_PASSWORD, a separate random SESSION_SECRET of at least
32 bytes, APP_ORIGIN and optional exact HTTPS PUBLIC_ORIGINS configured in hosting
secrets. Production signed cookies contain a fresh random token plus HMAC; the table
continues to store SHA-256 of the raw token. ADMIN_SESSION_NOT_BEFORE rejects migrated
development sessions without deleting them. Keep the cutoff/secret stable on restarts
and application rollback; a secret rotation deliberately requires new login.
Changing DATABASE_URL is configuration, not a website deployment by itself. The actual
Railway public regression now passed 236 HTTP/API checks, including hosted CRUD,
sessions, interactions, borrow/return/stock and Storage. All pre-existing rows in
13 application tables retained identical counts and SHA-256 content fingerprints;
report: `test-results/production-regression-12edf2c4-a76b-4b4c-88c6-44b58a6826f9.json`.

Test real hosted HTTP health/login/session/dashboard, documents CRUD/search,
comments/moderation, likes/views, borrow approval/return and stock, news/banners,
Storage reads. Delete only freshly created, clearly identified test records where
authorized; never imported history. tsc/lint/build and unit tests do not replace
hosted database integration tests. Retain test evidence and compare imported data.

Railway uses DATABASE_URL directly with DB_SSL_CA_BASE64 or a runtime-mounted CA.
Startup materializes the CA outside the application tree with mode 0600 and forces
sslmode=verify-full/sslrootcert for the hosted connection. Do not paste a Windows
certificate path into Linux Railway, disable TLS verification or copy .env.local.
AUTO_MIGRATE=false and remote-only storage are enforced by the startup wrapper.
Production cannot silently fall back to local DB or persistent public/uploads.
The startup wrapper also refuses an actual PostgreSQL client socket unless encrypted
and certificate-authorized. Check its safe TLS protocol PASS line in the final Railway
release logs; never substitute the pooler's internal backend TLS statistic for that
client verification. Final Railway deployment `181babed-82c5-4ac2-8164-3f641b4bf9ff`
logged `Production database TLS PASS: TLSv1.3` and passed the live DB healthcheck.
The final public 223-check HTTP/API rerun after stopping local application servers
again preserved all pre-existing counts and SHA-256 fingerprints in the 13 tables:
`test-results/production-regression-fc85b53f-2556-4bb2-9da0-000210d7b3ed.json`.

## Hosted backups and recovery operations

`scripts/backup-postgres.mjs` is intentionally LOCAL-source-only; it refuses hosted
hosts and is not a production backup scheduler. Preserve its existing pre-migration
archives/manifests and restore rehearsal. The dedicated
`node scripts/backup-hosted-postgres.mjs` now performs a read-only, repeatable-read
hosted export using an explicit allowlist of 13 application tables and owned sequences.
It requires verified TLS and never exports/restores Supabase-managed auth/storage.
Supply BACKUP_DATABASE_URL or SUPABASE_DATABASE_URL privately, with BACKUP_ENV_FILE
and BACKUP_DB_SSL_CA_FILE/DB_SSL_CA_FILE where needed; no URL/password enters command
arguments or output. This is an operator tool, not an activated backup scheduler.

The pre-release hosted snapshot is stored locally under the Git-ignored directory
`deploy/data/backups/hosted-app-2026-10-14T01-13-46-796Z`. It contains `public.dump`,
`schema.sql`, archive TOC and SHA-256 file manifest, with all **13 application tables,
30 indexes, 24 constraints and 7 owned sequences**, schema version/RLS/policies and
row counts/digests. `pg_restore --list` passed; no hosted restore drill or off-site
copy is asserted. The dump predates later public QA writes, so do not treat it as a
snapshot of the final current database. Before a future schema/data operation or
recovery cutover, take a new hosted backup and keep the original snapshot intact.
Record hashes/readability plus an isolated restore drill. A historical local backup
does not cover new hosted writes.

For the current Free plan, arrange a regular logical export to encrypted off-site
storage, plus a pre-release/pre-migration export. Supabase recommends off-site exports
for Free projects; paid-plan daily backup availability does not replace this procedure.
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups)
also confirms that PostgreSQL backups contain Storage metadata, not the object bytes.

Use matching PostgreSQL client tools and the reviewed direct/session-pooler connection.
Populate PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSWORD securely from the hosted
connection inside the backup process, with PGSSLMODE=verify-full and PGSSLROOTCERT
pointing to the runtime CA. Never put the password/full connection URL in command-line
arguments, logs or Git. These command forms assume those private process variables are
already supplied and the chosen backup directory is outside the web root:

```powershell
pg_dump --no-password --format=custom --no-owner --no-acl --schema=public --file=app-production.dump
pg_restore --list app-production.dump
```

Also export existing thd_ops/thd_legacy application-history schemas when present;
keep their inventories/restore markers alongside the public dump. Do not restore
Supabase-managed auth/storage roles or platform objects from a local archive. Record
schema version, row counts/digests, indexes, constraints, sequences/next values and
object URL inventory at the backup boundary. Archives contain personal data/session
hashes; protect access and keep encryption keys/production secrets in their own vault.
Archive readability alone is not proof that restore succeeds.

Restore first into a fresh isolated target, supplying that target's PG variables/CA;
never use the live source credentials for a drill:

```powershell
pg_restore --no-password --no-owner --no-acl --single-transaction --dbname $env:PGDATABASE app-production.dump
```

Verify all 13 application tables, schema version, IDs, constraints/indexes/sequences,
row counts/digests and browser-role/RLS restrictions. Then run application health,
auth, document/search/media and borrow-stock checks against the restored target.
Reapply reviewed hosted access restrictions on a fresh target; a --no-acl archive does
not itself establish them. Confirm that the chosen restoration leaves newer writes
safe before any actual cutover. Keep the source and previous good backup intact.

Export Storage separately: both thd-library public objects and private
thd-library-quarantine objects, with bucket/path, MIME, size and content hash manifest.
Never persist signed upload tokens/URLs as recovery credentials. Store encrypted
copies outside the project/web root. For recovery, recreate the correct public/private
bucket mode and 50 MiB cap, upload missing files under their original UUID paths with
no overwrite, verify hashes and legacy /uploads resolution plus Range 206, then
reconcile storage_upload_intents metadata. Do not overwrite current objects or delete
orphans/QA/quarantine objects during recovery. Database-only restore cannot recover
removed bytes; old local uploads/migration manifests remain additional source copies.

Assign an operator and schedule/retention before school traffic; these procedures do
not imply an off-site scheduled job has already been activated. Pending/quarantine
cleanup remains reviewed manual retention, not automatic deletion. Monitor database
and Storage capacity, sanitized app errors, Railway restarts/memory and external
/api/health. Health probes check DB/schema, while Storage access needs its own read
probe/startup verification.

## Rollback

Before hosted application writes, switch the test server back to the unchanged local
DATABASE_URL. No local restore is necessary. A failed atomic restore leaves no partial
import. Do not delete Supabase schemas/auth/storage to retry.
After hosted writes, freeze writers, back up hosted DB/storage, reconcile new records
and stock/borrow changes before switching back; blindly restoring the old backup
would lose those writes. Restore a backup into a separate fresh database for a drill,
not over the only good database. Keep local source and both pre-migration backups.

Prefer an application-only rollback to a previous compatible Railway image with the
same hosted DATABASE_URL, Storage buckets, SESSION_SECRET and session cutoff. Do not
lower the cutoff or reuse a development secret, and do not roll back to a local-upload
image. Once public hosted writes exist, switching back to the unchanged local DB is
not a safe production rollback without reconciliation. SQL/import/Storage recovery is
a separate deliberate operation; preserve current data and isolate the first restore.

References:
- https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres
- https://www.postgresql.org/docs/18/app-pgdump.html
