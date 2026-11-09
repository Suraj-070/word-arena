import { useEffect, useRef } from 'react';
import { isLetter, LETTERS, type Letter } from '@word-arena/engine';

type Props = {
  onChoose: (letter: Letter) => void;
  onCancel: () => void;
};

export function BlankLetterDialog({ onChoose, onCancel }: Props) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.querySelector('button')?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === 'Tab') {
        const buttons = dialog.current ? [...dialog.current.querySelectorAll<HTMLButtonElement>('button')] : [];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      const letter = event.key.toUpperCase();
      if (event.key.length === 1 && isLetter(letter)) {
        event.preventDefault();
        onChoose(letter);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, onChoose]);

  return (
    <div ref={dialog} className="blank-dialog" role="dialog" aria-modal="true" aria-label="Choose a letter for the blank">
      <p>Choose a letter. The blank still scores 0.</p>
      <div className="blank-letters">
        {LETTERS.split('').map((letter) => (
          <button
            key={letter}
            type="button"
            className="match-action"
            onClick={() => {
              if (isLetter(letter)) onChoose(letter);
            }}
          >
            {letter}
          </button>
        ))}
      </div>
      <button type="button" className="match-action" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
