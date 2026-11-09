import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MatchCommand, MatchNotice, MatchResult } from './session-types';
import type { OnlineConfig } from './config';
import type { AuthPort, RoomPort, SessionUser } from './ports';

export function connectSupabase(config: OnlineConfig): { auth: AuthPort; roomsFor: (user: SessionUser) => RoomPort } {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return {
    auth: supabaseAuth(client),
    roomsFor: (user) => supabaseRooms(client, user),
  };
}

export function supabaseAuth(client: SupabaseClient): AuthPort {
  return {
    configured: true,
    async getSession() {
      return currentUser(client);
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { user: null, error: error.message };
      if (!data.session || !data.user) {
        return { user: null, error: 'Check your email to confirm the account before signing in.' };
      }
      return { user: { id: data.user.id, email: data.user.email ?? email }, error: null };
    },
    async signIn(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) return { user: null, error: error?.message ?? 'Sign in failed.' };
      return { user: { id: data.user.id, email: data.user.email ?? email }, error: null };
    },
    async signOut() {
      await client.auth.signOut();
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const user = session?.user;
        listener(user ? { id: user.id, email: user.email ?? '' } : null);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

export function supabaseRooms(client: SupabaseClient, _user: SessionUser): RoomPort {
  return {
    createRoom: () => invoke(client, { op: 'create-room' }),
    joinRoom: (code) => invoke(client, { op: 'join-room', code }),
    setReady: (roomId) => invoke(client, { op: 'set-ready', roomId }),
    startMatch: (roomId, scoringMode) => invoke(client, {
      op: 'start-match',
      roomId,
      ...(scoringMode ? { scoringMode } : {}),
    }),
    cancelRoom: (roomId) => invoke(client, { op: 'cancel-room', roomId }),
    setPresence: (roomId, connected) => invoke(client, { op: 'presence', roomId, connected }),
    readRoom: (roomId) => invoke(client, { op: 'read-room', roomId }),
    readMatch: (matchId) => invoke<MatchResult>(client, { op: 'read-match', matchId }),
    act: (matchId, command: MatchCommand, idempotencyKey, expectedVersion) =>
      invoke<MatchResult>(client, { op: 'act', matchId, command, idempotencyKey, expectedVersion }),
    subscribe(matchId, onNotice) {
      const channel = client.channel(`match:${matchId}`).on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => {
          const next = payload.new;
          if (!next || typeof next !== 'object' || !('version' in next)) return;
          const version = Number(next.version);
          if (!Number.isInteger(version)) return;
          const notice: MatchNotice = { matchId, version };
          onNotice(notice);
        },
      );
      channel.subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}

async function currentUser(client: SupabaseClient): Promise<SessionUser | null> {
  const auth = client.auth as SupabaseClient['auth'] & {
    getClaims?: () => Promise<{ data: { claims?: { sub?: string; email?: unknown } } | null; error: { message: string } | null }>;
  };
  try {
    if (typeof auth.getClaims === 'function') {
      const { data, error } = await auth.getClaims();
      const sub = data?.claims?.sub;
      if (!error && sub) {
        const email = typeof data?.claims?.email === 'string' ? data.claims.email : '';
        return { id: sub, email };
      }
    }
  } catch {
    return null;
  }
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? '' };
}

async function invoke<T>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('match-action', { body });
  if (error || !data || typeof data !== 'object') {
    return { ok: false, code: 'unavailable', message: 'The match service did not accept the action.' } as T;
  }
  return data as T;
}

export type { OnlineConfig };
