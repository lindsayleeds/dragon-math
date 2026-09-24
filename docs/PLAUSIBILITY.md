# Plausibility flags

The iOS app decides wins, unlocks and dragon prizes on the device, offline
included ([ADR 0004](adr/0004-client-authoritative-rewards.md)). A modified
device could award itself anything, so the server checks uploaded results and
**flags** what no real game could produce. It never rejects or takes anything
back:

- A flagged result is applied exactly as an unflagged one. The kid's dragon
  collection, map progress and own stats keep it. So do the parent dashboard,
  the weekly digest and the admin drill-in (`buildAnalytics`).
- It is left out of what *other people* see: the Munchers leaderboard,
  classroom and tribe rankings, a classmate's or tribemate's den, the teacher's
  roster and playtime stats, and the school's student list.
- The sync response doesn't mention a flag. The device has nothing to do about
  one, and telling it would show a cheat where the line is.

The code is in [server/lib/plausibility.js](../server/lib/plausibility.js):
thresholds (`PLAUSIBILITY`), reason codes (`REASONS`), pure checks, and the SQL
predicates every shared view uses.

## The checks

| Reason code | Applies to | Flagged when |
|---|---|---|
| `match_too_fast` | synced match | The time from `match_started` to `match_ended` is under 90% of the physical floor for its score (see below). |
| `match_ends_before_start` | synced match | The end is stamped before the start. |
| `clock_ahead` | synced match, node win, dragons, playtime | `occurred_at` is more than 10 minutes after the upload. The event is already recorded at "now". |
| `clock_behind` | same | `occurred_at` is more than 90 days before the upload. |
| `dragon_burst` | synced dragons | One event awards more than 12 dragons. The Egg Hatchery's 12 is the most any game gives at once. |
| `dragon_rate` | synced dragons | More than 120 dragons in the hour before the event, or in the hour after it. |
| `node_win_rate` | synced node win | More than 60 node wins in the hour before the event, or in the hour after it. |
| `score_above_max` | Munchers score (web) | The score is above 720, the most the finite campaign can award (a test recomputes this from `src/rules/munchers.js`). |

**Match floor.** Every problem needs a solve. The kid's solve takes at least
`MIN_CHILD_SOLVE_MS` (250 ms). The opponent's is never under
`battle.opponent.min_delay_ms`. Every problem except the last is followed by
its blank beat (`battle.timings.grid_blank_ms` after the kid's solve,
`grid_blank_ai_ms` after the opponent's). The opponent and timing values come
from the served rule settings (`BATTLE_SETTINGS`), so the floor follows them.
A match is judged once both of its events have arrived, by whichever arrives
second. Until a real `match_started` is in, an end that arrived first isn't
judged.

**Rates** are counted from `sync_events` by the device's own `occurred_at`, in
windows on both sides of the event. That way the verdict doesn't depend on
upload order: whichever of two nearby events arrives second sees the other.

The thresholds are deliberately generous. A false positive costs a real kid
their place on a leaderboard, and a cheat who paces themselves can always stay
under any rate. These checks only catch the blatant cases.

## Where flags live

- `plausibility_flags`: one row per flagged subject (`match` by the device's
  match id, `dragons` / `node_win` / `playtime` by sync event id, `game_score`
  by row id), with its `reasons` and the numbers the check saw in `details`.
  A later check on the same match merges its reasons in.
- The exclusion reads columns on the result tables, which are written in the
  same transaction as the flag:
  - `user_dragons.flagged_count`: how many of a dragon's `count` came from
    flagged uploads. A shared view counts the dragon only while
    `count > flagged_count`.
  - `play_minutes.flagged`: a minute only a flagged upload claimed. An
    unflagged record of the same minute (a later upload, or a web heartbeat)
    clears it.
  - `game_scores.flagged`.

A new shared view (anything another kid, a teacher or a school sees) must use
`countedDragonSql` / `countedMinuteSql` or filter on `flagged`. A view of the
kid's own record must not.

## Not checked

- **Attempts and wrong taps** feed only the kid's own stats, so they aren't
  flagged.
- **Map progress** (`current_node_id`, shown on the teacher roster) is the
  kid's own position, so it is shown as-is. A `node_win_rate` flag is kept as a
  record only.
- **Matches** aren't aggregated in any shared view yet. Their flags are kept
  as a record for when one is.
- **Web routes** other than the Munchers score (dragon collect, Proving Grounds
  runs, web matches) aren't checked. The browser posts each result as it
  happens, and there is no Proving Grounds leaderboard.

## Deploying

The schema change adds three NOT NULL columns with defaults (non-destructive)
and one new table with RLS declared. An operator applies it with
`deploy/db-push.sh`.
