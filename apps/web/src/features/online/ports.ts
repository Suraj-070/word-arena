import type { MatchCommand, MatchNotice, MatchResult, RoomResult } from './session-types';

export type SessionUser = {
  readonly id: string;
  readonly email: string;
};

export type AuthPort = {
  readonly configured: boolean;
  getSession: () => Promise<SessionUser | null>;
  signUp: (email: string, password: string) => Promise<{ user: SessionUser | null; error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ user: SessionUser | null; error: string | null }>;
  signOut: () => Promise<void>;
  onChange: (listener: (user: SessionUser | null) => void) => () => void;
};

export type RoomPort = {
  createRoom: () => Promise<RoomResult>;
  joinRoom: (code: string) => Promise<RoomResult>;
  setReady: (roomId: string) => Promise<RoomResult>;
  startMatch: (roomId: string) => Promise<RoomResult>;
  cancelRoom: (roomId: string) => Promise<RoomResult>;
  setPresence: (roomId: string, connected: boolean) => Promise<RoomResult>;
  readRoom: (roomId: string) => Promise<RoomResult>;
  readMatch: (matchId: string) => Promise<MatchResult>;
  act: (matchId: string, command: MatchCommand, idempotencyKey: string, expectedVersion: number) => Promise<MatchResult>;
  subscribe: (matchId: string, onNotice: (notice: MatchNotice) => void) => () => void;
};
