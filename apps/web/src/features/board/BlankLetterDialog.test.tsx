import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BlankLetterDialog } from './BlankLetterDialog';

describe('blank letter dialog', () => {
  it('focuses the first letter, accepts a typed letter, and cancels with Escape', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<BlankLetterDialog onChoose={onChoose} onCancel={onCancel} />);
    expect(document.activeElement).toHaveTextContent('A');
    await user.keyboard('m');
    expect(onChoose).toHaveBeenCalledWith('M');
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});