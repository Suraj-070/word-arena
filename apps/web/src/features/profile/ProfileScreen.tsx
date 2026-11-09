import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AuthPort, SessionUser } from '../online/ports';
import { useThemeStore } from '../../stores/theme';
import { avatarInitials, endKindLabel, formatPoints, formatRate, formatWhen, resultLabel, validDisplayName, validUsername } from './format';
import { EMPTY_STATS, type HistoryEntry, type LeaderRow, type PlayerStats, type ProfilePort, type ProfileRecord } from './types';

type Props = {
  auth: AuthPort;
  profilesFor: (user: SessionUser) => ProfilePort;
};

type Panel = 'record' | 'ranks';

export function ProfileScreen({ auth, profilesFor }: Props) {
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
      <div className="profile-wrap">
        <p className="profile-card" role="status">Checking your session.</p>
      </div>
    );
  }
  if (!user) return <SignedOut />;
  return <SignedIn user={user} port={profilesFor(user)} />;
}

function SignedOut() {
  return (
    <div className="profile-wrap">
      <section className="profile-card" aria-label="Profile">
        <h2 className="profile-title">Profile</h2>
        <p className="profile-copy">Sign in from Online to keep a profile. Finished matches are recorded by the server.</p>
      </section>
    </div>
  );
}

