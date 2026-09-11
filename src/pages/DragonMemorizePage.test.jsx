import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
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
      updated_at: '2026-09-10T12:00:00.000Z',
    }] });
    api.post.mockResolvedValue({ passage: { mastery_level: 3 } });
  });

  it('reveals each hard-mode word when its first letter is pressed', async () => {
    render(<StrictMode><MemoryRouter><DragonMemorizePage /></MemoryRouter></StrictMode>);
    fireEvent.click(await screen.findByRole('button', { name: /A cheerful heart/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    for (const key of ['a', 'c', 'h', 'i', 'g', 'm']) fireEvent.keyDown(window, { key });
    expect(screen.getByText('🌿 Sentence remembered!')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    await screen.findByText('Passage remembered!');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/memory-passages/7/progress',
      {
        difficulty: 'hard',
        body: 'A cheerful heart is good medicine.',
        updated_at: '2026-09-10T12:00:00.000Z',
      },
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
      updated_at: '2026-09-10T12:00:00.000Z',
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
      updated_at: '2026-09-10T12:00:00.000Z',
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

  it('uses the server-authoritative highest mastery after completion', async () => {
    api.get.mockResolvedValue({ passages: [{
      id: 12,
      title: 'Shared progress',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    }] });
    api.post.mockResolvedValue({ passage: {
      id: 12,
      title: 'Shared progress',
      category: 'quote',
      body: 'Go.',
      mastery_level: 3,
      updated_at: '2026-09-10T12:00:00.000Z',
    } });
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Shared progress/ }));
    fireEvent.click(screen.getByRole('button', { name: /Easy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    await screen.findByText('Passage remembered!');
    fireEvent.click(screen.getByRole('button', { name: 'My passages' }));
    expect(screen.getByRole('button', { name: /Hard complete/ })).toBeInTheDocument();
  });

  it('updates mastery without navigating when a pending save resolves after leaving practice', async () => {
    let resolveSave;
    api.get.mockResolvedValue({ passages: [{
      id: 10,
      title: 'Wait well',
      category: 'quote',
      body: 'Wait.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
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
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    expect(screen.getByRole('button', { name: /Hard complete/ })).toBeInTheDocument();
  });

  it('keeps the highest mastery when overlapping saves resolve out of order', async () => {
    let resolveEasy;
    let resolveHard;
    api.get.mockResolvedValue({ passages: [{
      id: 15,
      title: 'Steady progress',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    }] });
    api.post
      .mockReturnValueOnce(new Promise(resolve => { resolveEasy = resolve; }))
      .mockReturnValueOnce(new Promise(resolve => { resolveHard = resolve; }));
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Steady progress/ }));
    fireEvent.click(screen.getByRole('button', { name: /Easy/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    await act(async () => {
      resolveHard({ passage: {
        mastery_level: 3,
        last_practiced_at: '2026-09-10T12:02:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      } });
    });
    await screen.findByText('Passage remembered!');
    await act(async () => {
      resolveEasy({ passage: {
        mastery_level: 1,
        last_practiced_at: '2026-09-10T12:01:00.000Z',
        updated_at: '2026-09-10T12:00:00.000Z',
      } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'My passages' }));
    expect(screen.getByRole('button', { name: /Hard complete/ })).toBeInTheDocument();
  });

  it('refreshes the passage list after a stale completion conflict', async () => {
    const original = {
      id: 11,
      title: 'Changing words',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    };
    const refreshed = {
      ...original,
      body: 'Go gladly.',
      updated_at: '2026-09-10T12:01:00.000Z',
    };
    api.get.mockResolvedValueOnce({ passages: [original] }).mockResolvedValueOnce({ passages: [refreshed] });
    const staleError = Object.assign(new Error('changed'), { code: 'passage_changed' });
    api.post.mockRejectedValue(staleError);
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Changing words/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByText('This passage changed while you practiced. Return to My passages to open the latest version.')).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    expect(screen.getByText('Go gladly.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.queryByText('🌿 Sentence remembered!')).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'g' });
    expect(screen.getByText('🌿 Sentence remembered!')).toBeInTheDocument();
  });

  it('refreshes away a passage deleted during practice', async () => {
    const deleted = {
      id: 13,
      title: 'Short-lived passage',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    };
    api.get.mockResolvedValueOnce({ passages: [deleted] }).mockResolvedValueOnce({ passages: [] });
    api.post.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Short-lived passage/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByText('Your passage book is ready')).toBeInTheDocument();
    expect(screen.queryByText('Short-lived passage')).not.toBeInTheDocument();
  });

  it('quarantines a stale passage and offers refresh retry after a failed reload', async () => {
    const stale = {
      id: 14,
      title: 'Needs refreshing',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    };
    api.get
      .mockResolvedValueOnce({ passages: [stale] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ passages: [] });
    api.post.mockRejectedValue(Object.assign(new Error('changed'), { code: 'passage_changed' }));
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Needs refreshing/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByRole('button', { name: 'Retry refresh' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(await screen.findByText('Your passage book is ready')).toBeInTheDocument();
    expect(screen.queryByText('Needs refreshing')).not.toBeInTheDocument();
  });

  it('does not reopen stale wording after its refresh fails', async () => {
    const stale = {
      id: 16,
      title: 'Old wording',
      category: 'quote',
      body: 'Go.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    };
    api.get.mockResolvedValueOnce({ passages: [stale] }).mockRejectedValueOnce(new Error('offline'));
    api.post.mockRejectedValue(Object.assign(new Error('changed'), { code: 'passage_changed' }));
    render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Old wording/ }));
    fireEvent.click(screen.getByRole('button', { name: /Hard/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide the words' }));
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.click(screen.getByRole('button', { name: 'Finish passage' }));
    expect(await screen.findByRole('button', { name: 'Retry refresh' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '← back' }));
    expect(screen.getByText('Your passage book is ready')).toBeInTheDocument();
    expect(screen.queryByText('Study first')).not.toBeInTheDocument();
  });
});
