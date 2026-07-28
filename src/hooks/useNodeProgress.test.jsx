// Characterisation tests for the map-progress hook.
//
// One set-state-in-effect finding lives here (the effect that kicks off
// fetchProgress), but the reason this file is worth testing is the MODULE-LEVEL
// cache it keeps so navigating back to the map renders instantly. That cache is
// deliberately keyed on the logged-in username, because the failure mode if the
// key is wrong is one child briefly seeing another child's quest progress on a
// shared device. Any refactor of the effect has to keep that guard.
//
// The real AuthContext is used rather than a mocked hook — it is now exported
// separately from its provider, so a plain Provider is enough.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useNodeProgress } from './useNodeProgress';
import { AuthContext } from '../contexts/AuthContext';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { get: vi.fn(), put: vi.fn(() => Promise.resolve({})) },
}));

// The two cache tests deliberately share one child so the second sees what the
// first left behind; every other test uses a name of its own.
const CACHE_USER = 'cache-kid';

const progressFor = (username, nodes) => ({
  current_node_id: nodes.at(-1) + 1,
  username,
  progress: nodes.map(id => ({ node_id: id, completed: true, stars: 3, completed_at: '2026-01-01' })),
});

function wrapperFor(user) {
  return function Wrapper({ children }) {
    return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
  };
}

beforeEach(() => {
  api.get.mockResolvedValue(progressFor('ada', [1, 2]));
  api.put.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useNodeProgress', () => {
  it('loads the signed-in child\'s progress', async () => {
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'ada' }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.username).toBe('ada');
    expect(result.current.currentNodeId).toBe(3);
    expect(result.current.progressMap[1]).toMatchObject({ completed: true, stars: 3 });
  });

  it('does nothing at all when nobody is signed in', async () => {
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor(null) });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.progressMap).toEqual({});
    expect(result.current.currentNodeId).toBe(1);
  });

  // A child with no cache entry, so the empty map really is the failure result
  // rather than a cache hit from another test in this file.
  it('survives a failed fetch without wedging on the loading screen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'never-cached' }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.progressMap).toEqual({});
  });

  // Each of these uses its own child: the module cache outlives a single test,
  // so reusing a username would hand the next test the previous one's frontier.
  it('marks a node complete and advances the frontier', async () => {
    api.get.mockResolvedValue(progressFor('mia', [1, 2]));
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'mia' }) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.markNodeComplete(5, 2); });

    expect(api.put).toHaveBeenCalledWith('/api/progress/5', { stars: 2 });
    expect(result.current.progressMap[5]).toMatchObject({ completed: true, stars: 2 });
    expect(result.current.currentNodeId).toBe(6);
  });

  it('never walks the frontier backwards', async () => {
    api.get.mockResolvedValue(progressFor('nia', [1, 2]));
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'nia' }) });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentNodeId).toBe(3);
    // Replaying an already-cleared early node must not demote the child.
    await act(async () => { await result.current.markNodeComplete(1, 3); });
    expect(result.current.currentNodeId).toBe(3);
  });

  it('keeps a failed completion from advancing the frontier', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.get.mockResolvedValue(progressFor('pia', [1, 2]));
    api.put.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'pia' }) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => { await result.current.markNodeComplete(9, 3); });

    expect(result.current.progressMap[9]).toBeUndefined();
    expect(result.current.currentNodeId).toBe(3);
  });

  // The cache tests run in order and share the module-level cache on purpose:
  // that shared state IS the thing under test.
  it('renders instantly from cache when the same child returns', async () => {
    api.get.mockResolvedValue(progressFor(CACHE_USER, [1, 2]));
    const first = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: CACHE_USER }) });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: CACHE_USER }) });
    // No loading flash, and the previous data is already there.
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.progressMap[1]).toMatchObject({ completed: true });
  });

  it('refuses to show a different child the cached progress', async () => {
    api.get.mockResolvedValue(progressFor('cara', [1, 2]));
    const cara = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'cara' }) });
    await waitFor(() => expect(cara.result.current.loading).toBe(false));
    expect(cara.result.current.progressMap[1]).toBeTruthy();
    cara.unmount();

    // Same device, different kid: the cache belongs to cara, so devi must start
    // empty and loading rather than inheriting her quests.
    api.get.mockResolvedValue(progressFor('devi', [7]));
    const devi = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: 'devi' }) });
    expect(devi.result.current.loading).toBe(true);
    expect(devi.result.current.progressMap).toEqual({});
    expect(devi.result.current.username).toBe('Dragon Tamer');

    await waitFor(() => expect(devi.result.current.loading).toBe(false));
    expect(devi.result.current.username).toBe('devi');
    expect(devi.result.current.progressMap[1]).toBeUndefined();
    expect(devi.result.current.progressMap[7]).toBeTruthy();
  });

  it('revalidates in the background even on a cache hit', async () => {
    api.get.mockResolvedValue(progressFor(CACHE_USER, [1, 2]));
    const first = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: CACHE_USER }) });
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();
    api.get.mockClear();
    api.get.mockResolvedValue(progressFor(CACHE_USER, [1, 2, 3, 4]));

    const second = renderHook(() => useNodeProgress(), { wrapper: wrapperFor({ username: CACHE_USER }) });
    expect(second.result.current.loading).toBe(false);   // served from cache
    await waitFor(() => expect(second.result.current.currentNodeId).toBe(5)); // then refreshed
    expect(api.get).toHaveBeenCalled();
  });
});
