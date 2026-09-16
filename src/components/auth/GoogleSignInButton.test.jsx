// Regression cover for the iPad Google sign-in failure. Every assertion pins a
// *consequence* that was observed in production, not an implementation detail,
// so a correct refactor of the component keeps them green:
//
//   1. A parent re-render must not re-run Google Identity Services setup. The
//      old dependency array named `signInWithGoogle` (which useAuth rebuilds on
//      every call) and an inline `onSuccess` arrow, so every keystroke on the
//      auth page tore down and re-created the Google iframe.
//   2. A credential obtained but not yet exchanged must survive a page
//      teardown. iPad Safari reloaded the tab at exactly that moment, killing
//      the POST (nginx logged 499, zero bytes) and losing the sign-up entirely.

import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { GoogleSignInButton } from './GoogleSignInButton';

const signInWithGoogle = vi.fn();

// The part of useAuth's real behaviour that caused the bug: a brand new
// function identity on every call.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ signInWithGoogle: (...args) => signInWithGoogle(...args) }),
}));

const STORAGE_KEY = 'dragonmath.pendingGoogleCredential';
const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

let initialize;
let renderButton;

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_OAUTH_CLIENT_ID', CLIENT_ID);
  signInWithGoogle.mockReset().mockResolvedValue({ id: 1 });
  sessionStorage.clear();
  initialize = vi.fn();
  renderButton = vi.fn();
  window.google = { accounts: { id: { initialize, renderButton } } };
});

afterEach(() => {
  delete window.google;
  vi.unstubAllEnvs();
});

// The callback GSI was handed, i.e. what fires when the person picks an account.
const gsiCallback = () => initialize.mock.calls[0][0].callback;

function park(entry) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}

// What src/api.js throws once a response actually came back, as opposed to the
// bare TypeError a fetch killed by a page teardown rejects with.
function serverError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

describe('Google button setup', () => {
  it('does not re-initialize Google when the parent re-renders', async () => {
    // A new arrow every render, exactly as ParentAuthPage passes it.
    const { rerender } = render(<GoogleSignInButton onSuccess={() => {}} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(renderButton).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 5; i += 1) {
      rerender(<GoogleSignInButton onSuccess={() => {}} />);
    }

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(renderButton).toHaveBeenCalledTimes(1);
  });

  it('still reaches the latest onSuccess after those re-renders', async () => {
    const stale = vi.fn();
    const current = vi.fn();
    const { rerender } = render(<GoogleSignInButton onSuccess={stale} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    rerender(<GoogleSignInButton onSuccess={current} />);
    await gsiCallback()({ credential: 'cred-abc' });

    expect(signInWithGoogle).toHaveBeenCalledWith('cred-abc');
    expect(current).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});

describe('a credential that outlived its page', () => {
  it('parks nothing once the exchange succeeds', async () => {
    const onSuccess = vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    await gsiCallback()({ credential: 'cred-abc' });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('resumes one left behind when the page was torn down mid-exchange', async () => {
    park({ credential: 'cred-xyz', at: Date.now(), attempts: 0 });
    const onSuccess = vi.fn();

    render(<GoogleSignInButton onSuccess={onSuccess} />);

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledWith('cred-xyz'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores one too old to be worth replaying', async () => {
    park({ credential: 'cred-stale', at: Date.now() - 10 * 60_000, attempts: 0 });

    render(<GoogleSignInButton onSuccess={() => {}} />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('gives up once the attempt cap is reached, rather than retrying forever', async () => {
    park({ credential: 'cred-looping', at: Date.now(), attempts: 3 });

    render(<GoogleSignInButton onSuccess={() => {}} />);

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('clears it and surfaces the error when the server rejects the exchange', async () => {
    signInWithGoogle.mockRejectedValue(serverError('Could not verify Google sign-in.', 401));
    const onSuccess = vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    await gsiCallback()({ credential: 'cred-bad' });

    expect(await screen.findByText('Could not verify Google sign-in.')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // The iPad case itself: the request never reached a response, so the token is
  // not spent and the page that comes back must still be able to finish it.
  it('leaves it parked when the request dies before the server answers', async () => {
    signInWithGoogle.mockRejectedValue(new TypeError('Failed to fetch'));
    const { unmount } = render(<GoogleSignInButton onSuccess={() => {}} />);
    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));

    await gsiCallback()({ credential: 'cred-aborted' });

    await waitFor(() => {
      expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)).credential).toBe('cred-aborted');
    });

    // The reloaded page picks it up and completes the sign-in.
    unmount();
    signInWithGoogle.mockReset().mockResolvedValue({ id: 1 });
    const onSuccess = vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} />);

    await waitFor(() => expect(signInWithGoogle).toHaveBeenCalledWith('cred-aborted'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  // StrictMode double-invokes effects, which must not leave the component
  // believing it is unmounted — that silently swallowed every error message.
  it('still surfaces the error under StrictMode', async () => {
    signInWithGoogle.mockRejectedValue(serverError('Could not verify Google sign-in.', 401));
    render(
      <StrictMode>
        <GoogleSignInButton onSuccess={() => {}} />
      </StrictMode>,
    );
    await waitFor(() => expect(initialize).toHaveBeenCalled());

    await gsiCallback()({ credential: 'cred-bad' });

    expect(await screen.findByText('Could not verify Google sign-in.')).toBeTruthy();
  });
});
