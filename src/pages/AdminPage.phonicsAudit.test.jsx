import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PHONICS_ELEMENTS } from '../data/phonicsCurriculum';
import { PHONICS_AUDIT_STORAGE_KEY } from '../utils/phonicsAuditStorage';
import { AdminPhonicsAudit } from './AdminPage';

const speakSound = vi.fn();

vi.mock('../utils/speakSound', async importOriginal => ({
  ...await importOriginal(),
  speakSound: (...args) => speakSound(...args),
}));

vi.mock('../utils/speakWord', async importOriginal => ({
  ...await importOriginal(),
  speakWord: vi.fn(),
}));

describe('AdminPhonicsAudit curriculum recordings', () => {
  it('opens on the complete new curriculum and filters it by stage', () => {
    render(<AdminPhonicsAudit />);

    expect(screen.getByRole('button', { name: /Curriculum sounds/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('heading', { name: `${PHONICS_ELEMENTS.length} recordings shown` })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: '4' } });

    const stageFourCount = PHONICS_ELEMENTS.filter(item => item.stage === 4).length;
    expect(screen.getByRole('heading', { name: `${stageFourCount} recordings shown` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play /gr/, spelled gr' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play /b/, spelled b' })).not.toBeInTheDocument();
  });

  it('reports completed isolated playback and stores a separate sound review', async () => {
    speakSound.mockResolvedValueOnce({ source: 'audio', url: '/audio/phonics/gr.mp3' });
    render(<AdminPhonicsAudit />);

    fireEvent.change(screen.getByLabelText('Find sound, spelling, or example'), {
      target: { value: 'grass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Play /gr/, spelled gr' }));

    await waitFor(() => expect(screen.getByText('isolated recording')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '✓ sounds right' }));

    expect(JSON.parse(localStorage.getItem(PHONICS_AUDIT_STORAGE_KEY))).toMatchObject({
      'sound:gr': 'good',
    });
  });
});
