import { isBoardEmpty, readCell } from './board';
import { cellKey, coversCenter, inBounds } from './coordinates';
import { normalisePlayWord } from './dictionary';
import { isLetter } from './letters';
import { pointsFor } from './rules';
import { bingoAward, scoreFormedWords } from './scoring';
import type {
  Board,
  Cell,
  FormedLetter,
  FormedWord,
  Letter,
  PlayError,
  PlayInput,
  PlayResult,
  ResolvedPlacement,
  Rules,
  TileInstance,
  TilePlacement,
} from './types';

type Direction = 'horizontal' | 'vertical' | 'single';

type CheckedPlacement = {
  readonly row: number;
  readonly col: number;
  readonly tile: TileInstance;
  readonly assignedLetter: Letter | null;
  readonly displayLetter: Letter;
};

export function validatePlay(input: PlayInput): PlayResult {
  const shape = readInput(input);
  if (shape.errors.length > 0 || !shape.checked || !shape.rules || !shape.board) {
    return { ok: false, errors: shape.errors };
  }

  const { rules, board, checked } = shape;
  const structural = structuralErrors(rules, board, checked);
  if (structural.length > 0) return { ok: false, errors: structural };

  const direction = directionOf(checked);
  if (direction === 'bent') {
    return { ok: false, errors: [playError('not-straight', 'Tiles must sit in one row or one column.')] };
  }

  const gaps = gapErrors(board, checked, direction);
  if (gaps.length > 0) return { ok: false, errors: gaps };

  const opening = openingErrors(rules, board, checked);
  const formed = formWords(rules, board, checked, direction);
  if (!formed.ok) return { ok: false, errors: [...opening, ...formed.errors] };
  if (opening.length > 0) return { ok: false, errors: opening };

  const connection = connectionErrors(board, formed.words);
  if (connection.length > 0) return { ok: false, errors: connection };

  const unknown = dictionaryErrors(input.dictionary, rules, formed.words);
  if (unknown.length > 0) return { ok: false, errors: unknown };

  const placements = checked.map(resolvePlacement);
  const bingo = bingoAward(rules, placements.length, input.rack.length);
  return {
    ok: true,
    play: {
      placements,
      words: formed.words,
      score: scoreFormedWords(rules, formed.words, bingo),
    },
  };
}

function readInput(input: PlayInput): { errors: PlayError[]; checked?: CheckedPlacement[]; rules?: Rules; board?: Board } {
  if (!input || typeof input.dictionary?.contains !== 'function' || typeof input.dictionary.versionId !== 'string') {
    return { errors: [playError('invalid-input', 'A dictionary provider is required.')] };
  }
  if (!input.rules || input.rules.boardSize !== input.board?.size) {
    return { errors: [playError('board-mismatch', 'The board size does not match the rules.')] };
  }
  if (input.dictionary.versionId !== input.rules.dictionaryVersionId) {
    return { errors: [playError('dictionary-mismatch', 'The dictionary preset does not match the rules.')] };
  }
  if (!Array.isArray(input.rack) || !Array.isArray(input.placements)) {
    return { errors: [playError('invalid-input', 'Rack and placements must be arrays.')] };
  }
  if (input.placements.length === 0) {
    return { errors: [playError('empty-placement', 'A play places at least one tile.')] };
  }

  const rackIds = new Map<string, TileInstance>();
  const errors: PlayError[] = [];
  const seenRack = new Set<string>();
  for (const tile of input.rack) {
    if (!isTileInstance(tile)) {
      errors.push(playError('invalid-input', 'A rack tile is malformed.'));
      continue;
    }
    if (seenRack.has(tile.id)) {
      errors.push(playError('duplicate-tile', `Rack tile ${tile.id} is listed twice.`, { tileId: tile.id }));
      continue;
    }
    seenRack.add(tile.id);
    rackIds.set(tile.id, tile);
  }
  if (errors.length > 0) return { errors };

  const checked: CheckedPlacement[] = [];
  const used = new Set<string>();
  const squares = new Set<string>();
  for (const placement of input.placements) {
    const parsed = readPlacement(placement, input.rules, rackIds, used, squares);
    errors.push(...parsed.errors);
    if (parsed.checked) checked.push(parsed.checked);
  }
  if (errors.length > 0) return { errors };
  return { errors, checked, rules: input.rules, board: input.board };
}

