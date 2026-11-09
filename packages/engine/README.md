# @word-arena/engine

Pure TypeScript rules for Word Arena. The package validates configuration, places words, and scores them. It does not render, store a match, draw a bag, or talk to a server.

React, the DOM, Zustand, Motion, Supabase, and Vite are not dependencies. Callers pass the rules, the board, the rack, and a dictionary provider. The functions do not read the clock or `Math.random`.

## Public API

Import from `@word-arena/engine`.

- `validateRules` and `arenaStandardRules` — configuration.
- `createBoard`, `readCell`, `inBounds`, `occupiedCells`, `isBoardEmpty`, `applyPlay` — board.
- `centerCoordinate`, `coversCenter`, `NAMED_BOARD_SIZES` — coordinates.
- `validatePlay` — placement, dictionary check, and score.
- `createMatch`, `dealMatch`, `applyMatchAction` — a two-player match. Shuffle is an argument. The package does not call `Math.random`.
- `scoreFormedWords`, `bingoAward`, `bonusAt` — scoring without a move.
- `normalisePlayWord`, `createMemoryDictionary`, `dictionaryForPreset`, `sharedDictionaries`, `DICTIONARY_PRESETS` — dictionary boundary.

`validateRules` and `validatePlay` return `{ ok: true, ... }` or `{ ok: false, errors }`. They do not change their inputs. `applyPlay` copies the board and accepts only a play that `validatePlay` already accepted.

## Coordinates

Row `0`, column `0` is the top-left square. Row increases downward. Column increases to the right. Values are zero-based. The shell's spoken row and column numbers are these values plus one.

The centre of an odd board is `((size - 1) / 2, (size - 1) / 2)`. Arena Standard is 15×15, so its centre is row 7, column 7. A 9×9 board uses row 4, column 4. The centre is computed. It is not a stored coordinate.

## Configuration

`validateRules` accepts one object and rejects anything else. Unknown fields, even board edges, edges outside 9 through 31, and any `modeId` other than `arena-standard` fail. Invalid settings are not repaired.

`arenaStandardRules` is the approved preset: 15×15, rack 7, bingo 50, 100 tiles, blank value 0, minimum word length 2, opening play covers the centre, centre word multiplier 2. Its bonus list is empty. No bonus-square layout has been approved, so tests that need multipliers pass a synthetic list of their own.

`passRoundLimit` and `exchangeAllowed` are stored and not acted on.

The shipped lexicon is ESDB `rel-2026.02.25`, commit `7e99edab8e32f9f9ea2b15f249ca8d4d67237410`, size 60, variant level 1. Presets are Australian (`D`, the default), British `-ise` (`B`), Oxford `-ize` (`Z`), American (`A`), and Canadian (`C`). `Z` and `C` are not licence-cleared. Notices are in `dictionary/NOTICE.md`. Lookup is local. A missing provider still rejects a scored play.

## Dictionary providers

```ts
const dictionary = createMemoryDictionary(rules.dictionaryVersionId, ['AT', 'CAT']);
validatePlay({ rules, board, rack, placements, dictionary });
```

`contains` is exact on the normalised A–Z form. The engine lowercases and rejects spaces, marks, punctuation, and digits. A provider's `versionId` must equal `rules.dictionaryVersionId`.

## Tests

From the repository root:

```bash
pnpm --filter @word-arena/engine test
pnpm --filter @word-arena/engine typecheck
```

`pnpm test` runs these tests and the web tests.

## Not implemented

`src/lexicon-data.ts` is the generated word list. Play does not fetch it. A play is rejected when the caller does not pass a dictionary, or when the provider's version does not match the match. Pass ends the match after `passRoundLimit` full rounds of consecutive passes. Exchange shuffles returned tiles with the caller’s random function.
