import { act } from 'react';
import { page } from 'vitest/browser';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHONICS_ELEMENTS } from '../data/phonicsCurriculum';
import { phonicsAudioAuditItems } from '../data/phonicsWords';
import { AdminPhonicsAudit } from './AdminPage';
import '../styles/global.css';

const speakSound = vi.fn();

vi.mock('../utils/speakSound', async importOriginal => ({
  ...await importOriginal(),
  speakSound: (...args) => speakSound(...args),
}));

vi.mock('../utils/speakWord', async importOriginal => ({
  ...await importOriginal(),
  speakWord: vi.fn(),
}));

const evidenceDir = '../../.test-evidence';
let root;

async function captureEvidence(name, options = {}) {
  if (import.meta.env.VITE_CAPTURE_TEST_EVIDENCE === '1') {
    await page.screenshot({ path: `${evidenceDir}/${name}`, ...options });
  }
}

async function renderAudit() {
  const container = document.createElement('div');
  container.id = 'root';
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AdminPhonicsAudit />));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  document.querySelector('#root')?.remove();
});

describe('Admin phonics audit rendered experience', () => {
  it('renders the full curriculum by default and remains usable on mobile', async () => {
    speakSound.mockResolvedValueOnce({ source: 'example-word', fallbackSource: 'device-voice' });
    await page.viewport(1280, 900);
    await renderAudit();

    await expect.element(page.getByRole('button', { name: /Curriculum sounds/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('heading', { name: `${PHONICS_ELEMENTS.length} recordings shown` })).toBeVisible();
    await captureEvidence('admin-phonics-audit-desktop.png');

    await page.viewport(390, 1100);
    await act(async () => page.getByLabelText('Find sound, spelling, or example').fill('grass'));
    await act(async () => page.getByRole('button', { name: 'Play /gr/, spelled gr' }).click());
    await expect.element(page.getByText('example-word fallback', { exact: true })).toBeVisible();
    await expect.element(page.getByText('/audio/phonics/gr.mp3')).toBeVisible();
    await expect.element(page.getByRole('button', { name: '✓ sounds right' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: '⚑ flag' })).toBeVisible();
    await captureEvidence('admin-phonics-audit-mobile.png', { fullPage: true });
  });

  it('exports both recording collections through the browser download action', async () => {
    let exportedBlob;
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      exportedBlob = blob;
      return 'blob:phonics-audit';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await renderAudit();

    await act(async () => page.getByRole('button', { name: 'Export all JSON' }).click());
    const exported = JSON.parse(await exportedBlob.text());

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(exported.curriculumSounds).toHaveLength(PHONICS_ELEMENTS.length);
    expect(exported.wordPrompts).toHaveLength(phonicsAudioAuditItems().length);
    expect(exported.curriculumSounds.find(item => item.key === 'gr')).toMatchObject({
      audioUrl: '/audio/phonics/gr.mp3',
      review: 'unreviewed',
      source: 'checking',
    });
  });
});
