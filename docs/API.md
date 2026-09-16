# Content API

Manage a child's **custom spelling lists** and **memory passages** from a script
instead of the parent dashboard — bulk-loading a term of spelling words, or
syncing passages from wherever they already live.

This is the only part of Dragon Math reachable with an API key. Everything else
still needs a browser session.

---

## What a key can and cannot do

A key **authenticates as the grown-up who created it** and carries no authority
that person does not already have:

- It reaches **only children linked to that account** (`parent_child_links`) —
  the same boundary the dashboard enforces, run by the same code.
- It works on **only two route trees**, `/api/spelling` and
  `/api/memory-passages`, plus the `whoami` call below. That bound comes from
  *where the key middleware is mounted*, not from a scope stored on the key.
- It **cannot manage keys.** Creating, listing and deleting keys need a signed-in
  session. Signing in is the recovery path if a key leaks, so a key must not be
  able to mint replacements or delete the key whose revocation would stop it.
- Writing a spelling list still requires the child's plan to include Dragon
  Spelling — a locked plan answers `402`, exactly as it does in the app.

The token is stored as a SHA-256 hash, so **it is shown once at creation and is
unrecoverable afterwards.** A lost key is replaced, not recovered.

## Getting a key

Parent dashboard → **API keys** → name it → **Create key**. Copy the token
(`dmk_…`) before leaving the panel. Up to 10 keys per account.

Delete a key from the same card. Deletion takes effect on the next request —
there is no cached copy anywhere.

## Handing a key to an AI agent

An agent needs two things: the token, and instructions it can read. The same
card offers **View agent instructions** and **Copy instructions URL**, both
pointing at `/agent-api/instructions.txt` — the short [agent brief](API_DOCS.md),
published as plain text and reachable **without signing in**, so an agent can
fetch it for itself. This document is published beside it as
`/agent-api/reference.txt`; where the brief and this reference disagree, this
one wins.

## Authenticating

Send the token in either header. `X-API-Key` is the one to prefer:

```bash
export DM_KEY=dmk_xxxxxxxx…
export DM_HOST=https://mydragonmath.com

curl -sS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/api-keys/whoami"
```

`Authorization: Bearer dmk_…` also works, for clients that only speak Bearer.

Errors: `401` invalid or unknown key, `403` the key's account is not a grown-up
account, `429` over the request ceiling (600 per 15 minutes), `404` a list or
passage that is not yours (deliberately indistinguishable from one that does not
exist).

## Finding your children

Every write is addressed by `child_id`, and this is where those ids come from.

```bash
curl -sS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/api-keys/whoami"
```

```json
{
  "key": { "name": "Weekly import", "prefix": "dmk_3f9a2b71" },
  "user": { "id": 501, "username": "grownup" },
  "children": [{ "id": 884, "username": "emberfox", "real_name": "Rowan" }]
}
```

`key` is `null` when a browser session made the call, which is how a caller can
tell which credential answered.

---

## Spelling lists

A list belongs to one child and holds the words in the order you send them.

### List them

```bash
curl -sS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/spelling/lists?child_id=884"
```

### Create one

```bash
curl -sS -X POST "$DM_HOST/api/spelling/lists" \
  -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' \
  -d '{"child_id": 884, "name": "Week 3", "words": ["brook", "meadow", "lantern"]}'
```

The response reports what happened to the audio as well as the list:

```json
{
  "list": { "id": 12, "name": "Week 3", "child_id": 884, "words": ["brook", "meadow", "lantern"], "audio_missing": [] },
  "rejected": [],
  "audio": { "generated": 2, "reused": 1, "failed": 0 }
}
```

Two fields worth reading in a script:

- **`rejected`** — words dropped for not being usable spelling words. The list
  still saves without them, so a silent short list means check this.
- **`audio`** — creating a list can generate speech for words the site has never
  spoken, which costs real money and makes the call slow (seconds, not
  milliseconds). Words already in the site-wide cache are free and instant. A
  word whose audio fails still saves; the game falls back to the browser voice.

Rate limit: 60 list writes per account per hour, shared by create and edit.

Limits, all `400` unless noted: at most **60 words per list**, at most **40
lists per child** (the 41st create is refused — delete an old list first), and a
list name of at most **40 characters**. A single word longer than 24 characters
is the exception: it is dropped into `rejected` and the rest of the list saves.

Words are normalized before they are stored: **lowercased**, and **duplicates
collapsed** to the first occurrence. A duplicate is not reported in `rejected`
— it simply is not there — so reconcile against the returned `words` rather
than against the list you sent.

### Edit one

`words` is replaced wholesale — send the full list, not a diff. Either field may
be sent alone.

```bash
curl -sS -X PATCH "$DM_HOST/api/spelling/lists/12" \
  -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' \
  -d '{"name": "Week 3 (revised)", "words": ["brook", "meadow", "lantern", "thicket"]}'
```

### Delete one

