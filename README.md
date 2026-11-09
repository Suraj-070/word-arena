# Word Arena

Phase 1 is the UI foundation. Phase 2 is `@word-arena/engine`. Phase 3 plays a local two-player match. Phase 4 adds private online rooms. Phase 4.1 stores match actions in Postgres, with the receipt in the same transaction, and uses the letter dialog for a blank tile. No dictionary is configured, so a scored move cannot be submitted. The browser uses only a Supabase publishable key. The match function is not deployed, and no remote database migration has been applied.

## Scripts

```bash
pnpm install
pnpm dev
pnpm test
pnpm --filter @word-arena/engine test
pnpm test:e2e
pnpm typecheck
pnpm build
```

Playwright needs a browser once per machine:

```bash
pnpm exec playwright install chromium
```

Fonts are Fraunces and Source Sans 3, both under the SIL Open Font License. See `apps/web/public/NOTICE.md`.
