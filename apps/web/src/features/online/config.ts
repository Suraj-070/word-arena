export type OnlineConfig = {
  readonly url: string;
  readonly publishableKey: string;
};

const SECRET_MARKERS = ['service_role', 'sb_secret_'];

/** Reads the publishable browser key. A secret key is refused even if it was placed in a Vite variable. */
export function readOnlineConfig(env: Record<string, string | boolean | undefined>): OnlineConfig | null {
  const url = env.VITE_SUPABASE_URL;
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (typeof url !== 'string' || typeof publishableKey !== 'string') return null;
  const trimmedUrl = url.trim();
  const trimmedKey = publishableKey.trim();
  if (!trimmedUrl.startsWith('https://') || trimmedKey.length < 20) return null;
  if (SECRET_MARKERS.some((marker) => trimmedKey.includes(marker))) return null;
  return { url: trimmedUrl, publishableKey: trimmedKey };
}

export const NOT_CONNECTED = 'Online play is not connected to a Supabase project.';
