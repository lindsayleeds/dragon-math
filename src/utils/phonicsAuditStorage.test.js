import { describe, expect, it, vi } from 'vitest';
import { PHONICS_AUDIT_STORAGE_KEY, savePhonicsAuditReview } from './phonicsAuditStorage';

describe('savePhonicsAuditReview', () => {
  it('returns the updated in-memory review when persistence fails', () => {
    const storage = { setItem: vi.fn(() => { throw new Error('storage blocked'); }) };

    const result = savePhonicsAuditReview({ grass: 'good' }, 'ship', 'flagged', storage);

    expect(result).toEqual({
      reviews: { grass: 'good', ship: 'flagged' },
      persisted: false,
    });
  });

  it('persists the updated review under the audit key', () => {
    const storage = { setItem: vi.fn() };

    const result = savePhonicsAuditReview({}, 'grass', 'good', storage);

    expect(storage.setItem).toHaveBeenCalledWith(
      PHONICS_AUDIT_STORAGE_KEY,
      JSON.stringify({ grass: 'good' }),
    );
    expect(result.persisted).toBe(true);
  });
});
