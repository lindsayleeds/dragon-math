// AI moderation for kid-chosen handles. Given the wholesome, kids-facing tone of
// the app (see CLAUDE.md), a handle a student types for themselves shouldn't be
// lewd, hateful, or otherwise nasty — including sneaky spellings a static
// wordlist would miss (l33t-speak, spacing, homoglyphs). This asks a small,
// fast Claude model to judge the handle and returns a simple allow/deny.
//
// STUB STATUS: fully wired, but DORMANT until ANTHROPIC_API_KEY is set in .env.
// With no key it fails OPEN (allows everything) so signups keep working exactly
// as they do today. Drop a key in .env and it activates with no code change.
// On any API error it also fails open — a moderation outage must never lock a
// real kid out of picking a name; the failure is logged instead.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Handle moderation is a high-frequency, latency-sensitive classification, so it
// defaults to Haiku (Anthropic's fast/cheap classifier tier). Override with
// HANDLE_MODERATION_MODEL=claude-opus-4-8 in .env for maximum nuance.
const MODERATION_MODEL = process.env.HANDLE_MODERATION_MODEL || 'claude-haiku-4-5';

const MODERATION_ENABLED = !!ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = [
  'You screen usernames ("handles") that children pick for themselves in a',
  'wholesome, nature-forward math game for kids. A handle should be denied if it',
  'is lewd, sexual, profane, hateful, harassing, violent, drug/alcohol-related,',
  'or otherwise inappropriate for young children — INCLUDING attempts to sneak',
  'such content past a filter via creative spelling, leetspeak (e.g. numbers for',
  'letters), spacing, or lookalike characters. Ordinary kid-friendly handles',
  '(names, animals, plants, gems, dragons, numbers, playful words) are allowed.',
  'When genuinely unsure, allow it — err toward letting kids name themselves.',
].join(' ');

/**
 * Judge a chosen handle.
 * @param {string} handle
 * @returns {Promise<{ allowed: boolean, reason: string|null }>}
 *   `allowed:false` means block it; `reason` is a short internal explanation
 *   (for logs / grown-ups), NOT something to echo verbatim to a child.
 */
async function checkHandle(handle) {
  if (!MODERATION_ENABLED) return { allowed: true, reason: null };

  const clean = typeof handle === 'string' ? handle.trim() : '';
  if (!clean) return { allowed: true, reason: null };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        max_tokens: 128,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `Handle to screen: ${JSON.stringify(clean)}\n\n` +
              'Reply with ONLY a JSON object of the form ' +
              '{"allowed": true|false, "reason": "<short reason>"} and nothing else.',
          },
        ],
      }),
      // Never let a slow API stall a child's signup for long.
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[moderation] API ${resp.status} — allowing handle by default:`, body.slice(0, 300));
      return { allowed: true, reason: null };
    }

    const data = await resp.json();
    const text = (data?.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // The model is asked for bare JSON, but tolerate stray prose around it.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('[moderation] Unparseable response — allowing by default:', text.slice(0, 300));
      return { allowed: true, reason: null };
    }

    const verdict = JSON.parse(match[0]);
    const allowed = verdict.allowed !== false; // anything but an explicit false allows
    return { allowed, reason: allowed ? null : String(verdict.reason || 'flagged as inappropriate') };
  } catch (err) {
    console.error('[moderation] check failed — allowing handle by default:', err?.message || err);
    return { allowed: true, reason: null };
  }
}

const WORDS_SYSTEM_PROMPT = [
  'You screen custom spelling-practice word lists in a wholesome, nature-forward',
  'learning game for children. The words come from a real spelling homework list,',
  'so ordinary vocabulary of ANY difficulty is fine — long words, tricky words,',
  'science and history terms, and mildly unpleasant but educational words',
  '("earthquake", "poison", "war") are all allowed. Deny the list only if it',
  'contains words that are lewd, sexual, profane, hateful, or slurs — including',
  'attempts to sneak such content past a filter via creative spelling or',
  'leetspeak. When genuinely unsure, allow it — a real homework word must never',
  'be blocked.',
].join(' ');

/**
 * Judge a list of spelling words a CHILD typed for themselves. Grown-ups aren't
 * screened: a parent copying the week's list out of a school email should never
 * be second-guessed. Same fail-open contract as checkHandle — a moderation
 * outage must not stop a kid saving their homework.
 *
 * @param {string[]} words
 * @returns {Promise<{ allowed: boolean, reason: string|null }>}
 */
async function checkSpellingWords(words) {
  if (!MODERATION_ENABLED) return { allowed: true, reason: null };
  const list = (Array.isArray(words) ? words : []).filter(Boolean);
  if (list.length === 0) return { allowed: true, reason: null };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        max_tokens: 128,
        system: WORDS_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `Word list to screen: ${JSON.stringify(list)}\n\n` +
              'Reply with ONLY a JSON object of the form ' +
              '{"allowed": true|false, "reason": "<short reason>"} and nothing else.',
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[moderation] API ${resp.status} — allowing word list by default:`, body.slice(0, 300));
      return { allowed: true, reason: null };
    }

    const data = await resp.json();
    const text = (data?.content || [])
      .filter((b) => b?.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('[moderation] Unparseable response — allowing word list by default:', text.slice(0, 300));
      return { allowed: true, reason: null };
    }

    const verdict = JSON.parse(match[0]);
    const allowed = verdict.allowed !== false;
    return { allowed, reason: allowed ? null : String(verdict.reason || 'flagged as inappropriate') };
  } catch (err) {
    console.error('[moderation] word-list check failed — allowing by default:', err?.message || err);
    return { allowed: true, reason: null };
  }
}

module.exports = { checkHandle, checkSpellingWords, MODERATION_ENABLED, MODERATION_MODEL };
