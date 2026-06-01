# Hint Design — Learning Lair

A hint is **not** a smaller reveal. It's a nudge that still makes the child
produce the answer themselves. If a hint hands over the answer (`12`), it's just
an early reveal and won't build the fact. Design goal: give the lightest possible
push, and only escalate if they're still stuck.

## Build a hint *ladder*, not a single hint

Each tap of the hint button reveals one more rung. For `3 × 4`:

1. **Strategy name** — "Count by 3s, four times." (Points them at the method.)
2. **Skip-count, partially filled** — `3, 6, 9, __` and let *them* finish the
   last hop. The sweet spot for the 3's: does most of the work but leaves the
   final retrieval to the kid.
3. **Anchor to a known fact** — "You know `3 × 3 = 9`… now add one more 3."
   Leverages a fact they already own.
4. **Visual groups** — show 4 groups of 3 dots (or 4 gems, given the world) they
   can count.
5. **Near-answer nudge** *(only if they typed something close)* — "So close!
   That's only one 3 too few — count one more."

The answer itself is never on the ladder. The last rung still requires the child
to add the final step.

## Design notes

- **Escalate on demand, don't dump.** First tap = rung 1. Stuck → tap again for
  rung 2. A kid who just needed a second only sees the gentle nudge; a kid who's
  lost can climb all the way.
- **Optional by default, offered after a pause.** Don't auto-interrupt the kid
  who's about to get it. If they've sat ~8–10s with no input, gently surface the
  hint button ("Need a hand?") rather than failing them.
- **Skip-counting is the workhorse for the 3's.** It's the one strategy that
  generalizes across all nine facts in the table, so lean on rung 2 hardest. The
  array/visual is the fallback for kids who don't yet trust the count.
- **A hinted-correct answer is NOT mastered.** Important coupling with the
  spacing system: if they needed a hint, keep the fact in active rotation and
  bring it back sooner. Mastery = correct, fast, *and unaided* across spaced
  encounters. Track `hintsUsed` per attempt so the scheduler can see it.
- **Theme the hints** to fit the Dragon Math world — a friendly dragon counting
  gems in groups of 3, hops along a vine, etc. Keeps it wholesome and makes the
  hint feel like help from a buddy rather than a correction.

## How it ties together

The pause-timer, the hint ladder, and the reveal are one escalation:

> attempt → (pause) offer hint → climb rungs → still wrong? → full reveal with
> skip-count → re-ask later (unaided this time)

The hint ladder lives *before* the reveal, and anything that needed a hint or a
reveal goes back into rotation tighter.
