// The shared GET /api/rule-settings fetch: one request per page load, games
// read their section through a converter that falls back to the served
// defaults, and a served copy equal to the fallbacks keeps the same object.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { api } from '../api';
import {
  DEFAULT_PROVING_GROUNDS_SETTINGS,
  provingGroundsSettingsFromServer,
} from '../data/ruleSettings';
import {
  cachedRuleSettings,
  loadRuleSettings,
  resetRuleSettingsCache,
  useRuleSettings,
} from './useRuleSettings';

vi.mock('../api', () => ({ api: { get: vi.fn() } }));

const SERVED = {
  schema_version: 1,
  proving_grounds: { medal_seconds: { gold: 30, silver: 50, bronze: 80 }, max_wrong_for_bronze: 2 },
};

beforeEach(() => {
  resetRuleSettingsCache();
  api.get.mockReset();
});
afterEach(() => resetRuleSettingsCache());

describe('loadRuleSettings', () => {
  it('fetches once and caches the document', async () => {
    api.get.mockResolvedValue(SERVED);
    const [a, b] = await Promise.all([loadRuleSettings(), loadRuleSettings()]);
    expect(a).toBe(SERVED);
    expect(b).toBe(SERVED);
    expect(await loadRuleSettings()).toBe(SERVED);
    expect(cachedRuleSettings()).toBe(SERVED);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/api/rule-settings');
  });

  it('resolves null on failure and retries on the next call', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(SERVED);
    expect(await loadRuleSettings()).toBeNull();
    expect(cachedRuleSettings()).toBeNull();
    expect(await loadRuleSettings()).toBe(SERVED);
  });

  it('survives an api stub that returns nothing at all', async () => {
    api.get.mockReturnValue(undefined);
    expect(await loadRuleSettings()).toBeNull();
  });
});

describe('useRuleSettings', () => {
  it('returns the fallbacks, then the served values once they load', async () => {
    api.get.mockResolvedValue(SERVED);
    const { result } = renderHook(() => useRuleSettings(provingGroundsSettingsFromServer));
    expect(result.current).toEqual(DEFAULT_PROVING_GROUNDS_SETTINGS);
    await waitFor(() => expect(result.current.medalSeconds.gold).toBe(30));
    expect(result.current.maxWrongForBronze).toBe(2);
  });

  it('keeps the fallback object when the served values equal it', async () => {
    let resolve;
    api.get.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useRuleSettings(provingGroundsSettingsFromServer));
    const before = result.current;
    await act(async () => {
      resolve({
        proving_grounds: { medal_seconds: { gold: 45, silver: 60, bronze: 90 }, max_wrong_for_bronze: 1 },
      });
    });
    expect(cachedRuleSettings()).not.toBeNull();
    expect(result.current).toBe(before);
  });

  it('keeps the fallbacks when the fetch fails', async () => {
    api.get.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useRuleSettings(provingGroundsSettingsFromServer));
    await act(async () => { await loadRuleSettings(); });
    expect(result.current).toEqual(DEFAULT_PROVING_GROUNDS_SETTINGS);
  });
});
