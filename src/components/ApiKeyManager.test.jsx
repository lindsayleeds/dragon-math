// The API-keys card. Frontend code is ESM, so `../api` is mocked directly —
// the opposite of the server rule (see AGENTS.md).
//
// The assertions worth having here are about the one-time token, because that
// is the only part of this screen where a bug destroys something: the server
// keeps a hash, so a plaintext this component drops before the person copies it
// is gone for good. The rest is ordinary list rendering.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiKeyManager } from './ApiKeyManager';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const { api } = await import('../api');

const TOKEN = `dmk_${'a1b2c3d4'.repeat(8)}`;

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ keys: [], max: 10 });
});

describe('listing keys', () => {
  it('explains the agent handoff and offers a copyable instructions URL', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<ApiKeyManager />);

    expect(await screen.findByText(/give an api key to an ai agent/i)).toBeTruthy();
    const guide = screen.getByRole('link', { name: 'View agent instructions' });
    expect(new URL(guide.href).pathname).toBe('/agent-api/instructions.txt');

    await user.click(screen.getByRole('button', { name: 'Copy instructions URL' }));
    expect(writeText).toHaveBeenCalledWith(new URL('/agent-api/instructions.txt', window.location.origin).href);
    expect(screen.getByRole('button', { name: 'Instructions URL copied' })).toBeTruthy();
  });

  it('shows each key by name and prefix, never a secret', async () => {
    api.get.mockResolvedValue({
      keys: [{ id: 1, name: 'Weekly import', prefix: 'dmk_11112222', last_used_at: null, created_at: null }],
      max: 10,
    });
    render(<ApiKeyManager />);

    expect(await screen.findByText('Weekly import')).toBeTruthy();
    expect(screen.getByText(/dmk_11112222/)).toBeTruthy();
    expect(screen.getByText('Last used never')).toBeTruthy();
  });

  it('says so when there are none', async () => {
    render(<ApiKeyManager />);
    expect(await screen.findByText('No API keys yet.')).toBeTruthy();
  });
});

describe('creating a key', () => {
  it('reveals the plaintext once and keeps it on screen', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      token: TOKEN,
      key: { id: 5, name: 'Seed script', prefix: 'dmk_a1b2c3d4', last_used_at: null, created_at: null },
    });
    render(<ApiKeyManager />);

    await user.type(await screen.findByLabelText('New key name'), 'Seed script');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    // The token must be rendered in full — a truncated one is unusable, and
    // there is no second chance to read it.
    expect(await screen.findByText(TOKEN)).toBeTruthy();
    expect(screen.getByText(/shown once and cannot be recovered/i)).toBeTruthy();
    // And the new key joins the list.
    expect(screen.getByText('Seed script')).toBeTruthy();
  });

  // Nothing may close this panel on its own — not a re-render, not the list
  // refreshing. Only the person saying they have it.
  it('hides the token only when explicitly dismissed', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      token: TOKEN,
      key: { id: 5, name: 'Seed script', prefix: 'dmk_a1b2c3d4', last_used_at: null, created_at: null },
    });
    render(<ApiKeyManager />);

    await user.type(await screen.findByLabelText('New key name'), 'Seed script');
    await user.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText(TOKEN)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'I have saved it' }));
    await waitFor(() => expect(screen.queryByText(TOKEN)).toBeNull());
  });

  it('surfaces a server refusal without clearing what was typed', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(new Error("That's 10 keys already — delete one to make another."));
    render(<ApiKeyManager />);

    await user.type(await screen.findByLabelText('New key name'), 'One too many');
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText(/10 keys already/)).toBeTruthy();
    expect(screen.getByLabelText('New key name').value).toBe('One too many');
  });

  it('will not submit an empty name', async () => {
    render(<ApiKeyManager />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Create key' }).disabled).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('reports a load failure instead of showing an empty list', async () => {
    api.get.mockRejectedValue(new Error('Network down'));
    render(<ApiKeyManager />);
    expect(await screen.findByText('Network down')).toBeTruthy();
    expect(screen.queryByText('No API keys yet.')).toBeNull();
  });
});
