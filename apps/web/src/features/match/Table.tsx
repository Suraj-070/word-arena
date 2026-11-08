import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { isLetter, LETTERS, readCell, type BonusClass, type DictionaryProvider, type PlayResult } from '@word-arena/engine';
import { Board, type BoardFace } from '../board/Board';
import { BoardScroll } from '../board/BoardScroll';
import { Rack, type RackTile } from '../board/Rack';
import { Tile } from '../../components/ui/Tile';
import { placementPreview, useTableStore } from './table-store';

function statusMessage(notice: string, preview: PlayResult | null, dictionary: DictionaryProvider | null): string {
  if (notice) return notice;
  if (preview && !preview.ok) return preview.errors.map((error) => error.message).join(' ');
  if (preview?.ok) {
    const words = preview.play.score.words.map((word) => `${word.text} ${word.score}`).join(', ');
    return `Preview, not submitted. ${words}. Total ${preview.play.score.total}.`;
  }
  if (dictionary === null) {
    return 'No dictionary is configured. Words are not checked, and a move cannot be submitted.';
  }
  return 'Place tiles, then submit.';
}

const BONUS_LABEL: Record<BonusClass, string> = {
  'letter-2': 'L2',
  'letter-3': 'L3',
  'word-2': 'W2',
  'word-3': 'W3',
};

