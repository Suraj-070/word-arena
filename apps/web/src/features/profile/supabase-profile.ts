import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from '../online/ports';
import { EMPTY_STATS, type HistoryEntry, type LeaderRow, type PlayerStats, type ProfileDraft, type ProfilePort, type ProfileRecord } from './types';

type ProfileRow = {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
  theme: string | null;
};

type RecordRow = {
  games: number | string;
  wins: number | string;
  losses: number | string;
  draws: number | string;
  win_rate: number | string | null;
  total_points: number | string;
  average_points: number | string | null;
  highest_score: number | string | null;
  best_match_id: string | null;
  best_score: number | string | null;
  best_opponent_score: number | string | null;
  best_finished_at: string | null;
};

type HistoryRow = {
  match_id: string;
  opponent_id: string;
  score: number | string;
  opponent_score: number | string;
  result: string;
  end_kind: string;
  finished_at: string;
};

type NameRow = {
  id: string;
  username: string;
  display_name: string;
};

type BoardRow = {
  user_id: string;
  username: string;
  display_name: string;
  wins: number | string;
  games: number | string;
  rating: number | string;
  board_rank: number | string;
};

const PROFILE_COLUMNS = 'id, username, display_name, created_at, theme';

export function supabaseProfiles(client: SupabaseClient, user: SessionUser): ProfilePort {
  return {
    async readProfile() {
      const { data, error } = await client.from('profiles').select(PROFILE_COLUMNS).eq('id', user.id).maybeSingle();
      if (error) return { profile: null, error: error.message };
      return { profile: data ? profileFrom(data as ProfileRow) : null, error: null };
    },
    async saveProfile(draft: ProfileDraft) {
      const payload = {
        username: draft.username,
        display_name: draft.displayName.trim(),
        theme: draft.theme,
      };
      const { data, error } = await client
        .from('profiles')
        .update(payload)
        .eq('id', user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      if (error) {
        return { profile: null, error: error.code === '23505' ? 'That username is already taken.' : error.message };
      }
      if (!data) return { profile: null, error: 'No profile yet.' };
      return { profile: profileFrom(data as ProfileRow), error: null };
    },
    async readStats() {
      const { data, error } = await client.rpc('my_record');
      if (error) return { stats: EMPTY_STATS, error: error.message };
      const row = firstRow<RecordRow>(data);
      return { stats: row ? statsFrom(row) : EMPTY_STATS, error: null };
    },
    async readHistory() {
      const { data, error } = await client
        .from('match_results')
        .select('match_id, opponent_id, score, opponent_score, result, end_kind, finished_at')
        .eq('user_id', user.id)
        .order('finished_at', { ascending: false });
      if (error) return { history: [], error: error.message };
      const rows = (data ?? []) as HistoryRow[];
      const names = await opponentNames(client, rows.map((row) => row.opponent_id));
      return {
        history: rows.map((row) => historyFrom(row, names.get(row.opponent_id))),
        error: null,
      };
    },
    async readLeaderboard() {
      const { data, error } = await client.rpc('leaderboard');
      if (error) return { rows: [], error: error.message };
      return { rows: (asRows<BoardRow>(data)).map(leaderFrom), error: null };
    },
  };
}

function profileFrom(row: ProfileRow): ProfileRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    createdAt: asIso(row.created_at),
    theme: row.theme === 'light' || row.theme === 'dark' ? row.theme : null,
  };
}

function statsFrom(row: RecordRow): PlayerStats {
  return {
    games: asCount(row.games),
    wins: asCount(row.wins),
    losses: asCount(row.losses),
    draws: asCount(row.draws),
    winRate: asOptional(row.win_rate),
    totalPoints: asCount(row.total_points),
    averagePoints: asOptional(row.average_points),
    highestScore: asOptional(row.highest_score),
    bestMatchId: row.best_match_id,
    bestScore: asOptional(row.best_score),
    bestOpponentScore: asOptional(row.best_opponent_score),
    bestFinishedAt: row.best_finished_at ? asIso(row.best_finished_at) : null,
  };
}

function historyFrom(row: HistoryRow, opponent: NameRow | undefined): HistoryEntry {
  const result = row.result === 'win' || row.result === 'loss' || row.result === 'draw' ? row.result : 'draw';
  return {
    matchId: row.match_id,
    opponentName: opponent?.display_name ?? 'Player',
    opponentUsername: opponent?.username ?? '',
    score: asCount(row.score),
    opponentScore: asCount(row.opponent_score),
    result,
    endKind: row.end_kind,
    finishedAt: asIso(row.finished_at),
  };
}

function leaderFrom(row: BoardRow): LeaderRow {
  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    wins: asCount(row.wins),
    games: asCount(row.games),
    rating: asCount(row.rating),
    rank: asCount(row.board_rank),
  };
}

async function opponentNames(client: SupabaseClient, ids: readonly string[]): Promise<Map<string, NameRow>> {
  const unique = [...new Set(ids)];
  const names = new Map<string, NameRow>();
  if (unique.length === 0) return names;
  const { data } = await client.from('profiles').select('id, username, display_name').in('id', unique);
  for (const row of (data ?? []) as NameRow[]) names.set(row.id, row);
  return names;
}

function asRows<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') return [data as T];
  return [];
}

function firstRow<T>(data: unknown): T | null {
  return asRows<T>(data)[0] ?? null;
}

function asCount(value: number | string | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function asOptional(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