function readPlacement(
  placement: TilePlacement,
  rules: Rules,
  rack: Map<string, TileInstance>,
  used: Set<string>,
  squares: Set<string>,
): { errors: PlayError[]; checked?: CheckedPlacement } {
  if (!placement || typeof placement !== 'object' || !isTileInstance(placement.tile)) {
    return { errors: [playError('invalid-input', 'A placement is malformed.')] };
  }
  const { row, col, tile } = placement;
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return { errors: [playError('invalid-input', 'A placement needs integer coordinates.', { tileId: tile.id })] };
  }
  const errors: PlayError[] = [];
  const key = cellKey(row, col);
  if (squares.has(key)) {
    errors.push(playError('duplicate-coordinate', 'Two tiles were placed on the same square.', { row, col }));
  }
  squares.add(key);
  if (used.has(tile.id)) {
    errors.push(playError('duplicate-tile', `Tile ${tile.id} is placed twice.`, { tileId: tile.id, row, col }));
  }
  used.add(tile.id);

  const held = rack.get(tile.id);
  if (!held) {
    errors.push(playError('tile-not-on-rack', `Tile ${tile.id} is not on the rack.`, { tileId: tile.id, row, col }));
  } else if (held.letter !== tile.letter || held.points !== tile.points) {
    errors.push(playError('tile-mismatch', `Tile ${tile.id} does not match the rack.`, { tileId: tile.id, row, col }));
  }

  const expected = pointsFor(rules, tile.letter);
  if (expected === undefined || expected !== tile.points) {
    errors.push(playError('tile-value', 'Tile points do not match the rules.', { tileId: tile.id, row, col }));
  }
  if (tile.letter === null && tile.points !== 0) {
    errors.push(playError('tile-value', 'A blank scores 0.', { tileId: tile.id, row, col }));
  }

  const assigned = placement.assignedLetter;
  if (tile.letter === null) {
    if (!isLetter(assigned)) {
      errors.push(playError('assigned-letter', 'A blank needs an assigned letter.', { tileId: tile.id, row, col }));
    }
  } else if (assigned !== undefined) {
    errors.push(playError('assigned-letter', 'A letter tile cannot be reassigned.', { tileId: tile.id, row, col }));
  }

  if (errors.length > 0 || (tile.letter === null && !isLetter(assigned))) return { errors };
  const displayLetter = tile.letter ?? assigned;
  if (!isLetter(displayLetter)) return { errors };
  return {
    errors,
    checked: {
      row,
      col,
      tile,
      assignedLetter: tile.letter === null ? displayLetter : null,
      displayLetter,
    },
  };
}

function structuralErrors(rules: Rules, board: Board, placements: readonly CheckedPlacement[]): PlayError[] {
  const errors: PlayError[] = [];
  for (const placement of placements) {
    if (!inBounds(rules.boardSize, placement.row, placement.col)) {
      errors.push(playError('out-of-bounds', 'A tile is outside the board.', placement));
      continue;
    }
    const cell = readCell(board, placement.row, placement.col);
    if (cell.kind === 'occupied') {
      errors.push(playError('occupied', 'A tile covers an occupied square.', placement));
    }
  }
  if (errors.length > 0) return errors;
  if (directionOf(placements) === 'bent') {
    return [playError('not-straight', 'Tiles must sit in one row or one column.')];
  }
  return [];
}

function directionOf(placements: readonly CheckedPlacement[]): Direction | 'bent' {
  if (placements.length === 1) return 'single';
  const sameRow = placements.every((placement) => placement.row === placements[0]?.row);
  const sameCol = placements.every((placement) => placement.col === placements[0]?.col);
  if (sameRow && !sameCol) return 'horizontal';
  if (sameCol && !sameRow) return 'vertical';
  return 'bent';
}

function gapErrors(board: Board, placements: readonly CheckedPlacement[], direction: Direction): PlayError[] {
  if (direction === 'single') return [];
  const errors: PlayError[] = [];
  const placed = new Set(placements.map((placement) => cellKey(placement.row, placement.col)));
  if (direction === 'horizontal') {
    const row = placements[0]?.row ?? 0;
    const cols = placements.map((placement) => placement.col);
    for (let col = Math.min(...cols); col <= Math.max(...cols); col += 1) {
      if (!placed.has(cellKey(row, col)) && !occupied(board, row, col)) {
        errors.push(playError('gap', 'The play leaves a gap.', { row, col }));
      }
    }
  } else {
    const col = placements[0]?.col ?? 0;
    const rows = placements.map((placement) => placement.row);
    for (let row = Math.min(...rows); row <= Math.max(...rows); row += 1) {
      if (!placed.has(cellKey(row, col)) && !occupied(board, row, col)) {
        errors.push(playError('gap', 'The play leaves a gap.', { row, col }));
      }
    }
  }
  return errors;
}

function openingErrors(rules: Rules, board: Board, placements: readonly CheckedPlacement[]): PlayError[] {
  if (!isBoardEmpty(board) || !rules.firstPlayCoversCenter) return [];
  if (coversCenter(rules.boardSize, placements)) return [];
  return [playError('opening-misses-center', 'The opening play must cover the centre.')];
}

function connectionErrors(board: Board, words: readonly FormedWord[]): PlayError[] {
  if (isBoardEmpty(board)) return [];
  const touches = words.some((word) => word.letters.some((letter) => !letter.placedThisTurn));
  if (touches) return [];
  return [playError('disconnected', 'The play must connect to a tile already on the board.')];
}

function dictionaryErrors(
  dictionary: PlayInput['dictionary'],
  rules: Rules,
  words: readonly FormedWord[],
): PlayError[] {
  const errors: PlayError[] = [];
  for (const word of words) {
    const normalised = normalisePlayWord(word.text);
    if (!normalised.ok || !dictionary.contains(normalised.word)) {
      errors.push(playError('unknown-word', `${word.text} is not in the dictionary.`, { word: word.text }));
    }
    if (word.text.length < rules.minWordLength) {
      errors.push(playError('word-too-short', `${word.text} is shorter than the minimum word.`, { word: word.text }));
    }
  }
  return errors;
}

