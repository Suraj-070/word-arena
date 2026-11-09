import type { ThemeName } from '../../stores/theme';

export type ProfileRecord = {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly theme: ThemeName | null;
};

export type ProfileDraft = {
  readonly username: string;
  readonly displayName: string;
  readonly theme: ThemeName;
};

export type PlayerStats = {
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly winRate: number | null;
  readonly totalPoints: number;
  readonly averagePoints: number | null;
  readonly highestScore: number | null;
  readonly bestMatchId: string | null;
  readonly bestScore: number | null;
  readonly bestOpponentScore: number | null;
  readonly bestFinishedAt: string | null;
};

export type HistoryEntry = {
  readonly matchId: string;
  readonly opponentName: string;
  readonly opponentUsername: string;
  readonly score: number;
  readonly opponentScore: number;
  readonly result: 'win' | 'loss' | 'draw';
  readonly endKind: string;
  readonly finishedAt: string;
};

export type LeaderRow = {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly wins: number;
  readonly games: number;
  readonly rating: number;
  readonly rank: number;
};

export type ProfilePort = {
  readProfile: () => Promise<{ profile: ProfileRecord | null; error: string | null }>;
  saveProfile: (draft: ProfileDraft) => Promise<{ profile: ProfileRecord | null; error: string | null }>;
  readStats: () => Promise<{ stats: PlayerStats; error: string | null }>;
  readHistory: () => Promise<{ history: HistoryEntry[]; error: string | null }>;
  readLeaderboard: () => Promise<{ rows: LeaderRow[]; error: string | null }>;
};

export const EMPTY_STATS: PlayerStats = {
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  winRate: null,
  totalPoints: 0,
  averagePoints: null,
  highestScore: null,
  bestMatchId: null,
  bestScore: null,
  bestOpponentScore: null,
  bestFinishedAt: null,
};
