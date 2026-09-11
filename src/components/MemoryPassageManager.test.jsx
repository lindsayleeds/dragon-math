import { fireEvent, render, screen } from '@testing-library/react';
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
});
