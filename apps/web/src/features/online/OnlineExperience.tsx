import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { followMatch } from '@word-arena/online/client';
import { readCell, type Letter } from '@word-arena/engine';
import { bonusMarks, scoringCopy } from '../match/board-marks';
import { ScoringBadge } from '../match/ScoringBadge';
import { Count, PlayFeedback, useFreshPlacements, type SquareEffect } from '../match/celebration';
import { BlankLetterDialog } from '../board/BlankLetterDialog';
import { Board, type BoardFace } from '../board/Board';
import { BoardScroll } from '../board/BoardScroll';
import { Rack, type RackTile } from '../board/Rack';
import type { AuthPort, RoomPort, SessionUser } from './ports';
import type { MatchCommand, PlayerMatch, RoomView } from './session-types';

type Props = {
  auth: AuthPort;
  roomsFor: (user: SessionUser) => RoomPort;
};

export function OnlineExperience({ auth, roomsFor }: Props) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void auth.getSession().then((session) => {
      if (!live) return;
      setUser(session);
      setReady(true);
    });
    const stop = auth.onChange((next) => {
      setUser(next);
      setReady(true);
    });
    return () => {
      live = false;
      stop();
    };
  }, [auth]);

  if (!ready) {
    return (
      <div className="online-wrap">
        <p className="online-card" role="status">Checking your session.</p>
      </div>
    );
  }
  if (!user) return <AuthForm auth={auth} onUser={setUser} />;
  return <Lobby user={user} port={roomsFor(user)} onSignOut={() => void auth.signOut().then(() => setUser(null))} />;
}

