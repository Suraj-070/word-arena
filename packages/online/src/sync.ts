import type { MatchNotice } from './types';

export { standings } from './results';
export type { ResultKind, SeatResult } from './results';

export type Snapshot = { readonly version: number };

/** A realtime payload is a notice. The same or an older version is ignored. Anything newer asks for a fresh server read. */
export function noteNotice(currentVersion: number, notice: MatchNotice): 'ignore' | 'resync' {
  if (notice.version <= currentVersion) return 'ignore';
  return 'resync';
}

/** Keeps the newer authorised snapshot when a slow response arrives after a newer one. */
export function acceptSnapshot<T extends Snapshot>(current: T | null, next: T): T {
  if (!current || next.version >= current.version) return next;
  return current;
}

export function followMatch<T extends Snapshot>(input: {
  readonly subscribe: (onNotice: (notice: MatchNotice) => void) => () => void;
  readonly pull: () => Promise<T>;
  readonly onSnapshot: (snapshot: T) => void;
}): { readonly stop: () => void } {
  let stopped = false;
  let current: T | null = null;
  let pulling = false;
  let again = false;
  const unsubscribe = input.subscribe((notice) => {
    if (stopped) return;
    if (noteNotice(current?.version ?? 0, notice) === 'ignore') return;
    void pull();
  });

  async function pull(): Promise<void> {
    if (stopped) return;
    if (pulling) {
      again = true;
      return;
    }
    pulling = true;
    try {
      const next = await input.pull();
      if (stopped) return;
      current = acceptSnapshot(current, next);
      input.onSnapshot(current);
    } finally {
      pulling = false;
      if (again && !stopped) {
        again = false;
        await pull();
      }
    }
  }

  void pull();
  return {
    stop() {
      stopped = true;
      unsubscribe();
    },
  };
}
