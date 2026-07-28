import {
  CrystalDragon,
  ForestDragon,
  MagmaDragon,
  SakuraDragon,
  StormDragon,
  SunfireDragon,
} from './BossArt';

// Registry: boss node id → custom dragon component.
// Bosses without an entry fall back to the emoji glyph in PaperNode.
//
// Separate from BossArt.jsx so that file exports only components, which is what
// Fast Refresh needs to preserve state while the artwork is being edited.
export const BOSS_ART = {
  8:  ForestDragon,  // Forest Dragon
  16: SunfireDragon, // Sunfire Dragon
  25: CrystalDragon, // Crystal Dragon
  33: SakuraDragon,  // Sakura Dragon
  41: StormDragon,   // Storm Dragon
  49: MagmaDragon,   // Magma Dragon
};
