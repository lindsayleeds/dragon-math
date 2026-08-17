-- Custom Dragon Spelling word lists + the shared word-audio cache.
-- Mirrors spellingLists / spellingListWords / spellingAudio in ../schema.js.
--
-- Applied by hand rather than with `drizzle-kit push`: the live database holds
-- tables that schema.js does not describe (billing_events, proving_grounds_runs,
-- rate_limits), so a whole-schema diff would propose dropping them. This file is
-- additive only — every statement is IF NOT EXISTS — and is safe to re-run.

CREATE TABLE IF NOT EXISTS spelling_lists (
  id            serial PRIMARY KEY,
  child_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_id integer REFERENCES users(id) ON DELETE SET NULL,
  name          text NOT NULL,
  created_at    timestamp with time zone DEFAULT now(),
  updated_at    timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spelling_lists_child ON spelling_lists (child_id);

CREATE TABLE IF NOT EXISTS spelling_list_words (
  id       serial PRIMARY KEY,
  list_id  integer NOT NULL REFERENCES spelling_lists(id) ON DELETE CASCADE,
  word     text NOT NULL,
  position integer NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS spelling_list_words_list_position_unique
  ON spelling_list_words (list_id, position);

-- Site-wide audio cache. No user or list column on purpose: a word is generated
-- once for everybody, so the hundredth family to add "beautiful" reuses the
-- first family's MP3. Rows outlive the lists that caused them.
-- The primary key is named EXPLICITLY to match what Drizzle generates for a
-- composite `primaryKey({ columns: [...] })` — `<table>_<col>_<col>_pk`. An
-- inline `PRIMARY KEY (word, voice_id)` lets Postgres auto-name it
-- `spelling_audio_pkey`, and `drizzle-kit push` then sees a constraint that
-- doesn't match the schema and drops/recreates the primary key. (That is
-- exactly what happened when this file was first applied by hand; the live
-- constraint was renamed on 2026-08-17 to match.)
CREATE TABLE IF NOT EXISTS spelling_audio (
  word        text NOT NULL,
  voice_id    text NOT NULL,
  mp3         bytea NOT NULL,
  byte_length integer NOT NULL DEFAULT 0,
  created_at  timestamp with time zone DEFAULT now(),
  CONSTRAINT spelling_audio_word_voice_id_pk PRIMARY KEY (word, voice_id)
);
