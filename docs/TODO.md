# Dragon Math — Open Work

> **Retired 2026-08-05.** This file is no longer maintained. It is kept as a
> pointer so old links still land somewhere useful.

Open work is tracked in three places now, split by what the thing actually is:

| Where | What belongs there |
|---|---|
| [GitHub Issues](https://github.com/lindsayleeds/dragon-math/issues) | Discrete actionable tasks, and anything blocked on an external dashboard (Stripe, Google Cloud, Supabase) |
| [../GAPS.md](../GAPS.md) | Business and product gaps, and the reasoning behind each — a document to read, not a checklist to tick |
| [../deploy/README.md](../deploy/README.md) and `deploy/verify.sh` | What is actually true of a running box. Asserted on every deploy rather than checked off by hand |

## Why it was retired

Its checkboxes stopped matching the code, and a tracker nobody can trust costs
more than it saves.

When it was audited on 2026-08-05, **7 of its 17 open items were already done**:
pm2 cluster mode, the Resend API key and sending domain, the one-off digest send,
the password-reset flow, email-verification sending, change-password /
change-email / delete-account, and the privacy + COPPA copy. An eighth
(unparented student rows) duplicated [GAPS.md](../GAPS.md) §5a, and a ninth
contradicted it outright — GAPS said the API-restart investigation was "not
started" while this file recorded it as resolved.

That is the real failure mode: not a lost item, but a confident instruction to
build something that already exists. It had already sent work down that path more
than once.

The items that were genuinely still open became issues
[#41](https://github.com/lindsayleeds/dragon-math/issues/41),
[#42](https://github.com/lindsayleeds/dragon-math/issues/42), and
[#45](https://github.com/lindsayleeds/dragon-math/issues/45)–[#52](https://github.com/lindsayleeds/dragon-math/issues/52).

Nothing was thrown away — the full file, and every change ever made to it, is in
git:

```bash
git log --follow -p docs/TODO.md
```
