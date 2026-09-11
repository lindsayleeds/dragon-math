import { act } from 'react';
import { page } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { MemoryPassageManager } from '../components/MemoryPassageManager';
import { AuthContext } from '../contexts/AuthContext';
import { DragonMemorizePage } from './DragonMemorizePage';
import { LearningLairPage } from './LearningLairPage';
import '../styles/global.css';

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../hooks/usePlaytimeHeartbeat', () => ({ usePlaytimeHeartbeat: vi.fn() }));
vi.mock('../utils/soundEffects', () => ({
  soundEffects: { playCorrect: vi.fn(), playWrong: vi.fn() },
}));

const evidenceDir = '../../.test-evidence';
let root;

async function captureEvidence(name) {
  if (import.meta.env.VITE_CAPTURE_TEST_EVIDENCE === '1') {
    await page.screenshot({ path: `${evidenceDir}/${name}` });
  }
}

async function render(ui) {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(ui));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
}

async function clickButton(name) {
  const button = page.getByRole('button', { name });
  await expect.element(button).toBeVisible();
  await act(async () => button.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = vi.fn();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.querySelector('#root')?.remove();
});

describe('Dragon Memorize rendered experience', () => {
  it('shows Dragon Memorize in the Learning Lair while Lava Leap stays hidden', async () => {
    await page.viewport(844, 1000);
    await render(
      <AuthContext.Provider value={{ user: { effective_plan: 'free' } }}>
        <MemoryRouter><LearningLairPage /></MemoryRouter>
      </AuthContext.Provider>,
    );

    await expect.element(page.getByRole('button', { name: 'Play Dragon Memorize' })).toBeVisible();
    expect(document.body.textContent).not.toContain('Lava Leap');
    await clickButton(/Memorization/);
    await expect.element(page.getByRole('button', { name: 'Play Dragon Memorize' })).toBeVisible();
    await captureEvidence('learning-lair-games.png');
  });

  it('shows all challenge levels and renders first-letter Hard recall', async () => {
    await page.viewport(390, 844);
    api.get.mockResolvedValue({ passages: [{
      id: 7,
      title: 'A Cheerful Heart',
      category: 'verse',
      body: 'A cheerful heart is good medicine.',
      mastery_level: 0,
      updated_at: '2026-09-10T12:00:00.000Z',
    }] });

    await render(<MemoryRouter><DragonMemorizePage /></MemoryRouter>);
    await clickButton(/A Cheerful Heart/);
    await expect.element(page.getByRole('button', { name: /Easy/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Medium/ })).toBeVisible();
    await expect.element(page.getByRole('button', { name: /Hard/ })).toBeVisible();
    await captureEvidence('dragon-memorize-levels.png');

    await clickButton(/Hard/);
    await clickButton('Hide the words');
    for (const key of ['a', 'c', 'h']) {
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key })));
    }
    await expect.element(page.getByText('Press the first letter of each word.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'A', exact: true })).toBeVisible();
    await captureEvidence('dragon-memorize-hard-recall.png');
  });

  it('renders the parent passage list and child-friendly passage editor', async () => {
    await page.viewport(390, 844);
    api.get.mockResolvedValue({ passages: [{
      id: 8,
      title: 'Kindness',
      category: 'quote',
      body: 'Kind words can brighten a cloudy day.',
      mastery_level: 1,
      updated_at: '2026-09-10T12:00:00.000Z',
    }] });

    await render(<MemoryPassageManager childId={4} childName="Rowan" onClose={vi.fn()} />);
    await expect.element(page.getByText('Kind words can brighten a cloudy day.')).toBeVisible();
    await clickButton('+ New passage');
    await expect.element(page.getByRole('dialog', { name: 'New memory passage' })).toBeVisible();
    await expect.element(page.getByLabelText('Words to memorize')).toBeVisible();
    await captureEvidence('parent-memory-passage-editor.png');
  });
});
