# Word Arena

Phase 1 is the UI foundation. Phase 2 is `@word-arena/engine`. The web app plays a local two-player match with that engine. No dictionary is configured, so a move cannot be submitted and words are not treated as validated. There is no account system.

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
