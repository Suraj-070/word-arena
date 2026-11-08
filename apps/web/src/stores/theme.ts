import { create } from 'zustand';

export type ThemeName = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'word-arena-theme';

type ThemeState = {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
};

function readStoredTheme(): ThemeName | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    return null;
  }
  return null;
}

function systemTheme(): ThemeName {
  if (typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Storage can be blocked. The attribute still updates this view. */
  }
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStoredTheme() ?? systemTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const next = get().theme === 'light' ? 'dark' : 'light';
    get().setTheme(next);
  },
}));
