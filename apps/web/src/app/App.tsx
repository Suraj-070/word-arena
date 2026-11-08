import { useLayoutEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Table } from '../features/match/Table';
import { useThemeStore } from '../stores/theme';
import { useReducedMotionAttribute } from './use-reduced-motion';

export function App() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const [announcement, setAnnouncement] = useState('');
  useReducedMotionAttribute();

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function onToggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    toggleTheme();
    setAnnouncement(next === 'dark' ? 'Dark theme' : 'Light theme');
  }

  const themeLabel = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';

  return (
    <div className="app bg-paper font-sans text-ink">
      <a className="skip-link" href="#board">
        Skip to board
      </a>
      <header className="header border-b border-line bg-paper text-ink">
        <h1 className="wordmark font-display">Word Arena</h1>
        <nav className="nav" aria-label="Primary">
          <a
            className="nav-link text-muted aria-[current=page]:text-ink"
            href="#board"
            aria-current="page"
          >
            Board
          </a>
        </nav>
        <div className="header-tools">
          <Button className="icon-button" aria-label={themeLabel} onClick={onToggleTheme}>
            {theme === 'dark' ? (
              <Sun aria-hidden="true" size={20} strokeWidth={1.75} />
            ) : (
              <Moon aria-hidden="true" size={20} strokeWidth={1.75} />
            )}
          </Button>
        </div>
      </header>
      <main id="board" className="table bg-felt" tabIndex={-1} aria-label="Board">
        <h2 className="sr-only">Local match</h2>
        <Table />
      </main>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
