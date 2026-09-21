import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { usePhonicsProgress } from './usePhonicsProgress';

vi.mock('../api', () => ({
  api: {
    get: vi.fn(() => Promise.resolve({ elements: {} })),
    post: vi.fn(),
  },
}));

const attempts = (count, start = 0) => Array.from({ length: count }, (_, i) => ({
  element_key: `sound-${start + i}`,
  mode: 'choose',
  correct: true,
}));

beforeEach(() => {
  api.get.mockResolvedValue({ elements: {} });
  api.post.mockReset();
});

describe('usePhonicsProgress saves', () => {
  it('retries queued attempts in server-sized batches', async () => {
    const { result } = renderHook(() => usePhonicsProgress());
    api.post.mockRejectedValue(new Error('offline'));

    for (let round = 0; round < 6; round += 1) {
      await act(async () => { await result.current.save(attempts(10, round * 10)); });
    }

    api.post.mockResolvedValue({ saved: 60 });
    await act(async () => { await result.current.save(attempts(10, 60)); });

    const sizes = api.post.mock.calls.map(([, body]) => body.attempts.length);
    expect(Math.max(...sizes)).toBe(60);
    expect(sizes.slice(-2)).toEqual([60, 10]);
  });

  it('serializes overlapping saves without discarding the later round', async () => {
    let resolveFirst;
    api.post
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ saved: 1 });
    const { result } = renderHook(() => usePhonicsProgress());

    let first;
    let second;
    act(() => {
      first = result.current.save(attempts(1, 1));
      second = result.current.save(attempts(1, 2));
    });
    expect(api.post).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ saved: 1 });
      await Promise.all([first, second]);
    });

    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1].attempts[0].element_key).toBe('sound-2');
  });
});
