import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { DragonMemorizePage } from './DragonMemorizePage';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../hooks/usePlaytimeHeartbeat', () => ({ usePlaytimeHeartbeat: vi.fn() }));
vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

describe('DragonMemorizePage', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn();
    api.get.mockResolvedValue({ passages: [{
      id: 7,
      title: 'A cheerful heart',
      category: 'verse',
      body: 'A cheerful heart is good medicine.',
      mastery_level: 0,
    }] });
    api.post.mockResolvedValue({ passage: { mastery_level: 3 } });
  });

  it('reveals each hard-mode word when its first letter is pressed', async () => {
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /A cheerful heart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    for (const key of ['a', 'c', 'h', 'i', 'g', 'm']) fireEvent.keyDown(window, { key });
    expect(screen.getByText('🌿 Sentence remembered!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    await screen.findByText('Passage remembered!');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/memory-passages/7/progress',
      { difficulty: 'hard' },
    ));
  });

  it('does not advance hard mode for the wrong first letter', async () => {
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /A cheerful heart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'z' });
    expect(screen.getByText('Try the first letter of the next word.')).toBeInTheDocument();
    expect(screen.queryByText('🌿 Sentence remembered!')).not.toBeInTheDocument();
  });
});
