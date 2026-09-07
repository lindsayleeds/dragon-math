import { describe, expect, it } from 'vitest';
import globalCss from './global.css?raw';

describe('global iOS safe-area boundary', () => {
  it('keeps all root content inside every hardware safe-area inset', () => {
    for (const edge of ['top', 'right', 'bottom', 'left']) {
      expect(globalCss).toContain(
        `--app-safe-area-${edge}: env(safe-area-inset-${edge}, 0px);`,
      );
      expect(globalCss).toContain(
        `padding-${edge}: var(--app-safe-area-${edge});`,
      );
    }
  });
});
