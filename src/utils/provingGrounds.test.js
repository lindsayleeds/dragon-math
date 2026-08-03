// The medal map is now a two-copy affair — localStorage on the device, one
// timestamped row per medal on the server — so the merge that reconciles them
// is the piece worth pinning. src/test/setup.js clears localStorage between
// tests, so each starts from an empty device.

import { describe, it, expect } from 'vitest';
import { loadMedals, recordMedal, mergeMedals, awardMedal, bestMedal } from './provingGrounds';

const USER = 42;

describe('mergeMedals', () => {
  it('takes the server medal when this device has none', () => {
    const merged = mergeMedals(USER, { 'mul-7': 'gold' });
    expect(merged['mul-7']).toBe('gold');
    // …and persists, so the next load paints without waiting on a fetch.
    expect(loadMedals(USER)['mul-7']).toBe('gold');
  });

  it('keeps the better medal in each direction', () => {
    recordMedal(USER, 'mul', 7, 'gold');   // device is ahead here
    recordMedal(USER, 'div', 3, 'bronze'); // server is ahead here
    const merged = mergeMedals(USER, { 'mul-7': 'bronze', 'div-3': 'silver' });
    expect(merged['mul-7']).toBe('gold');
    expect(merged['div-3']).toBe('silver');
  });

  it('leaves untouched levels alone', () => {
    recordMedal(USER, 'mul', 2, 'silver');
    const merged = mergeMedals(USER, { 'div-9': 'gold' });
    expect(merged['mul-2']).toBe('silver');
    expect(merged['div-9']).toBe('gold');
  });

  it('ignores medals it does not recognise', () => {
    recordMedal(USER, 'mul', 5, 'bronze');
    const merged = mergeMedals(USER, { 'mul-5': 'platinum', 'mul-6': 'rubbish' });
    expect(merged['mul-5']).toBe('bronze');
    expect(merged['mul-6']).toBeUndefined();
  });

  it('survives an empty or missing server payload', () => {
    recordMedal(USER, 'mul', 4, 'gold');
    expect(mergeMedals(USER, {})['mul-4']).toBe('gold');
    expect(mergeMedals(USER, null)['mul-4']).toBe('gold');
  });

  it('keeps each kid separate', () => {
    mergeMedals(USER, { 'mul-7': 'gold' });
    expect(bestMedal(mergeMedals(99, {}), 'mul', 7)).toBeNull();
  });
});

// awardMedal decides what gets POSTed at all — a null here means no row.
describe('awardMedal', () => {
  it('awards gold only for a fast perfect run', () => {
    expect(awardMedal(44, 0)).toBe('gold');
    expect(awardMedal(44, 1)).toBe('bronze');
  });

  it('gives nothing to a slow run', () => {
    expect(awardMedal(91, 0)).toBeNull();
  });

  it('gives nothing once a second answer is missed', () => {
    expect(awardMedal(30, 2)).toBeNull();
  });
});
