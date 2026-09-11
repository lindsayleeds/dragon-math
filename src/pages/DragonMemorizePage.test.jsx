import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    vi.clearAllMocks();
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
      { difficulty: 'hard', body: 'A cheerful heart is good medicine.' },
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

  it('preserves punctuation and separators in easy practice', async () => {
    api.get.mockResolvedValue({ passages: [{
      id: 8,
      title: 'A question',
      category: 'quote',
      body: '...To be, or not to be—that is the question!’',
      mastery_level: 0,
    }] });
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /A question/ }));
    fireEvent.click(screen.getByRole('button', { name: /Easy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    expect(screen.getByLabelText('Sentence with missing words')).toHaveTextContent('...To __, or not to __—that is the ________!’');
  });

  it('keeps a completed passage ready to retry when progress saving fails', async () => {
    api.get.mockResolvedValue({ passages: [{
      id: 9,
      title: 'Keep going',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
    }] });
    api.post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ passage: { mastery_level: 3 } });
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Keep going/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByText("We couldn't save your progress yet. Check your connection, then try again.")).toBeInTheDocument();
    expect(screen.queryByText('Passage remembered!')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByText('Passage remembered!')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('does not navigate when a pending progress save resolves after leaving practice', async () => {
    let resolveSave;
    api.get.mockResolvedValue({ passages: [{
      id: 10,
      title: 'Wait well',
      category: 'quote',
      body: 'Wait.',
      mastery_level: 0,
    }] });
    api.post.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Wait well/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'w' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    await act(async () => { resolveSave({ passage: { mastery_level: 3 } }); });
    expect(screen.getByText('Study first')).toBeInTheDocument();
    expect(screen.queryByText('Passage remembered!')).not.toBeInTheDocument();
  });
});
