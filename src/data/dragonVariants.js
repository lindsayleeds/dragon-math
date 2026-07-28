// Player-facing dragon avatar choices. The first entry is the default.
// Iterate this for picker UI; the renderers in components/FatDragonAvatar.jsx
// resolve each id to either an illustrated PNG or a recoloured SVG dragon.
//
// Kept out of that component file so it exports only components, which is what
// Fast Refresh needs to preserve state across edits.
export const DRAGON_VARIANTS = [
  { id: 'blaze', name: 'Blaze' },
  { id: 'fern', name: 'Fern' },
];
