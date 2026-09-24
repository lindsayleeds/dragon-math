// The prize draw reads its odds from GET /api/rule-settings, falling back to
// the built-in table when that fails.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { api } from '../api';
import { resetRuleSettingsCache } from '../hooks/useRuleSettings';
import { DragonPrizeReveal } from './DragonPrizeReveal';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const CATALOG = [
  { dragon_id: 1, name: 'Moss', rarity: 'common' },
  { dragon_id: 2, name: 'Fern', rarity: 'common' },
  { dragon_id: 9, name: 'Nova', rarity: 'mythic' },
];

function serve(settings) {
  api.get.mockImplementation(async (url) => {
    if (url === '/api/dragons/catalog') return { dragons: CATALOG };
    if (url === '/api/rule-settings') {
      if (settings instanceof Error) throw settings;
      return settings;
    }
    throw new Error(`unexpected ${url}`);
  });
}

const collected = () => api.post.mock.calls.find(([url]) => url === '/api/dragons/collect')?.[1].dragon_ids;

beforeEach(() => {
  resetRuleSettingsCache();
  api.get.mockReset();
  api.post.mockReset();
  api.post.mockResolvedValue({ results: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('DragonPrizeReveal odds', () => {
  it('draws by the served rarity and count weights', async () => {
    serve({
      prize: {
        rarity_weights: { common: 0, mythic: 1 },
        count_weights: { high: [{ count: 3, weight: 1 }] },
      },
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<DragonPrizeReveal performance="high" />);
    await waitFor(() => expect(collected()).toEqual([9, 9, 9]));
  });

  it('falls back to the built-in odds when the settings fail to load', async () => {
    serve(new Error('offline'));
    // A draw of 0 takes the first entry: one dragon, from the first tier, first in it.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<DragonPrizeReveal performance="high" />);
    await waitFor(() => expect(collected()).toEqual([1]));
  });
});