function AuthForm({ auth, onUser }: { auth: AuthPort; onUser: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const emailError = validEmail(email) ? '' : 'Enter a valid email address.';
    const passwordError = password.length >= 8 ? '' : 'Use at least 8 characters.';
    if (emailError || passwordError) {
      setError(emailError || passwordError);
      return;
    }
    setBusy(true);
    setError('');
    const result = mode === 'register' ? await auth.signUp(email, password) : await auth.signIn(email, password);
    setBusy(false);
    if (result.error || !result.user) {
      setError(result.error ?? 'Sign in failed.');
      return;
    }
    onUser(result.user);
  }

  return (
    <div className="online-wrap">
      <form className="online-card" onSubmit={onSubmit} noValidate>
        <h2 className="online-title">{mode === 'register' ? 'Create an account' : 'Sign in'}</h2>
        <p className="online-copy">
          {auth.configured
            ? 'Private rooms use your Supabase account. Scored plays stay unavailable until an approved dictionary is configured.'
            : 'Online play is not connected to a Supabase project. Signing in cannot start a match.'}
        </p>
        <label className="online-field">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            aria-invalid={error.includes('email') ? true : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="online-field">
          Password
          <input
            type="password"
            name="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            value={password}
            aria-invalid={error.includes('8 characters') ? true : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="online-error" role="alert">{error}</p> : null}
        <button className="online-button" type="submit" data-primary="true" disabled={busy} aria-busy={busy}>
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </button>
        <button
          className="online-button"
          type="button"
          onClick={() => {
            setMode(mode === 'register' ? 'sign-in' : 'register');
            setError('');
          }}
        >
          {mode === 'register' ? 'I already have an account' : 'Create an account'}
        </button>
      </form>
    </div>
  );
}

function Lobby({ user, port, onSignOut }: { user: SessionUser; port: RoomPort; onSignOut: () => void }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [match, setMatch] = useState<PlayerMatch | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [link, setLink] = useState<'online' | 'offline' | 'connecting'>('online');

  useEffect(() => {
    function offline() {
      setLink('offline');
    }
    function online() {
      setLink('connecting');
      if (!room) {
        setLink('online');
        return;
      }
      void port.readRoom(room.id).then((result) => {
        if (result.ok) setRoom(result.room);
        setLink('online');
      });
    }
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [port, room]);

  async function create() {
    setError('');
    const result = await port.createRoom();
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRoom(result.room);
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    setError('');
    const result = await port.joinRoom(code);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRoom(result.room);
  }

  if (match && room) {
    return (
      <OnlineTable
        room={room}
        match={match}
        port={port}
        link={link}
        onMatch={setMatch}
        onRoom={setRoom}
        onLeave={() => {
          setMatch(null);
          setRoom(null);
        }}
      />
    );
  }

  return (
    <div className="online-wrap">
      <section className="online-card" aria-label="Online lobby">
        <h2 className="online-title">{room ? 'Private room' : 'Online'}</h2>
        <p className="online-copy">Signed in as {user.email}. Scored plays stay unavailable until an approved dictionary is configured.</p>
        {link === 'offline' ? <p className="online-error" role="status">You are offline. The match is unchanged.</p> : null}
        {link === 'connecting' ? <p role="status">Reconnecting.</p> : null}
        {error ? <p className="online-error" role="alert">{error}</p> : null}
        {room ? (
          <WaitingRoom
            room={room}
            onChange={async (next) => {
              setRoom(next);
              if (next.matchId && next.status === 'playing') {
                const loaded = await port.readMatch(next.matchId);
                if (!loaded.ok) setError(loaded.message);
                else setMatch(loaded.match);
              }
            }}
            port={port}
          />
        ) : (
          <>
            <button className="online-button" type="button" data-primary="true" onClick={() => void create()}>
              Create private room
            </button>
            <form className="online-join" onSubmit={(event) => void join(event)}>
              <label className="online-field">
                Room code
                <input value={code} onChange={(event) => setCode(event.target.value)} autoCapitalize="characters" />
              </label>
              <button className="online-button" type="submit">Join room</button>
            </form>
          </>
        )}
        <button className="online-button" type="button" onClick={onSignOut}>Sign out</button>
      </section>
    </div>
  );
}

function WaitingRoom({ room, port, onChange }: { room: RoomView; port: RoomPort; onChange: (room: RoomView) => void }) {
  const [scoringMode, setScoringMode] = useState<'classic' | 'wild'>('classic');
  const opponent = room.members.find((member) => member.seat !== room.yourSeat);
  async function run(action: () => Promise<{ ok: true; room: RoomView } | { ok: false; message: string }>) {
    const result = await action();
    if (result.ok) onChange(result.room);
  }
  return (
    <div className="online-room">
      <p>Room code <strong translate="no">{room.code}</strong></p>
      <p>{room.youAreHost ? 'You are the host.' : 'You joined as the guest.'}</p>
      <ul>
        {room.members.map((member) => (
          <li key={member.userId}>
            {member.displayName} {member.connected ? 'connected' : 'disconnected'} {member.ready ? 'ready' : 'not ready'}
          </li>
        ))}
      </ul>
      {opponent && !opponent.connected ? <p role="status">Opponent disconnected. The match is unchanged.</p> : null}
      {room.status === 'cancelled' ? <p role="status">This room was cancelled.</p> : null}
      <button className="online-button" type="button" onClick={() => void run(() => port.setReady(room.id))} disabled={room.status === 'cancelled'}>
        Ready
      </button>
      {room.youAreHost ? (
        <>
          <label className="dictionary-choice">
            Scoring for this match
            <select aria-label="Scoring for this match" value={scoringMode} onChange={(event) => setScoringMode(event.target.value === 'wild' ? 'wild' : 'classic')}>
              <option value="classic">Classic</option>
              <option value="wild">Wild</option>
            </select>
          </label>
          <ScoringBadge mode={scoringMode} />
          <p className="mode-note">This is the mode that starts with the match. Guests cannot change it. {scoringCopy(scoringMode)}</p>
          <button
            className="online-button"
            type="button"
            data-primary="true"
            disabled={room.status !== 'ready'}
            onClick={() => void run(() => port.startMatch(room.id, scoringMode))}
          >
            Start match
          </button>
          <button className="online-button" type="button" onClick={() => void run(() => port.cancelRoom(room.id))} disabled={room.status === 'playing'}>
            Cancel room
          </button>
        </>
      ) : <p className="mode-note">The host chooses Classic or Wild before the match starts. You cannot change the scoring mode.</p>}
    </div>
  );
}

export function OnlineTable({
  room,
  match,
  port,
  link,
  onMatch,
  onRoom,
  onLeave,
}: {
  room: RoomView;
  match: PlayerMatch;
  port: RoomPort;
  link: 'online' | 'offline' | 'connecting';
  onMatch: (match: PlayerMatch) => void;
  onRoom: (room: RoomView) => void;
  onLeave: () => void;
}) {
  const [current, setCurrent] = useState(match);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ tileId: string; row: number; col: number; assignedLetter?: Letter }[]>([]);
  const [pending, setPending] = useState<{ tileId: string; row: number; col: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [effects, setEffects] = useState<ReadonlyMap<string, SquareEffect>>(new Map());
  const fresh = useFreshPlacements(current.version, current.last?.kind === 'play' ? current.last.score : null);

  useEffect(() => {
    const follow = followMatch({
      subscribe: (onNotice) => port.subscribe(current.matchId, onNotice),
      pull: async () => {
        const result = await port.readMatch(current.matchId);
        if (!result.ok) throw new Error(result.message);
        return result.match;
      },
      onSnapshot(snapshot) {
        setCurrent(snapshot);
        setDraft([]);
        setPending(null);
      },
    });
    return () => follow.stop();
  }, [port, current.matchId]);

  useEffect(() => {
    void port.setPresence(room.id, true);
    function onHide() {
      void port.setPresence(room.id, document.visibilityState === 'visible').then((result) => {
        if (result.ok) onRoom(result.room);
      });
    }
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void port.setPresence(room.id, false);
    };
  }, [port, room.id, onRoom]);

  const drafted = new Set(draft.map((placement) => placement.tileId));
  const rackTiles: RackTile[] = current.rack
    .filter((tile) => !drafted.has(tile.id))
    .map((tile) => ({
      id: tile.id,
      letter: tile.letter ?? ' ',
      points: tile.points,
      selected: selected.includes(tile.id),
    }));
  const faces = new Map<string, BoardFace>();
  for (let row = 0; row < current.board.size; row += 1) {
    for (let col = 0; col < current.board.size; col += 1) {
      const cell = readCell(current.board, row, col);
      if (cell.kind !== 'occupied') continue;
      const letter = cell.letter ?? cell.assignedLetter;
      if (!letter) continue;
      faces.set(`${row}-${col}`, {
        letter,
        points: cell.points,
        draft: false,
        upgraded: cell.upgraded === true,
        fresh: fresh.has(`${row}-${col}`),
      });
    }
  }
  for (const placement of draft) {
    const tile = current.rack.find((candidate) => candidate.id === placement.tileId);
    if (!tile) continue;
    const letter = tile.letter ?? placement.assignedLetter;
    if (!letter) continue;
    faces.set(`${placement.row}-${placement.col}`, { letter, points: tile.points, draft: true });
  }
  const opponent = room.members.find((member) => member.seat !== current.yourSeat);
  const finished = current.status === 'finished';

  function place(row: number, col: number) {
    if (pending) return;
    const existing = draft.find((placement) => placement.row === row && placement.col === col);
    if (existing) {
      setDraft(draft.filter((placement) => placement !== existing));
      return;
    }
    if (selected.length !== 1) {
      setNotice(selected.length === 0 ? 'Select a rack tile first.' : 'Select one tile to place.');
      return;
    }
    const tileId = selected[0];
    if (!tileId || draft.some((placement) => placement.tileId === tileId)) return;
    const tile = current.rack.find((candidate) => candidate.id === tileId);
    if (!tile) return;
    if (tile.letter === null) {
      setPending({ tileId, row, col });
      setNotice('Choose a letter for the blank. It still scores 0.');
      return;
    }
    setDraft([...draft, { tileId, row, col }]);
    setSelected([]);
    setNotice('');
  }

  function chooseBlank(letter: Letter) {
    if (!pending) return;
    setDraft([...draft, { ...pending, assignedLetter: letter }]);
    setPending(null);
    setSelected([]);
    setNotice('');
  }

  async function send(command: MatchCommand) {
    const result = await port.act(current.matchId, command, crypto.randomUUID(), current.version);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setCurrent(result.match);
    setDraft([]);
    setSelected([]);
    setNotice(result.match.last?.total != null ? `Total ${result.match.last.total}.` : `${result.match.names[result.match.turn]} to move.`);
  }

  return (
    <div className="board-frame" data-scoring={current.tileUpgrade} style={{ '--board-size': String(current.boardSize) } as CSSProperties}>
      <BoardScroll>
        <div className="board-center">
          <Board
            boardSize={current.boardSize}
            faces={faces}
            bonuses={bonusMarks(current.boardSize, current.bonuses, current.centerWordMultiplier)}
            effects={effects}
            label="Online board"
            onUse={place}
            onRecall={(row, col) => setDraft(draft.filter((placement) => placement.row !== row || placement.col !== col))}
          />
        </div>
      </BoardScroll>
      <section className="match-chrome" aria-label="Online match">
        <p className="match-status">
          <span className="player-turn" data-active={finished || current.turn !== current.yourSeat ? 'false' : 'true'}>
            <ScoringBadge mode={current.tileUpgrade} />
            {' '}
            {finished ? 'Match over' : `${current.names[current.turn]} to move`}
          </span>
          <span>
            <span className="player-turn" data-active={!finished && current.turn === 0 ? 'true' : 'false'}>{current.names[0]} <Count value={current.scores[0]} /></span>
            {' · '}
            <span className="player-turn" data-active={!finished && current.turn === 1 ? 'true' : 'false'}>{current.names[1]} <Count value={current.scores[1]} /></span>
          </span>
          <span>{link === 'offline' ? 'Reconnecting' : link === 'connecting' ? 'Reconnecting' : 'Connected'}</span>
        </p>
        <p className="match-message" aria-live="polite">
          {notice
            || (current.dictionaryAvailable
              ? 'Place tiles, then submit.'
              : 'No dictionary is configured. Words are not checked, and a move cannot be submitted.')}
          {opponent && !opponent.connected ? ' Opponent disconnected. The match is unchanged.' : ''}
        </p>
        <PlayFeedback
          version={current.version}
          score={current.last?.kind === 'play' ? current.last.score : null}
          status={current.status}
          end={current.end}
          names={current.names}
          scores={current.scores}
          turn={current.turn}
          you={current.yourSeat}
          mode={current.tileUpgrade}
          onEffects={setEffects}
        />
        <div className="match-controls">
          <button type="button" className="match-action" data-primary="true" disabled={finished || draft.length === 0 || !current.dictionaryAvailable} onClick={() => void send({ type: 'play', placements: draft })}>
            Submit
          </button>
          <button type="button" className="match-action" disabled={draft.length === 0 && !pending} onClick={() => { setDraft(draft.slice(0, -1)); setPending(null); }}>Undo</button>
          <button type="button" className="match-action" disabled={draft.length === 0 && !pending} onClick={() => { setDraft([]); setPending(null); }}>Clear</button>
          <button type="button" className="match-action" disabled={finished || draft.length > 0 || current.turn !== current.yourSeat} onClick={() => void send({ type: 'pass' })}>Pass</button>
          <button
            type="button"
            className="match-action"
            disabled={finished || draft.length > 0 || !current.exchangeAllowed || selected.length === 0 || current.turn !== current.yourSeat}
            onClick={() => void send({ type: 'exchange', tileIds: selected })}
          >
            Exchange
          </button>
          <button type="button" className="match-action" disabled={finished || draft.length > 0 || current.turn !== current.yourSeat} onClick={() => void send({ type: 'resign' })}>Resign</button>
          <button type="button" className="match-action" onClick={onLeave}>Leave view</button>
        </div>
      </section>
      <Rack
        label={`${current.names[current.yourSeat]} rack, ${rackTiles.length} tiles`}
        tiles={rackTiles}
        onSelect={(id) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])}
      />
      {pending ? <BlankLetterDialog onChoose={chooseBlank} onCancel={() => { setPending(null); setNotice(''); }} /> : null}
    </div>
  );
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