```bash
curl -sS -X DELETE "$DM_HOST/api/spelling/lists/12" -H "X-API-Key: $DM_KEY"
```

The words' audio stays in the shared cache for everyone else who has the same
word — deleting a list costs nothing and refunds nothing.

---

## Memory passages

A short verse, poem, quotation, speech or definition assigned to one child for
Dragon Memorize.

### List them

```bash
curl -sS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/memory-passages?child_id=884"
```

### Create one

`category` is one of `verse`, `poem`, `quote`, `speech`, `definition`, `other`
(default `other`).

```bash
curl -sS -X POST "$DM_HOST/api/memory-passages" \
  -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' \
  -d '{
        "child_id": 884,
        "title": "The Road Not Taken (opening)",
        "category": "poem",
        "body": "Two roads diverged in a yellow wood, / And sorry I could not travel both"
      }'
```

Rules the body must satisfy: a title (at most 100 characters), 1–250 words, and every
word must start with A-Z or 0-9 so Hard mode can be played. A passage whose
wording breaks that last rule is rejected with the offending words named. Up to
40 passages per child.

### Edit one

**Two things differ from the spelling endpoints, and a script that ignores
either will fail:**

1. **PATCH replaces the whole passage.** `title`, `category` and `body` are
   re-validated as a set, so send all three even to change one. An omitted
   `body` is a `400`, not "leave it alone", and an omitted `category` silently
   becomes `other`.
2. **You must send the `updated_at` you last read**, as an optimistic-concurrency
   check. A stale or missing value answers `409` with `code:
   "passage_changed"` and writes nothing — so the shape of a safe edit is
   read, modify, write:

```bash
current=$(curl -fsS -H "X-API-Key: $DM_KEY" \
  "$DM_HOST/api/memory-passages?child_id=884" \
  | jq '.passages[] | select(.id == 31)')

body=$(jq -n --argjson p "$current" --arg title 'The Road Not Taken' \
  '{title: $title, category: $p.category, body: $p.body, updated_at: $p.updated_at}')

curl -fsS -X PATCH "$DM_HOST/api/memory-passages/31" \
  -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' -d "$body"
```

On a `409`, re-read and retry — do not loop blindly, since a passage someone is
editing in the dashboard will keep losing the race.

**Changing the wording resets that child's progress** (`mastery_level` back to
0, `last_practiced_at` cleared) — deliberately, because what they memorised is no
longer what the passage says. Editing only the title or category leaves progress
alone.

### Delete one

```bash
curl -sS -X DELETE "$DM_HOST/api/memory-passages/31" -H "X-API-Key: $DM_KEY"
```

Answers `{"success": true}`. Progress goes with the passage, so deleting and
re-creating is not a way to rename one.

---

## Worked example: import a term of spelling lists

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DM_KEY:?set DM_KEY}"
DM_HOST="${DM_HOST:-https://mydragonmath.com}"

child=$(curl -fsS -H "X-API-Key: $DM_KEY" "$DM_HOST/api/api-keys/whoami" \
        | jq -r '.children[] | select(.username == "emberfox") | .id')

while IFS=: read -r name words; do
  # jq builds the body so the words are quoted correctly whatever they contain.
  body=$(jq -n --argjson child "$child" --arg name "$name" --arg words "$words" \
          '{child_id: $child, name: $name, words: ($words | split(","))}')
  curl -fsS -X POST "$DM_HOST/api/spelling/lists" \
    -H "X-API-Key: $DM_KEY" -H 'Content-Type: application/json' \
    -d "$body" | jq -c '{list: .list.name, rejected, audio}'
done <<'LISTS'
Week 1:brook,meadow,lantern
Week 2:thicket,burrow,willow
LISTS
```

`-f` matters: without it curl exits 0 on a `4xx`, and a script that ignores a
`402` or `429` reports success while importing nothing.

<!-- publish:ignore-start -->
<!-- Everything up to the matching end marker is stripped from the published
     /agent-api/reference.txt: relative links into the repository mean nothing
     to a reader who only has the URL. See agentApiDocsPlugin in
     vite.config.js. -->

---

## Where this lives in the code

| Piece | File |
| --- | --- |
| Token format, hashing, header parsing | [server/lib/apiKeys.js](../server/lib/apiKeys.js) |
| Turning a key into a `req.user` | [server/middleware/apiKey.js](../server/middleware/apiKey.js) |
| Create / list / delete / whoami | [server/routes/apiKeys.js](../server/routes/apiKeys.js) |
| Spelling list endpoints | [server/routes/spelling.js](../server/routes/spelling.js) |
| Passage endpoints | [server/routes/memoryPassages.js](../server/routes/memoryPassages.js) |
| Dashboard card | [src/components/ApiKeyManager.jsx](../src/components/ApiKeyManager.jsx) |
| `api_keys` table | [server/db/schema.js](../server/db/schema.js) |
<!-- publish:ignore-end -->
