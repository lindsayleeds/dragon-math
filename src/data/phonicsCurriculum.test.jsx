import { describe, it, expect } from 'vitest';
import {
  PHONICS_ELEMENTS,
  ELEMENT_BY_KEY,
  PHONICS_STAGES,
  ELEMENT_TYPES,
  buildElementOptions,
  isAcceptedSpelling,
  elementsForStages,
} from './phonicsCurriculum';
import { GAME_TYPES, SUBJECTS, stockedSubjects } from './games';

// The curriculum is hand-maintained data, and the ways it can be wrong are
// mostly invisible at a glance: a duplicated key silently merges two sounds'
// mastery, an exemplar word that doesn't contain its own grapheme makes an
// unanswerable item, a `near` pointing at a renamed key quietly downgrades the
// distractors to random. None of that throws — it just makes the program
// slightly and permanently wrong. So it is asserted here instead.

describe('curriculum integrity', () => {
  it('has a unique key per element', () => {
    // A collision is the worst failure mode available: two different sounds
    // would share one audio file AND one mastery record. Three ending blends
    // (st, sk, sp) are also beginning blends, which is exactly how this nearly
    // shipped wrong.
    const keys = PHONICS_ELEMENTS.map((el) => el.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes).toEqual([]);
    expect(Object.keys(ELEMENT_BY_KEY)).toHaveLength(PHONICS_ELEMENTS.length);
  });

  it('keys every element as a safe audio filename and a valid API element_key', () => {
    // The key is used verbatim as public/audio/phonics/<key>.mp3 and is
    // validated by the same shape on the server (ELEMENT_KEY_RE in
    // server/routes/phonics.js) — a key that fails here would store nothing.
    for (const el of PHONICS_ELEMENTS) {
      expect(el.key, el.key).toMatch(/^[a-z][a-z0-9-]{0,23}$/);
    }
  });

  it('gives every element a known type and a declared stage', () => {
    const stageNumbers = new Set(PHONICS_STAGES.map((s) => s.stage));
    for (const el of PHONICS_ELEMENTS) {
      expect(ELEMENT_TYPES[el.type], `${el.key} type ${el.type}`).toBeTruthy();
      expect(stageNumbers.has(el.stage), `${el.key} stage ${el.stage}`).toBe(true);
    }
  });

  it('points every `near` reference at an element that exists', () => {
    // A dangling reference doesn't crash — it just drops that distractor, so the
    // confusable the author intended is silently replaced by a random one.
    const dangling = PHONICS_ELEMENTS.flatMap((el) =>
      el.near.filter((k) => !ELEMENT_BY_KEY[k]).map((k) => `${el.key} -> ${k}`));
    expect(dangling).toEqual([]);
  });

  it('never lists an element as confusable with itself', () => {
    for (const el of PHONICS_ELEMENTS) {
      expect(el.near, el.key).not.toContain(el.key);
    }
  });

  it('gives every element at least one exemplar word that contains its spelling', () => {
    for (const el of PHONICS_ELEMENTS) {
      expect(el.words.length, el.key).toBeGreaterThan(0);
      for (const word of el.words) {
        const found = el.accepts.some((spelling) => {
          const s = spelling.toLowerCase();
          // A magic-e frame (a_e) is never literal — check vowel-consonant-e.
          if (s.includes('_') || s.includes('-')) {
            return new RegExp(`${s[0]}[bcdfghjklmnpqrstvwxyz]${s[s.length - 1]}`).test(word);
          }
          return word.includes(s);
        });
        expect(found, `${el.key}: "${word}" does not contain ${el.accepts.join('/')}`).toBe(true);
      }
    }
  });

  it('always includes the element\'s own spelling in `accepts`', () => {
    for (const el of PHONICS_ELEMENTS) {
      expect(el.accepts, el.key).toContain(el.g);
    }
  });

  it('gives every element arpabet for the sound generator', () => {
    // Without it scripts/generate-phonics-audio.cjs would ask the model to read
    // the spelling, which is the letter names — the thing the child is decoding
    // past.
    for (const el of PHONICS_ELEMENTS) {
      expect(el.arpabet, el.key).toMatch(/^[A-Z0-9 ]+$/);
    }
  });

  it('assigns every element to exactly one stage, and every stage has elements', () => {
    const seen = new Set();
    for (const stage of PHONICS_STAGES) {
      expect(stage.elements.length, stage.label).toBeGreaterThan(0);
      for (const key of stage.elements) {
        expect(seen.has(key), `${key} in two stages`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(PHONICS_ELEMENTS.length);
  });
});

describe('elementsForStages', () => {
  it('returns the whole curriculum for "all" and for nothing', () => {
    expect(elementsForStages('all')).toHaveLength(PHONICS_ELEMENTS.length);
    expect(elementsForStages(null)).toHaveLength(PHONICS_ELEMENTS.length);
  });

  it('accepts one stage or several', () => {
    const one = elementsForStages(2);
    const two = elementsForStages([2, 3]);
    expect(one.every((el) => el.stage === 2)).toBe(true);
    expect(two.length).toBeGreaterThan(one.length);
  });
});

describe('isAcceptedSpelling', () => {
  it('accepts every listed spelling of an ambiguous sound', () => {
    // /ā/ is genuinely ai OR ay by ear — insisting on one would be testing
    // spelling knowledge under a phonics label.
    const ai = ELEMENT_BY_KEY['team-ai'];
    expect(isAcceptedSpelling(ai, 'ai')).toBe(true);
    expect(isAcceptedSpelling(ai, 'ay')).toBe(true);
    expect(isAcceptedSpelling(ai, 'ee')).toBe(false);
  });

  it('ignores case, spaces and the magic-e frame punctuation', () => {
    const longA = ELEMENT_BY_KEY['long-a'];
    for (const typed of ['a_e', 'a-e', 'AE', ' ae ']) {
      expect(isAcceptedSpelling(longA, typed), typed).toBe(true);
    }
  });

  it('rejects empty and non-string answers rather than counting them right', () => {
    const sh = ELEMENT_BY_KEY.sh;
    expect(isAcceptedSpelling(sh, '')).toBe(false);
    expect(isAcceptedSpelling(sh, '   ')).toBe(false);
    expect(isAcceptedSpelling(sh, null)).toBe(false);
    expect(isAcceptedSpelling(null, 'sh')).toBe(false);
  });
});

describe('buildElementOptions', () => {
  it('always includes the answer and returns the asked-for number of tiles', () => {
    for (const el of PHONICS_ELEMENTS) {
      const options = buildElementOptions(el, 4);
      expect(options, el.key).toHaveLength(4);
      expect(options.map((o) => o.key), el.key).toContain(el.key);
    }
  });

  it('never offers a second tile that is also a right answer', () => {
    // The trap: /ē/ accepts both `ee` and `ea`, so offering the vowel team whose
    // spelling is `ea` next to it makes an item with two correct tiles.
    for (const el of PHONICS_ELEMENTS) {
      const options = buildElementOptions(el, 4);
      const rightLooking = options.filter(
        (o) => o.key !== el.key
          && el.accepts.some((a) => a.toLowerCase() === o.g.toLowerCase()),
      );
      expect(rightLooking.map((o) => o.key), el.key).toEqual([]);
    }
  });

  it('prefers the element\'s declared confusables as distractors', () => {
    // This is what makes a wrong tap diagnostic rather than random — the
    // confusion report is only meaningful if the near-misses are on offer.
    const sh = ELEMENT_BY_KEY.sh;
    const options = buildElementOptions(sh, 4).map((o) => o.key);
    for (const near of sh.near) expect(options, near).toContain(near);
  });

  it('returns distinct tiles', () => {
    for (const el of PHONICS_ELEMENTS) {
      const keys = buildElementOptions(el, 4).map((o) => o.key);
      expect(new Set(keys).size, el.key).toBe(keys.length);
    }
  });
});

describe('the Learning Lair subject split', () => {
  it('gives every game a subject, so none is unreachable from the lair', () => {
    const subjectKeys = new Set(SUBJECTS.map((s) => s.key));
    for (const game of GAME_TYPES) {
      expect(subjectKeys.has(game.subject), `${game.id} subject ${game.subject}`).toBe(true);
    }
  });

  it('only offers subjects that actually have a game', () => {
    for (const subject of stockedSubjects()) {
      expect(GAME_TYPES.some((g) => g.subject === subject.key), subject.key).toBe(true);
    }
  });
});
