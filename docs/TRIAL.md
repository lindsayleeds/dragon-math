# Dragon's Trial — Design Doc (v2, post-review)

## What we're trying to achieve

Dragon Math is a math-RPG where kids progress along a map of nodes, fighting
"battles" (math-fact races) to advance. New players currently all start at
node 1, which is fine for true beginners but boring for a kid who already
knows their addition facts cold.

**Dragon's Trial** is a one-time placement test, taken once per child account,
that:

1. Measures each child's competence in **addition, subtraction, multiplication,
   and division**.
2. Drops them onto the map at a starting node that matches their highest
   demonstrated skill — so a kid who already knows multiplication doesn't have
   to grind through 25 addition nodes to reach interesting content.
3. Feels like a "battle," not a quiz — same wallpaper, same dragon, same grid,
   same sound effects — so kids don't dread it.

It's not meant to be a fine-grained assessment. It just needs to answer:
*"roughly, which world should this kid start in?"*

## How a normal battle works (context)

A node battle is a first-to-N race between the player and an "AI" dragon:

- A math problem renders above a grid of cells (`battleData.js`
  `buildGridFromLayout`); one cell holds the correct answer, the rest are
  distractors.
- The player taps cells to answer. Correct tap → +1 player score, new problem.
  Wrong tap → cell flashes red, no penalty, keep trying.
- The "AI" is just a timer (`aiSeconds` per node, configurable in `/admin`).
  When the timer fires, the AI scores +1 and a new problem appears.
- First side to `PROBLEMS_TO_WIN` (10) wins the node.

Worlds & operations are configured per-node in [src/data/battleData.js](src/data/battleData.js):

| World | Nodes  | Focus                              |
|-------|--------|------------------------------------|
| 1     | 1–8    | addition foundation (1–12)         |
| 2     | 9–16   | addition mastery (larger numbers)  |
| 3     | 17–25  | subtraction, then mixed +/−        |
| 4     | 26–33  | multiplication intro (×2–×12)      |
| 5     | 34–41  | mixed all-ops mastery              |

## How the Trial differs from a battle

| Aspect            | Normal battle                  | Dragon's Trial                                  |
|-------------------|--------------------------------|-------------------------------------------------|
| End condition     | First to 10                    | Adaptive: 12 baseline + 0–20 probing            |
| Operation         | Set by node                    | Shuffled across all 4 ops in baseline           |
| AI win?           | Yes (ends node, replay)        | No — atmospheric growl only, never ends         |
| Wrong taps        | No penalty, unlimited          | **2 attempts max, then 0 points + advance**     |
| Timeout           | AI scores at `aiSeconds`       | **Soft — speed reduces points, never zeroes**   |
| Scoring           | Race count                     | **Per-op 0–1000 + confidence band**             |
| Persistence       | `node_progress`, `matches`     | `dragon_trial_results` (summary per child)      |
| Frequency         | Replayable                     | Once per child; parent can reset                |

Code:
- [src/hooks/useDragonTrial.js](src/hooks/useDragonTrial.js) — adaptive sequencing + scoring
- [src/pages/DragonTrialPage.jsx](src/pages/DragonTrialPage.jsx) — UI + results screen
- [server/routes/dragonTrial.js](server/routes/dragonTrial.js) — `/api/dragon-trial/complete`
- [server/db.js](server/db.js) — `dragon_trial_results` schema

## Adaptive flow

### Phase 1 — Baseline (always)

3 problems per op × 4 ops = **12 problems**, shuffled together so the kid
can't predict the operation.

After all 12, each op is classified by its baseline normalized score:

| Baseline classification | Score range | What happens in phase 2          |
|-------------------------|-------------|-----------------------------------|
| **strong**              | ≥ 800       | Add 2 confirmation problems       |
| **uncertain**           | 400–799     | Add 5 problems for better signal  |
| **weak**                | < 400       | Stop probing harder ops           |

### Phase 2 — Probing (variable)

Walk ops in order `[add, sub, mul, div]`. For each op, append problems based
on the baseline classification above. **Once any op classifies as weak, we
stop probing harder ops** — if a kid can't do addition, there's no signal
gained by drilling division.

Hard cap: `MAX_TOTAL_PROBLEMS = 50` truncates the sequence if it would run
long (in practice, ~17–32 problems).

### Sequence length examples

- Kid who crushes everything: 12 baseline + 4×2 confirm = **20 problems**
- Kid borderline on all 4 ops: 12 + 4×5 = **32 problems**
- Kid fails addition baseline: 12 + 0 = **12 problems** (early exit)
- Kid solid add/sub, borderline mul: 12 + 2 + 2 + 5 + 0 = **21 problems**

## Scoring system

### Per-problem points

