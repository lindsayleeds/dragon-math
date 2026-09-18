// Built-in words whose recorded prompt includes sentence context. The offline
// ElevenLabs generator maintains this map when it uses the AI context check for
// newly added catalog words. Keep values spoken-only; they are never shown to a
// child during an attempt.
export const SPELLING_EXAMPLE_SENTENCES = {
  addition: 'In addition to milk, we need eggs.',
  caught: 'She caught the ball with one hand.',
  ceiling: 'The ceiling in our bedroom is painted white.',
  conscience: 'Your conscience tells you what is right and wrong.',
  current: 'The current flows downstream in the river.',
  desert: 'The hot desert has very little water.',
};
