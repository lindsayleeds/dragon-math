import { describe, expect, it } from 'vitest';
import { PHONICS_ELEMENTS, PHONICS_STAGES } from './phonicsCurriculum';
import { curriculumAudioAuditItems, phonicsSoundReviewKey } from './phonicsAudit';

describe('curriculum phonics audio audit', () => {
  it('contains one isolated recording for every curriculum element', () => {
    const items = curriculumAudioAuditItems();

    expect(items).toHaveLength(PHONICS_ELEMENTS.length);
    expect(new Set(items.map(item => item.key)).size).toBe(PHONICS_ELEMENTS.length);
    expect(items.map(item => item.audioUrl)).toEqual(
      PHONICS_ELEMENTS.map(item => `/audio/phonics/${item.key}.mp3`),
    );
  });

  it('carries the human review context needed for every recording', () => {
    const stages = new Set(PHONICS_STAGES.map(stage => stage.label));

    for (const item of curriculumAudioAuditItems()) {
      expect(item.reviewKey).toBe(phonicsSoundReviewKey(item.key));
      expect(stages.has(item.stageLabel)).toBe(true);
      expect(item.typeLabel).not.toBe('');
      expect(item.words.length).toBeGreaterThan(0);
      expect(item.accepts).toContain(item.g);
      expect(item.gameUses).toEqual(expect.arrayContaining([
        'Sound Match prompt',
        'Sound Spell prompt',
        'Sound Hunt hint and feedback',
      ]));
    }
  });

  it('keeps isolated-sound reviews separate from word reviews', () => {
    expect(phonicsSoundReviewKey('grass')).toBe('sound:grass');
    expect(phonicsSoundReviewKey('gr')).not.toBe('gr');
  });
});
