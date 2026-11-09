import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useReducedMotion } from 'motion/react';
import type { MatchEnd, ScoreBreakdown, Seat } from '@word-arena/engine';
import { standings } from '@word-arena/online/client';

const SOUND_KEY = 'word-arena-sound';

export type SquareEffect = 'play' | 'letter' | 'word' | 'both';

type Props = {
  version: number;
  score: ScoreBreakdown | null;
  status: 'playing' | 'finished';
  end: MatchEnd | null;
  names: readonly [string, string];
  scores: readonly [number, number];
  turn: Seat;
  you?: Seat;
  mode?: 'classic' | 'wild';
  onEffects: Dispatch<SetStateAction<ReadonlyMap<string, SquareEffect>>>;
};

/** Tiles from a confirmed play after this view opened. A refresh keeps the first version still. */
export function useFreshPlacements(version: number, score: ScoreBreakdown | null): ReadonlySet<string> {
  const seen = useRef<number | null>(null);
  const fresh = useRef<ReadonlySet<string>>(new Set());
  if (seen.current === null) {
    seen.current = version;
  } else if (version > seen.current) {
    seen.current = version;
    const next = new Set<string>();
    for (const word of score?.words ?? []) {
      for (const letter of word.letters) {
        if (letter.placedThisTurn) next.add(`${letter.row}-${letter.col}`);
      }
    }
    fresh.current = next;
  }
  return fresh.current;
}

export function PlayFeedback({ version, score, status, end, names, scores, turn, you, mode = 'classic', onEffects }: Props) {
  const reduce = useReducedMotion() === true || document.documentElement.dataset.reducedMotion === 'true';
  const [floater, setFloater] = useState('');
  const [note, setNote] = useState('');
  const [victory, setVictory] = useState('');
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) === 'on');
  const seen = useRef<number | null>(null);
  const best = useRef(0);
  const timers = useRef<number[]>([]);
  const generation = useRef(0);
  const openedFinished = useRef(status === 'finished');

  useEffect(() => () => {
    generation.current += 1;
    for (const id of timers.current) window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = version;
      if (score) best.current = Math.max(best.current, score.total);
      return;
    }
    // A repeated read of this version must leave the running cleanup timers alone.
    if (version <= seen.current) return;
    generation.current += 1;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    seen.current = version;
    if (!score) {
      const mover = names[turn === 0 ? 1 : 0];
      setNote(`${mover} moved.`);
      setFloater('');
      onEffects(new Map());
      return;
    }
    const effects = new Map<string, SquareEffect>();
    for (const word of score.words) {
      for (const letter of word.letters) {
        const key = `${letter.row}-${letter.col}`;
        const letterHit = letter.placedThisTurn && letter.letterMultiplier > 1;
        const wordHit = word.wordMultiplier > 1;
        const effect: SquareEffect = letterHit && wordHit ? 'both' : wordHit ? 'word' : letterHit ? 'letter' : 'play';
        effects.set(key, mergeEffect(effects.get(key), effect));
      }
    }
    onEffects(reduce ? new Map() : effects);
    setFloater(`+${score.total}`);
    if (!reduce) {
      const current = generation.current;
      const hideHighlights = window.setTimeout(() => {
        if (generation.current !== current) return;
        onEffects(new Map());
      }, 320);
      const hideFloater = window.setTimeout(() => {
        if (generation.current !== current) return;
        setFloater('');
      }, mode === 'wild' ? 900 : 700);
      timers.current = [hideHighlights, hideFloater];
    }
    const freshBest = best.current > 0 && score.total > best.current;
    best.current = Math.max(best.current, score.total);
    const actor = names[turn === 0 ? 1 : 0];
    const parts = [formatBreakdown(score)];
    if (you !== undefined && actor !== names[you]) parts.unshift(`${actor} played.`);
    const raised = mode === 'wild' ? upgradedLetters(score) : [];
    if (raised.length > 0) parts.push(`${raised.join(', ')}.`);
    if (freshBest) parts.push('New best play.');
    setNote(parts.join(' '));
    if (sound && !reduce) playTone(score.bingo > 0 ? 'bingo' : 'score');
  }, [version, score, names, turn, you, mode, reduce, sound, onEffects]);

  useEffect(() => {
    if (openedFinished.current || status !== 'finished' || !end) return;
    openedFinished.current = true;
    setVictory(victoryLabel(end, names, scores));
    if (sound && !reduce) playTone('win');
  }, [status, end, names, scores, sound, reduce]);

  return (
    <div className="play-feedback" data-reduced={reduce ? 'true' : 'false'}>
      {floater ? <p className="score-floater" data-reduced={reduce ? 'true' : 'false'} aria-hidden="true">{floater}</p> : null}
      {note ? <p className="score-note" role="status" data-bingo={note.includes('Bingo') ? 'true' : 'false'}>{note}</p> : null}
      {victory ? <p className="victory-note" role="status">{victory}</p> : null}
      <button
        type="button"
        className="match-action"
        aria-pressed={sound}
        onClick={() => {
          const next = !sound;
          setSound(next);
          localStorage.setItem(SOUND_KEY, next ? 'on' : 'off');
        }}
      >
        {sound ? 'Mute sounds' : 'Play sounds'}
      </button>
    </div>
  );
}

export function Count({ value }: { value: number }) {
  const reduce = useReducedMotion() === true || document.documentElement.dataset.reducedMotion === 'true';
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / 240);
      setShown(Math.round(start + (value - start) * t));
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);
  return <>{shown}</>;
}

export function formatBreakdown(score: ScoreBreakdown): string {
  const words = score.words.map((word) => {
    const letters = word.letters.map((letter) => (
      letter.letterMultiplier > 1 ? `${letter.letter} ${letter.points}×${letter.letterMultiplier}` : letter.letter
    )).join(' ');
    const multiplier = word.wordMultiplier > 1 ? ` ×${word.wordMultiplier}` : '';
    return `${word.text} ${word.score} (${letters}${multiplier})`;
  });
  const bingo = score.bingo > 0 ? ` Bingo +${score.bingo}.` : '';
  return `${words.join('; ')}.${bingo}`;
}

function mergeEffect(current: SquareEffect | undefined, next: SquareEffect): SquareEffect {
  if (!current || current === next || current === 'play') return next;
  if (next === 'play') return current;
  return 'both';
}

function upgradedLetters(score: ScoreBreakdown): string[] {
  const raised: string[] = [];
  const seen = new Set<string>();
  for (const word of score.words) {
    for (const letter of word.letters) {
      const key = `${letter.row}-${letter.col}`;
      if (seen.has(key) || !letter.placedThisTurn || letter.letterMultiplier <= 1 || letter.points === 0) continue;
      seen.add(key);
      raised.push(`${letter.letter} is now ${letter.value}`);
    }
  }
  return raised;
}

/** The board uses the same standing that match history stores. */
function victoryLabel(end: MatchEnd, names: readonly [string, string], scores: readonly [number, number]): string {
  const [left] = standings(end, scores);
  if (left === 'draw') return 'Drawn.';
  return `${names[left === 'win' ? 0 : 1]} wins.`;
}

function playTone(kind: 'score' | 'bingo' | 'win') {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  const audio = new Context();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = kind === 'win' ? 523 : kind === 'bingo' ? 440 : 330;
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.04, audio.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + (kind === 'win' ? 0.55 : 0.18));
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + (kind === 'win' ? 0.6 : 0.2));
  osc.onended = () => void audio.close();
}
