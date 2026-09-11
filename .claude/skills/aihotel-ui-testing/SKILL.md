---
name: aihotel-ui-testing
description: Run AIhotel Japanese UI audits against the seeded local backend without mistaking demo placeholders for real functionality.
---

# Local UI testing

- Verify listeners on 3000, 3001 and PostgreSQL 5432 before starting duplicate processes. Follow README for dependency, Prisma migration and seed setup; never reset the database for a UI test.
- In the Corepack-shim environment, prefix pnpm commands with `COREPACK_INTEGRITY_KEYS=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- Start frontend from repository root with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001 NEXT_PUBLIC_DEMO_MODE=false pnpm dev:frontend` (plus the Corepack variables). Restart Next.js after changing public environment variables.
- Use the seed demo accounts documented in AGENTS.md for ADMIN, MANAGER and OPERATOR. Select a month covered by the seed rather than assuming the current month has data.
- Navigation is a sidebar in a single page at `/`; main content and the settings rank table have separate scroll containers.
- Distinguish role prevention from server errors: operator rank buttons can be disabled with Japanese permission guidance, so a UI-only test cannot prove a backend 403.
- Verify manager rank edits by reopening the tab; compare every nullable price before and after even when saving unchanged values. Keep a record of original values and clean up only test-owned changes.
- Pricing events live below the full calendar and trend graph. Use a unique QA name; verify persistence after tab remount and delete only that event.
- Native date fields may auto-advance segments. Click month/day/year separately and confirm the displayed full date before submitting.
- Verify report downloads in Chrome download history and inspect actual files, not merely button clicks. Some AI/report sections may be fixed demos even with demo fallback disabled: report those as placeholders, not live AI functionality.

## Devin Secrets Needed

None for a seeded local demo. Nonlocal environments require their own approved test accounts; do not reuse seed credentials there.