| Outcome                                | Base points | Notes                                  |
|----------------------------------------|-------------|----------------------------------------|
| Correct on 1st tap                     | 200         | Multiplied by speed bonus              |
| Correct on 2nd tap                     | 150         | Multiplied by speed bonus              |
| 2 wrong taps → auto-advance            | 0           | Only way to score 0 on a correct kid   |

### Speed multiplier

The speed multiplier is applied to base points on a correct tap. A correct
answer is **never zeroed out by being slow** — the atmospheric AI growl is
flavor only.

| Time to correct tap | Multiplier |
|---------------------|------------|
| 0–4 sec             | ×1.00      |
| 4–8 sec             | ×0.90      |
| 8–12 sec            | ×0.75      |
| 12+ sec             | ×0.60      |

Examples:

| Outcome                  | Points |
|--------------------------|--------|
| 1st try in 3s            | 200    |
| 1st try in 7s            | 180    |
| 1st try in 11s           | 150    |
| 1st try in 15s           | 120    |
| 2nd try in 5s            | 135    |
| 2nd try in 13s           | 90     |
| 2 wrong taps             | 0      |

### Per-op normalized score (0–1000)

`score = round(sum(points) / (problemsAsked × 200) × 1000)`

Normalizing by `problemsAsked` lets us compare ops fairly even when the
adaptive flow asks more of one op than another.

### Confidence bands → 1–5 stars

Each op's normalized score maps to one of five bands, displayed as 1★–5★ on
the results card:

| Score    | Band         | Stars |
|----------|--------------|-------|
| 850–1000 | Fluent       | ★★★★★ |
| 700–849  | Capable      | ★★★★☆ |
| 500–699  | Developing   | ★★★☆☆ |
| 300–499  | Emerging     | ★★☆☆☆ |
| 0–299    | Not ready    | ★☆☆☆☆ |

### Placement — place at the start of the first un-mastered op

Goal: drop the kid where there is **some challenge**, not where they've
already mastered things. We walk `[add, sub, mul]` in order; the **first op
that isn't Fluent (5★)** is the placement op, and the kid lands at the start
of that op's world. Mastery uses a strict 5★/Fluent bar so a Capable kid
still gets to drill that op rather than being skipped past it.

Division is informational only — there is no division-focused world yet, so
div results show up as stars on the results card but don't shift placement.

| Mastery state (Fluent ops)        | Placement op (first non-fluent) | Target node | World                          |
|-----------------------------------|---------------------------------|-------------|--------------------------------|
| none                              | add                             | 1           | World 1 — Mushroom Forest start |
| add                               | sub                             | 17          | World 3 — subtraction start     |
| add + sub                         | mul                             | 26          | World 4 — multiplication start  |
| add + sub + mul                   | (all core ops mastered)         | 34          | World 5 — mixed all-ops         |

Worked example (the screenshot scenario): add 980, sub 1000, mul 469, div 0.
Add and sub are Fluent (5★); mul is Emerging (2★, just under the Developing
cutoff). Placement op = mul → **node 26 (Petal Path)**, start of World 4 —
the kid skips straight to multiplication intro instead of being held in
mixed +/− where they're already strong.

## Persistence

A new `dragon_trial_results` table holds one row per child (replaced on
retake):

| Column            | Purpose                                    |
|-------------------|--------------------------------------------|
| `user_id` (PK)    | One row per child                          |
| `taken_at`        | ISO datetime — most recent take            |
| `target_node_id`  | Where the trial placed them                |
| `highest_op`      | Highest Fluent op among add/sub/mul (informational; placement is derived from this) |
| `{op}_score`      | 0–1000 normalized                          |
| `{op}_band`       | `fluent` / `capable` / `developing` / `emerging` / `not_ready` |
| `{op}_asked`      | Number of problems posed for that op       |

Raw per-problem events are **not** persisted in this round — if we want to
tune thresholds or debug a particular run, we can add a `dragon_trial_events`
table later. For the parent dashboard, the summary is enough.

## Open questions / follow-ups

1. **Surface the trial result on the parent dashboard.** The data is now in
   `dragon_trial_results` — `ParentChildStatsPage` doesn't read it yet.
2. **Self-initiated retake after 30 days.** Today the trial is strictly
   one-shot (parents can reset it). A kid-initiated retake gate would be a
   small additive change.
3. **Division content in World 5.** If we add real division drills to World 5,
   we can re-promote division mastery to its own placement target instead of
   being informational only.
4. **The "problem N of M" counter** shifts when phase-2 probing extends the
   sequence after problem 12. Acceptable in v1 but worth a UX pass — maybe
   show "round 1 of 2" or just "problem N" without a denominator until the
   probe is decided.
5. **Tune the speed bands by age.** A 6-year-old reading a problem takes
   longer than an 11-year-old. We don't currently know the child's age in
   the trial; if we did, we could scale `SPEED_BANDS` per age.
