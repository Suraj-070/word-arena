export function avatarInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  const second = parts[1];
  if (!first) return '?';
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

export function validUsername(value: string): boolean {
  return /^[a-z0-9_]{3,16}$/.test(value);
}

export function validDisplayName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.length <= 24;
}

export function endKindLabel(kind: string): string {
  if (kind === 'going-out') return 'Tiles cleared';
  if (kind === 'passes') return 'Consecutive passes';
  if (kind === 'resign') return 'Resignation';
  return 'Match ended';
}

export function resultLabel(result: 'win' | 'loss' | 'draw'): string {
  if (result === 'win') return 'Win';
  if (result === 'loss') return 'Loss';
  return 'Draw';
}

export function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatRate(value: number | null): string {
  if (value === null) return '—';
  return `${value}%`;
}

export function formatPoints(value: number | null): string {
  if (value === null) return '—';
  return String(value);
}
