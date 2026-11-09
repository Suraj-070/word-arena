import { EMPTY_STATS, type ProfilePort } from '../profile/types';
import { NOT_CONNECTED, readOnlineConfig } from './config';
import type { AuthPort, RoomPort, SessionUser } from './ports';

export const disconnectedAuth: AuthPort = {
  configured: false,
  getSession: async () => null,
  signIn: async () => ({ user: null, error: NOT_CONNECTED }),
  signUp: async () => ({ user: null, error: NOT_CONNECTED }),
  signOut: async () => undefined,
  onChange: () => () => undefined,
};

export function disconnectedRooms(_user: SessionUser): RoomPort {
  const fail = async () => ({ ok: false as const, code: 'unavailable', message: NOT_CONNECTED });
  return {
    createRoom: fail,
    joinRoom: fail,
    setReady: fail,
    startMatch: fail,
    cancelRoom: fail,
    setPresence: fail,
    readRoom: fail,
    readMatch: fail,
    act: fail,
    subscribe: () => () => undefined,
  };
}

export function disconnectedProfiles(_user: SessionUser): ProfilePort {
  return {
    readProfile: async () => ({ profile: null, error: NOT_CONNECTED }),
    saveProfile: async () => ({ profile: null, error: NOT_CONNECTED }),
    readStats: async () => ({ stats: EMPTY_STATS, error: NOT_CONNECTED }),
    readHistory: async () => ({ history: [], error: NOT_CONNECTED }),
    readLeaderboard: async () => ({ rows: [], error: NOT_CONNECTED }),
  };
}

export type OnlineGate = {
  readonly auth: AuthPort;
  readonly roomsFor: (user: SessionUser) => RoomPort;
  readonly profilesFor: (user: SessionUser) => ProfilePort;
};

export function disconnectedGate(): OnlineGate {
  return { auth: disconnectedAuth, roomsFor: disconnectedRooms, profilesFor: disconnectedProfiles };
}

/** Loads the Supabase client only when a publishable project config is present. */
export async function loadOnlineGate(): Promise<OnlineGate> {
  const config = readOnlineConfig(import.meta.env);
  if (!config) return disconnectedGate();
  const live = await import('./supabase');
  return live.connectSupabase(config);
}
