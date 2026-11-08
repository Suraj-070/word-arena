# Word Arena

Phase 1 is the UI foundation: design tokens, an app shell, and an empty board and rack. There is no match, dictionary, or account system yet.

## Scripts

```bash
pnpm install
pnpm dev
pnpm test
pnpm test:e2e
pnpm typecheck
pnpm build
```

Playwright needs a browser once per machine:

```bash
pnpm exec playwright install chromium
```

Fonts are Fraunces and Source Sans 3, both under the SIL Open Font License. See `apps/web/public/NOTICE.md`.