function formWords(
  rules: Rules,
  board: Board,
  placements: readonly CheckedPlacement[],
  direction: Direction,
): { ok: true; words: FormedWord[] } | { ok: false; errors: PlayError[] } {
  const added = new Map(placements.map((placement) => [cellKey(placement.row, placement.col), placement]));
  const words: FormedWord[] = [];
  const seen = new Set<string>();
  const errors: PlayError[] = [];

  const add = (word: FormedWord | PlayError[] | undefined) => {
    if (!word) return;
    if (Array.isArray(word)) {
      errors.push(...word);
      return;
    }
    if (word.letters.length < rules.minWordLength) return;
    const key = `${word.direction}:${word.start.row}:${word.start.col}`;
    if (seen.has(key)) return;
    seen.add(key);
    words.push(word);
  };

  const sorted = [...placements].sort((left, right) => left.row - right.row || left.col - right.col);
  const first = sorted[0];
  if (!first) return { ok: false, errors: [playError('empty-placement', 'A play places at least one tile.')] };

  if (direction !== 'vertical') add(lineThrough(board, added, first.row, first.col, 0, 1));
  if (direction !== 'horizontal') add(lineThrough(board, added, first.row, first.col, 1, 0));

  for (const placement of sorted) {
    if (direction === 'horizontal' || direction === 'single') {
      add(lineThrough(board, added, placement.row, placement.col, 1, 0));
    }
    if (direction === 'vertical' || direction === 'single') {
      add(lineThrough(board, added, placement.row, placement.col, 0, 1));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (words.length === 0) {
    return { ok: false, errors: [playError('word-too-short', 'The play does not form a word of the minimum length.')] };
  }
  return { ok: true, words };
}

function lineThrough(
  board: Board,
  added: ReadonlyMap<string, CheckedPlacement>,
  row: number,
  col: number,
  dRow: number,
  dCol: number,
): FormedWord | PlayError[] | undefined {
  let startRow = row;
  let startCol = col;
  while (letterAt(board, added, startRow - dRow, startCol - dCol)) {
    startRow -= dRow;
    startCol -= dCol;
  }

  const letters: FormedLetter[] = [];
  let cursorRow = startRow;
  let cursorCol = startCol;
  while (inBounds(board.size, cursorRow, cursorCol)) {
    const found = letterAt(board, added, cursorRow, cursorCol);
    if (!found) break;
    if ('code' in found) return [found];
    letters.push(found);
    cursorRow += dRow;
    cursorCol += dCol;
  }
  if (letters.length === 0) return undefined;
  const start = letters[0];
  if (!start) return undefined;
  return {
    direction: dCol === 1 ? 'horizontal' : 'vertical',
    start: { row: start.row, col: start.col },
    letters,
    text: letters.map((letter) => letter.letter).join(''),
  };
}

function letterAt(
  board: Board,
  added: ReadonlyMap<string, CheckedPlacement>,
  row: number,
  col: number,
): FormedLetter | PlayError | undefined {
  if (!inBounds(board.size, row, col)) return undefined;
  const placed = added.get(cellKey(row, col));
  if (placed) {
    return {
      row,
      col,
      letter: placed.displayLetter,
      points: placed.tile.points,
      placedThisTurn: true,
      tileId: placed.tile.id,
    };
  }
  const cell = readCell(board, row, col);
  if (cell.kind !== 'occupied') return undefined;
  const letter = displayLetter(cell);
  if (!letter) {
    return playError('corrupt-cell', 'An occupied square has no letter.', { row, col, tileId: cell.tileId });
  }
  return {
    row,
    col,
    letter,
    points: cell.points,
    placedThisTurn: false,
    tileId: cell.tileId,
  };
}

function displayLetter(cell: Extract<Cell, { kind: 'occupied' }>): Letter | undefined {
  if (cell.letter) return cell.letter;
  return cell.assignedLetter ?? undefined;
}

function occupied(board: Board, row: number, col: number): boolean {
  return readCell(board, row, col).kind === 'occupied';
}

function resolvePlacement(placement: CheckedPlacement): ResolvedPlacement {
  return {
    row: placement.row,
    col: placement.col,
    tileId: placement.tile.id,
    letter: placement.tile.letter,
    assignedLetter: placement.assignedLetter,
    points: placement.tile.points,
    displayLetter: placement.displayLetter,
  };
}

function isTileInstance(value: unknown): value is TileInstance {
  if (!value || typeof value !== 'object') return false;
  const tile = value as TileInstance;
  return typeof tile.id === 'string' && tile.id.length > 0 && (tile.letter === null || isLetter(tile.letter)) && Number.isInteger(tile.points);
}

function playError(
  code: PlayError['code'],
  message: string,
  extra?: { row?: number; col?: number; tileId?: string; word?: string },
): PlayError {
  return { code, message, ...extra };
}