function SignedIn({ user, port }: { user: SessionUser; port: ProfilePort }) {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [panel, setPanel] = useState<Panel>('record');
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [stats, setStats] = useState<PlayerStats>(EMPTY_STATS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [ranksLoading, setRanksLoading] = useState(true);
  const [error, setError] = useState('');
  const [ranksError, setRanksError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const portRef = useRef(port);
  portRef.current = port;

  useEffect(() => {
    let live = true;
    const current = portRef.current;
    setLoading(true);
    setRanksLoading(true);
    void Promise.all([current.readProfile(), current.readStats(), current.readHistory(), current.readLeaderboard()]).then(([nextProfile, nextStats, nextHistory, nextBoard]) => {
      if (!live) return;
      if (nextProfile.profile) {
        setProfile(nextProfile.profile);
        setUsername(nextProfile.profile.username);
        setDisplayName(nextProfile.profile.displayName);
        if (nextProfile.profile.theme) setTheme(nextProfile.profile.theme);
      }
      setStats(nextStats.stats);
      setHistory(nextHistory.history);
      setRows(nextBoard.rows);
      setError(nextProfile.error ?? nextStats.error ?? nextHistory.error ?? '');
      setRanksError(nextBoard.error ?? '');
      setLoading(false);
      setRanksLoading(false);
    });
    return () => {
      live = false;
    };
  }, [user.id, setTheme]);

  async function onSave(event: FormEvent) {
    event.preventDefault();
    const nextUsername = username.trim().toLowerCase();
    const nextName = displayName.trim();
    if (!validUsername(nextUsername)) {
      setError('Use 3 to 16 letters, numbers, or underscores.');
      return;
    }
    if (!validDisplayName(nextName)) {
      setError('Use a display name of 2 to 24 characters.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    const saved = await port.saveProfile({ username: nextUsername, displayName: nextName, theme });
    setBusy(false);
    if (saved.error || !saved.profile) {
      setError(saved.error ?? 'The profile could not be saved.');
      return;
    }
    setProfile(saved.profile);
    setUsername(saved.profile.username);
    setDisplayName(saved.profile.displayName);
    setNotice('Profile saved.');
  }

  const shownName = displayName.trim() || profile?.displayName || 'Player';

  return (
    <div className="profile-wrap">
      <section className="profile-card" aria-label="Profile">
        <div className="profile-heading">
          <span className="avatar" aria-hidden="true">{avatarInitials(shownName)}</span>
          <div>
            <h2 className="profile-title">{shownName}</h2>
            <p className="profile-copy">{user.email}</p>
          </div>
        </div>
        <div className="profile-tabs" role="tablist" aria-label="Profile sections">
          <button
            className="profile-tab"
            type="button"
            role="tab"
            id="tab-record"
            aria-selected={panel === 'record'}
            aria-controls="panel-record"
            onClick={() => setPanel('record')}
          >
            Your record
          </button>
          <button
            className="profile-tab"
            type="button"
            role="tab"
            id="tab-ranks"
            aria-selected={panel === 'ranks'}
            aria-controls="panel-ranks"
            onClick={() => setPanel('ranks')}
          >
            Leaderboard
          </button>
        </div>

        <div role="tabpanel" id="panel-record" aria-labelledby="tab-record" hidden={panel !== 'record'}>
          {loading ? <p role="status">Loading your profile.</p> : null}
          <form className="profile-form" onSubmit={onSave}>
            <label className="profile-field">
              Username
              <input
                name="username"
                autoComplete="username"
                value={username}
                spellCheck={false}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <p className="profile-hint">3 to 16 letters, numbers, or underscores. This is the public handle.</p>
            <label className="profile-field">
              Display name
              <input
                name="display-name"
                autoComplete="nickname"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <p className="profile-hint">2 to 24 characters. This is the name players see.</p>
            <fieldset className="profile-theme">
              <legend>Theme</legend>
              <label>
                <input type="radio" name="theme" checked={theme === 'light'} onChange={() => setTheme('light')} />
                Light
              </label>
              <label>
                <input type="radio" name="theme" checked={theme === 'dark'} onChange={() => setTheme('dark')} />
                Dark
              </label>
            </fieldset>
            <p className="profile-copy">
              Member since <time dateTime={profile?.createdAt ?? ''}>{profile ? formatWhen(profile.createdAt) : '—'}</time>
            </p>
            {error ? <p className="profile-error" role="alert">{error}</p> : null}
            {notice ? <p className="profile-notice" role="status">{notice}</p> : null}
            <button className="profile-button" type="submit" data-primary="true" disabled={busy || loading} aria-busy={busy}>
              Save profile
            </button>
          </form>

          <h3 className="profile-section">Statistics</h3>
          <p className="profile-hint">These numbers come from finished online matches. The server writes them.</p>
          <dl className="stat-list">
            <div><dt>Games</dt><dd>{stats.games}</dd></div>
            <div><dt>Wins</dt><dd>{stats.wins}</dd></div>
            <div><dt>Losses</dt><dd>{stats.losses}</dd></div>
            <div><dt>Draws</dt><dd>{stats.draws}</dd></div>
            <div><dt>Win rate</dt><dd>{formatRate(stats.winRate)}</dd></div>
            <div><dt>Total points</dt><dd>{stats.totalPoints}</dd></div>
            <div><dt>Average</dt><dd>{formatPoints(stats.averagePoints)}</dd></div>
            <div><dt>Highest</dt><dd>{formatPoints(stats.highestScore)}</dd></div>
          </dl>
          <p className="profile-copy">
            {stats.bestScore === null
              ? 'Best game: no finished match yet.'
              : `Best game: ${stats.bestScore} to ${stats.bestOpponentScore ?? 0}${stats.bestFinishedAt ? `, ${formatWhen(stats.bestFinishedAt)}` : ''}.`}
          </p>

          <h3 className="profile-section">Match history</h3>
          {history.length === 0 ? <p className="profile-copy">No completed matches yet.</p> : (
            <ol className="history-list">
              {history.map((entry) => (
                <li key={entry.matchId}>
                  <p className="history-result">
                    {resultLabel(entry.result)} against {entry.opponentName}
                    {entry.opponentUsername ? <span className="profile-hint"> @{entry.opponentUsername}</span> : null}
                  </p>
                  <p className="profile-copy">{entry.score} to {entry.opponentScore}</p>
                  <time dateTime={entry.finishedAt}>{formatWhen(entry.finishedAt)}</time>
                  <details>
                    <summary>Details</summary>
                    <p className="profile-copy">{endKindLabel(entry.endKind)}</p>
                  </details>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div role="tabpanel" id="panel-ranks" aria-labelledby="tab-ranks" hidden={panel !== 'ranks'}>
          <Leaderboard rows={rows} loading={ranksLoading} error={ranksError} currentId={user.id} />
        </div>
      </section>
    </div>
  );
}

function Leaderboard({ rows, loading, error, currentId }: { rows: readonly LeaderRow[]; loading: boolean; error: string; currentId: string }) {
  if (loading) return <p role="status">Loading ranks.</p>;
  if (error) return <p className="profile-error" role="alert">{error}</p>;
  if (rows.length === 0) return <p className="profile-copy">No ranked players yet. A rank appears after the server records a finished match.</p>;
  return (
    <ol className="rank-list">
      {rows.map((row) => (
        <li key={row.userId} data-current={row.userId === currentId ? 'true' : undefined}>
          <span className="rank-place">{row.rank}</span>
          <span className="avatar" aria-hidden="true">{avatarInitials(row.displayName)}</span>
          <span className="rank-who">
            <span className="rank-name">{row.displayName}</span>
            <span className="profile-hint">@{row.username}</span>
          </span>
          <span className="rank-stat">{row.wins} {row.wins === 1 ? 'win' : 'wins'}</span>
          <span className="rank-stat">Rating {row.rating}</span>
        </li>
      ))}
    </ol>
  );
}
