import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { MemoryPassageManager } from './MemoryPassageManager';

vi.mock('../api', () => ({
  api: { delete: vi.fn(), get: vi.fn(), patch: vi.fn(), post: vi.fn() },
}));

describe('MemoryPassageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ passages: [] });
  });

  it('explains unsupported hard-mode initials before saving', async () => {
    render(<MemoryPassageManager childId={4} childName="Fern" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New passage' }));
    fireEvent.change(screen.getByLabelText('Title or reference'), { target: { value: 'Travel saying' } });
    fireEvent.change(screen.getByLabelText('Words to memorize'), { target: { value: 'Visit Łódź.' } });
    expect(screen.getByText('Each word must begin with A–Z or 0–9 so Hard mode can be played. Change: Łódź.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save passage' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the loaded revision and refreshes after an edit conflict', async () => {
    const passage = {
      id: 7,
      title: 'Morning thought',
      category: 'quote',
      body: 'Be glad.',
      updated_at: '2026-09-10T12:00:00.000Z',
    };
    api.get.mockResolvedValue({ passages: [passage] });
    api.patch.mockRejectedValue(Object.assign(new Error('conflict'), { code: 'passage_changed' }));
    render(<MemoryPassageManager childId={4} childName="Fern" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title or reference'), { target: { value: 'Morning reminder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save passage' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/memory-passages/7', {
      title: 'Morning reminder',
      category: 'quote',
      body: 'Be glad.',
      updated_at: '2026-09-10T12:00:00.000Z',
    }));
    expect(await screen.findByText('This passage changed in another window. Refresh it before editing again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh passage' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Edit memory passage' })).not.toBeInTheDocument();
  });
});
