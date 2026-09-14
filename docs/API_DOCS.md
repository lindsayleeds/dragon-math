# Dragon Math Content API — agent brief

A short, self-contained operating guide for an **AI agent or script** managing a
child's spelling lists and memory passages over HTTP.

It is deliberately portable: it assumes no access to this repository, so it can
be pasted into an agent working somewhere else. It is a *brief*, not the
contract — [API.md](API.md) is the full reference (every field, every response
shape, worked import script). When the two disagree, `API.md` wins.

---

## Credential and host

```bash
export DM_KEY=dmk_xxxxxxxx…          # never print, log, or commit this
export DM_HOST=https://mydragonmath.com
```

Send the token as a header on **every** request:

```
X-API-Key: $DM_KEY
```

`Authorization: Bearer dmk_…` also works for clients that only speak Bearer.

**Host notes.** `https://mydragonmath.com` is production and the only
environment where this API exists. `https://test.mydragonmath.com` is the test
box — its database is down and it never received the schema, so keys do not
work there. Never call `http://127.0.0.1:4071` directly even when running on the
server: it binds loopback on purpose so that nginx's TLS cannot be bypassed, and
going direct skips TLS and the rate limiting in front of it.

**The token is shown once at creation and stored only as a SHA-256 hash.** It
cannot be recovered — a lost key is deleted and replaced from the parent
dashboard's API keys card. Deletion takes effect on the next request.

## What a key can reach

A key authenticates **as the grown-up who created it** and carries no authority
that person does not already have:

- Only children linked to that account, enforced by the same code the dashboard
  runs.
- Only `/api/spelling` and `/api/memory-passages`, plus `whoami`. Everything
  else — parent, billing, admin — rejects it.
- It **cannot create, list or delete API keys.** That needs a browser session,
  so that signing in stays the recovery path if a key leaks.

---

## Start here: whoami

Every write is addressed by `child_id`, and this is where those ids come from.
Call it first; do not guess or hardcode an id.

```bash
curl -fsS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/api-keys/whoami"
```

```json
{
  "key": { "name": "Weekly import", "prefix": "dmk_3f9a2b71" },
  "user": { "id": 501, "username": "grownup" },
  "children": [{ "id": 884, "username": "emberfox", "real_name": "Rowan" }]
}
```

## Endpoints

| Method | Path | Body |
| --- | --- | --- |
| GET | `/api/spelling/lists?child_id=N` | — |
| POST | `/api/spelling/lists` | `{child_id, name, words:[…]}` |
| PATCH | `/api/spelling/lists/:id` | `{name?, words?}` |
| DELETE | `/api/spelling/lists/:id` | — |
| GET | `/api/memory-passages?child_id=N` | — |
| POST | `/api/memory-passages` | `{child_id, title, category, body}` |
| PATCH | `/api/memory-passages/:id` | `{title, category, body, updated_at}` |
| DELETE | `/api/memory-passages/:id` | — |

`category` is one of `verse`, `poem`, `quote`, `speech`, `definition`, `other`
(default `other`). A passage needs a title of at most 100 characters, a body of
1–250 words, and every word must start with A–Z or 0–9 so Hard mode is playable.

**Size caps**, all of which reject the whole request rather than truncating:

| Cap | Value |
| --- | --- |
| Words per spelling list | **60** |
| Passages per child | 40 |
| Words per passage body | 250 |
| Passage title length | 100 characters |
| API keys per account | 10 |

The 60-word list cap is the one a bulk import meets first: a term's worth of
words is more than one list, so split by week rather than sending one long
list.

---

## Rules that will bite you

These are the failure modes that do **not** announce themselves. Read them
before writing any call.

1. **Always use `curl -f`.** Without it curl exits 0 on a `4xx`, so a script
   that ignores a `402` or `429` reports success while importing nothing.

2. **Passage `PATCH` replaces the whole passage and requires optimistic
   concurrency.** Send `title`, `category` **and** `body` even to change one —
   an omitted `body` is a `400`, and an omitted `category` silently becomes
   `other`. You must also send the `updated_at` you last read; stale or missing
   answers `409` with `code: "passage_changed"` and writes nothing.

3. **On a `409`, re-read once and retry — never loop blindly.** A passage
   someone is editing in the dashboard will keep losing the race.

4. **Changing a passage's `body` resets that child's memorization progress**
   (`mastery_level` to 0, `last_practiced_at` cleared), deliberately — what they
   memorized is no longer what the passage says. Editing only the title or
   category leaves progress alone.

5. **Spelling `words` is replaced wholesale**, not merged. Send the full list,
   never a diff.

6. **Creating a list with words the site has never spoken generates speech.**
   That costs real money and takes seconds rather than milliseconds. Do not
   retry a slow create, and do not create throwaway lists to experiment. Words
   already in the site-wide cache are free and instant.

7. **Read `rejected` in a create response.** Words that are not usable spelling
   words are dropped and the list still saves, so a silently short list is not
   an error you would otherwise notice.

### Status codes

| Code | Meaning |
| --- | --- |
| `401` | Invalid or unknown key |
| `402` | The child's plan does not include Dragon Spelling |
| `403` | The key's account is not a grown-up account |
| `404` | Not yours — deliberately indistinguishable from "does not exist" |
| `409` | Stale `updated_at` on a passage edit; nothing was written |
| `429` | Over a limit — see below |

### Rate limits

| Limit | Scope | Ceiling |
| --- | --- | --- |
| Authenticated requests | per **IP address** | 600 / 15 min |
| Spelling-list writes (create + edit) | per **account** | 60 / hour |

The two are scoped differently on purpose, which matters if several jobs share
one host: they share the request ceiling but not the write ceiling.

---

## The shape of a safe passage edit

Read, modify, write — the only correct pattern, because of rules 2 and 3:

```bash
current=$(curl -fsS -H "X-API-Key: $DM_KEY" \
  "$DM_HOST/api/memory-passages?child_id=884" \
  | jq '.passages[] | select(.id == 31)')

body=$(jq -n --argjson p "$current" --arg title 'The Road Not Taken' \
  '{title: $title, category: $p.category, body: $p.body, updated_at: $p.updated_at}')

curl -fsS -X PATCH "$DM_HOST/api/memory-passages/31" \
  -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' -d "$body"
```

Note `jq` builds the JSON so the text is quoted correctly whatever it contains —
passage bodies have punctuation and line breaks in them.

For a full worked import of a term of spelling lists, see the end of
[API.md](API.md).