export function Table() {
  const match = useTableStore((state) => state.match);
  const dictionary = useTableStore((state) => state.dictionary);
  const selected = useTableStore((state) => state.selected);
  const draft = useTableStore((state) => state.draft);
  const pendingBlank = useTableStore((state) => state.pendingBlank);
  const notice = useTableStore((state) => state.notice);
  const toggleSelected = useTableStore((state) => state.toggleSelected);
  const placeSelected = useTableStore((state) => state.placeSelected);
  const placeTile = useTableStore((state) => state.placeTile);
  const assignBlank = useTableStore((state) => state.assignBlank);
  const cancelBlank = useTableStore((state) => state.cancelBlank);
  const recall = useTableStore((state) => state.recall);
  const undo = useTableStore((state) => state.undo);
  const clearDraft = useTableStore((state) => state.clearDraft);
  const moveRackTile = useTableStore((state) => state.moveRackTile);
  const submit = useTableStore((state) => state.submit);
  const pass = useTableStore((state) => state.pass);
  const exchange = useTableStore((state) => state.exchange);
  const resign = useTableStore((state) => state.resign);
  const rename = useTableStore((state) => state.rename);

  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const ignoreClick = useRef(false);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);

  const seat = match.turn;
  const player = match.players[seat];
  const finished = match.status === 'finished';
  const drafted = new Set(draft.map((placement) => placement.tileId));
  const rack = player.rack.filter((tile) => !drafted.has(tile.id));
  const rackTiles: RackTile[] = rack.map((tile) => ({
    id: tile.id,
    letter: tile.letter ?? ' ',
    points: tile.points,
    selected: selected.includes(tile.id),
  }));
  const preview = placementPreview(match, draft, dictionary);
  const faces = new Map<string, BoardFace>();
  for (let row = 0; row < match.board.size; row += 1) {
    for (let col = 0; col < match.board.size; col += 1) {
      const cell = readCell(match.board, row, col);
      if (cell.kind !== 'occupied') continue;
      const letter = cell.letter ?? cell.assignedLetter;
      if (!letter) continue;
      faces.set(`${row}-${col}`, { letter, points: cell.points, draft: false });
    }
  }
  for (const placement of draft) {
    const tile = player.rack.find((candidate) => candidate.id === placement.tileId);
    if (!tile) continue;
    const letter = tile.letter ?? placement.assignedLetter;
    if (!letter) continue;
    faces.set(`${placement.row}-${placement.col}`, { letter, points: tile.points, draft: true });
  }
  const bonuses = new Map<string, string>();
  for (const bonus of match.rules.bonuses) {
    bonuses.set(`${bonus.row}-${bonus.col}`, BONUS_LABEL[bonus.class]);
  }

  function onDragStart(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || finished) return;
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.current = { id, x: event.clientX, y: event.clientY, moved: false };
  }

  function onDragMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) current.moved = true;
    if (current.moved) setGhost({ id: current.id, x: event.clientX, y: event.clientY });
  }

  function onDragEnd(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    drag.current = null;
    setGhost(null);
    if (typeof event.currentTarget.releasePointerCapture === 'function' && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!current?.moved) return;
    ignoreClick.current = true;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const square = hit?.closest<HTMLElement>('[data-row][data-col]');
    if (square?.dataset.row && square.dataset.col) {
      placeTile(id, Number(square.dataset.row), Number(square.dataset.col));
      return;
    }
    const slot = hit?.closest<HTMLElement>('[data-rack-index]');
    if (!slot?.dataset.rackIndex) return;
    const from = rackTiles.findIndex((tile) => tile.id === id);
    const to = Number(slot.dataset.rackIndex);
    if (from < 0 || !Number.isInteger(to) || to === from) return;
    const direction = to < from ? -1 : 1;
    for (let step = 0; step < Math.abs(to - from); step += 1) moveRackTile(id, direction);
  }

  const ghostTile = ghost ? rackTiles.find((tile) => tile.id === ghost.id) : undefined;
  const canAct = !finished && draft.length === 0 && !pendingBlank;
  const style = { '--board-size': String(match.rules.boardSize) } as CSSProperties;

  return (
    <div className="board-frame" style={style}>
      <BoardScroll>
        <div className="board-center">
          <Board
            boardSize={match.rules.boardSize}
            faces={faces}
            bonuses={bonuses}
            label="Board"
            onUse={(row, col) => {
              const face = faces.get(`${row}-${col}`);
              if (face?.draft) recall(row, col);
              else placeSelected(row, col);
            }}
            onRecall={recall}
          />
        </div>
      </BoardScroll>
      <section className="match-chrome" aria-label="Match">
        <p className="match-status">
          <span>{finished ? 'Match over' : `${player.name} to move`}</span>
          <span>
            {match.players[0].name} {match.players[0].score}
            {' · '}
            {match.players[1].name} {match.players[1].score}
          </span>
          <span>{match.bag.length} in the bag</span>
        </p>
        <p className="match-message" aria-live="polite">
          {statusMessage(notice, preview, dictionary)}
        </p>
        <div className="match-controls">
          <label className="match-name">
            <span className="sr-only">Player 1 name</span>
            <input
              aria-label="Player 1 name"
              defaultValue={match.players[0].name}
              key={match.players[0].name}
              maxLength={24}
              onBlur={(event) => rename(0, event.target.value)}
            />
          </label>
          <label className="match-name">
            <span className="sr-only">Player 2 name</span>
            <input
              aria-label="Player 2 name"
              defaultValue={match.players[1].name}
              key={match.players[1].name}
              maxLength={24}
              onBlur={(event) => rename(1, event.target.value)}
            />
          </label>
          <button type="button" className="match-action" data-primary="true" disabled={finished || draft.length === 0 || dictionary === null} onClick={submit}>
            Submit
          </button>
          <button type="button" className="match-action" disabled={draft.length === 0} onClick={undo}>
            Undo
          </button>
          <button type="button" className="match-action" disabled={draft.length === 0 && !pendingBlank} onClick={clearDraft}>
            Clear
          </button>
          <button type="button" className="match-action" disabled={!canAct} onClick={pass}>
            Pass
          </button>
          <button type="button" className="match-action" disabled={!canAct || !match.rules.exchangeAllowed || selected.length === 0} onClick={exchange}>
            Exchange
          </button>
          <button type="button" className="match-action" disabled={!canAct} onClick={resign}>
            Resign
          </button>
        </div>
      </section>
      <Rack
        label={`${player.name} rack, ${rackTiles.length} tiles`}
        tiles={rackTiles}
        onSelect={(id) => {
          if (ignoreClick.current) {
            ignoreClick.current = false;
            return;
          }
          toggleSelected(id);
        }}
        onMove={moveRackTile}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
      />
      {pendingBlank ? (
        <div className="blank-dialog" role="dialog" aria-modal="true" aria-label="Choose a letter for the blank">
          <p>Choose a letter. The blank still scores 0.</p>
          <div className="blank-letters">
            {LETTERS.split('').map((letter) => (
              <button
                key={letter}
                type="button"
                className="match-action"
                onClick={() => {
                  if (isLetter(letter)) assignBlank(letter);
                }}
              >
                {letter}
              </button>
            ))}
          </div>
          <button type="button" className="match-action" onClick={cancelBlank}>
            Cancel
          </button>
        </div>
      ) : null}
      {ghost && ghostTile ? (
        <div className="tile-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <Tile letter={ghostTile.letter.trim() === '' ? ' ' : ghostTile.letter} points={ghostTile.points} />
        </div>
      ) : null}
    </div>
  );
}
