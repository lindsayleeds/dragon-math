import {
  ELEMENT_TYPES,
  PHONICS_ELEMENTS,
  STAGE_BY_NUMBER,
} from './phonicsCurriculum';
import { phonicsAudioUrl } from '../utils/speakSound';

export const phonicsSoundReviewKey = (key) => `sound:${key}`;

export function curriculumAudioAuditItems() {
  return PHONICS_ELEMENTS.map((element) => {
    const stage = STAGE_BY_NUMBER[element.stage];
    const type = ELEMENT_TYPES[element.type];
    return {
      ...element,
      reviewKey: phonicsSoundReviewKey(element.key),
      audioUrl: phonicsAudioUrl(element.key),
      stageLabel: stage.label,
      stageEmoji: stage.emoji,
      typeLabel: type.label,
      typeColor: type.color,
      gameUses: [
        'Sound Match prompt',
        'Sound Spell prompt',
        'Sound Hunt hint and feedback',
      ],
    };
  });
}
