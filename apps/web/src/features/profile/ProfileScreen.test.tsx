import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthPort, SessionUser } from '../online/ports';
import { useThemeStore } from '../../stores/theme';
import { ProfileScreen } from './ProfileScreen';
import { supabaseProfiles } from './supabase-profile';
import { EMPTY_STATS, type ProfilePort, type ProfileRecord } from './types';

const profile: ProfileRecord = {
  id: 'user-1',
  username: 'ada',
  displayName: 'Ada Lovelace',
  createdAt: '2026-03-01T00:00:00.000Z',
  theme: 'light',
};

function auth(user: SessionUser | null): AuthPort {
  return {
    configured: true,
    getSession: async () => user,
    signIn: async () => ({ user, error: null }),
    signUp: async () => ({ user, error: null }),
    signOut: async () => undefined,
    onChange: () => () => undefined,
  };
}

describe('profile screen', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: 'light' });
    document.documentElement.dataset.theme = 'light';
  });

  it('asks a signed-out player to sign in', async () => {
    render(<ProfileScreen auth={auth(null)} profilesFor={() => { throw new Error('no port'); }} />);
    expect(await screen.findByText(/Sign in from Online/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
  });

  it('shows a loading leaderboard, then the empty state', async () => {
    const user = userEvent.setup();
    let release: (value: { rows: []; error: null }) => void = () => undefined;
    const pending = new Promise<{ rows: []; error: null }>((resolve) => {
      release = resolve;
    });
    const port: ProfilePort = {
      readProfile: async () => ({ profile, error: null }),
      saveProfile: async () => ({ profile, error: null }),
      readStats: async () => ({ stats: EMPTY_STATS, error: null }),
      readHistory: async () => ({ history: [], error: null }),
      readLeaderboard: () => pending,
    };
    render(<ProfileScreen auth={auth({ id: 'user-1', email: 'ada@example.com' })} profilesFor={() => port} />);
    await user.click(await screen.findByRole('tab', { name: 'Leaderboard' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading ranks.');
    release({ rows: [], error: null });
    expect(await screen.findByText(/No ranked players yet/)).toBeInTheDocument();
  });

  it('saves only the name fields and theme, and lists a completed match', async () => {
    const user = userEvent.setup();
    const saveProfile = vi.fn(async (draft: { username: string; displayName: string; theme: 'light' | 'dark' }) => ({
      profile: { ...profile, username: draft.username, displayName: draft.displayName, theme: draft.theme },
      error: null,
    }));
    const port: ProfilePort = {
      readProfile: async () => ({ profile, error: null }),
      saveProfile,
      readStats: async () => ({
        stats: {
          ...EMPTY_STATS,
          games: 1,
          wins: 1,
          winRate: 100,
          totalPoints: 12,
          averagePoints: 12,
          highestScore: 12,
          bestScore: 12,
          bestOpponentScore: 4,
          bestFinishedAt: '2026-11-01T00:00:00.000Z',
        },
        error: null,
      }),
      readHistory: async () => ({
        history: [{
          matchId: 'match-1',
          opponentName: 'Bea',
          opponentUsername: 'bea',
          score: 12,
          opponentScore: 4,
          result: 'win',
          endKind: 'resign',
          finishedAt: '2026-11-01T00:00:00.000Z',
        }],
        error: null,
      }),
      readLeaderboard: async () => ({
        rows: [{ userId: 'user-1', username: 'ada', displayName: 'Ada Lovelace', wins: 1, games: 1, rating: 1025, rank: 1 }],
        error: null,
      }),
    };
    render(<ProfileScreen auth={auth({ id: 'user-1', email: 'ada@example.com' })} profilesFor={() => port} />);
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getAllByText('AL', { selector: '.avatar' }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Win against Bea/)).toBeInTheDocument();
    expect(screen.getByText('Best game: 12 to 4, Nov 1, 2026.')).toBeInTheDocument();
    expect(screen.getAllByText(/12 to 4/).length).toBeGreaterThan(0);
    await user.click(screen.getByText('Details'));
    expect(screen.getByText('Resignation')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Username'));
    await user.type(screen.getByLabelText('Username'), 'Ada_Player');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(saveProfile).toHaveBeenCalledWith({ username: 'ada_player', displayName: 'Ada Lovelace', theme: 'light' });
    expect(Object.keys(saveProfile.mock.calls[0]?.[0] ?? {}).sort()).toEqual(['displayName', 'theme', 'username']);
    await user.click(screen.getByRole('tab', { name: 'Leaderboard' }));
    expect(screen.getByText('Rating 1025')).toBeInTheDocument();
    expect(screen.getByText('@ada')).toBeInTheDocument();
  });
});

describe('supabase profile writes', () => {
  it('updates the profile columns and does not send a score', async () => {
    const capture: { payload?: Record<string, unknown>; rpc?: string } = {};
    const client = {
      from(table: string) {
        return {
          update(payload: Record<string, unknown>) {
            capture.payload = { table, ...payload };
            return {
              eq() {
                return {
                  select() {
                    return {
                      maybeSingle: async () => ({
                        data: {
                          id: 'user-1',
                          username: 'ada',
                          display_name: 'Ada',
                          created_at: '2026-03-01T00:00:00.000Z',
                          theme: 'dark',
                        },
                        error: null,
                      }),
                    };
                  },
                };
              },
            };
          },
        };
      },
      rpc(name: string) {
        capture.rpc = name;
        return Promise.resolve({ data: [], error: null });
      },
    } as unknown as SupabaseClient;
    const port = supabaseProfiles(client, { id: 'user-1', email: 'ada@example.com' });
    const saved = await port.saveProfile({ username: 'ada', displayName: 'Ada', theme: 'dark' });
    expect(saved.profile?.username).toBe('ada');
    expect(capture.payload).toEqual({ table: 'profiles', username: 'ada', display_name: 'Ada', theme: 'dark' });
    expect(capture.payload).not.toHaveProperty('score');
    expect(capture.payload).not.toHaveProperty('wins');
    await port.readLeaderboard();
    expect(capture.rpc).toBe('leaderboard');
  });
});
