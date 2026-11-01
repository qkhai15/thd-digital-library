# Dependency advisory follow-up

Release review updated 2026-10-26. **Production dependency remediation and fresh
quality gates are pending; do not treat the older clean audit as current.**

## Production dependency update

The release owner's fresh 26 October audit reports new advisories affecting the
currently installed `next@16.3.8`. Upgrade work is in progress to the compatible
`next@16.4.3` and matching `eslint-config-next@16.4.3`; there is no framework
downgrade or `npm audit fix --force` remediation.

Before release, confirm the resolved lockfile versions and rerun both production
and full dependency audits, then TypeScript, lint, build, the complete test suite
including explicitly configured isolated PostgreSQL checks, Docker and relevant
browser engines. Record actual post-upgrade results; the old zero-finding report
does not clear new advisories. No patched-version production PASS is claimed here.

## Prior development-only finding

The earlier feature dependency checkpoint reported:

- `npm audit --omit=dev --json`: 0 production dependency vulnerabilities **at that older checkpoint**.
- Full `npm audit`: 5 high findings representing one vulnerable development dependency and its dependency chain:
  `eslint-config-next@16.3.8 → @next/eslint-plugin-next@16.3.8 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3`.
- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) describes stack exhaustion from deeply nested brace patterns. The primary advisory reports **no patched version**. Registry inspection (`npm view braces version versions --json`) also reports `3.0.3` as the latest published release.

No version override was added at that checkpoint: no published patched `braces`
version was available. Re-evaluate the chain and advisory after the current Next.js
update; do not assume the historical finding count is the final result. The older
`npm audit fix --force` suggestion downgraded the Next.js lint configuration across
major versions, which was not a compatible fix for this project.

The Railway runtime stage installs dependencies with `npm ci --omit=dev --ignore-scripts`,
excluding development-only ESLint packages from the installed runtime dependencies.
This does **not** mitigate advisories in the production Next.js package. Run
lint/build only on trusted repository content and configuration; do not expose
these tools to arbitrary user-supplied glob patterns. Development containment is
not a claim that the advisory itself is fixed.

Follow-up: check the advisory and npm registry during dependency maintenance. When a compatible patched release is published, update the lockfile or add a narrowly scoped override, then rerun audit, lint, tests and build. Keep full-audit findings visible until verified remediation is available.
