// Sign in with Apple on the web parent sign-in. Driven through the real
// useAuth + AuthProvider with fetch stubbed, so "signed in" means what it
// means in the app: POST /api/auth/apple answered and the session stored.
// Apple's JS (window.AppleID) is faked: `init` records the config each attempt
// was prepared with, `signIn` resolves with whatever the test hands it.

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider } from '../../contexts/AuthProvider';
import { AppleSignInButton, APPLE_JS_SRC } from './AppleSignInButton';

const SERVICES_ID = 'com.example.dragonmath.web';
const REDIRECT_URI = 'https://example.com/parent/auth';
const USER = { id: 501, account_type: 'parent', email: 'x@privaterelay.appleid.com' };

let init;
let signIn;
let fetchMock;

function configure() {
  vi.stubEnv('VITE_APPLE_SERVICES_ID', SERVICES_ID);
  vi.stubEnv('VITE_APPLE_REDIRECT_URI', REDIRECT_URI);
}

function jsonResponse(status, body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  localStorage.clear();
  init = vi.fn();
  signIn = vi.fn();
  window.AppleID = { auth: { init, signIn } };
  fetchMock = vi.fn((url) => {
    if (url === '/api/auth/apple') return jsonResponse(200, { token: 'session-jwt', user: USER });
    return jsonResponse(404, { error: 'not stubbed' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete window.AppleID;
  document.querySelectorAll(`script[src="${APPLE_JS_SRC}"]`).forEach(s => s.remove());
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function renderButton(onSuccess = () => {}) {
  return render(
    <AuthProvider>
      <AppleSignInButton onSuccess={onSuccess} />
    </AuthProvider>,
  );
}

const button = () => screen.getByRole('button', { name: /apple/i });
const lastInit = () => init.mock.calls.at(-1)[0];
const appleRequests = () => fetchMock.mock.calls.filter(([url]) => url === '/api/auth/apple');

// What Apple's popup resolves with, echoing the state the attempt was prepared with.
function applesAnswer(idToken = 'apple-identity-token') {
  return { authorization: { id_token: idToken, code: 'c', state: lastInit().state } };
}

describe('before Apple is set up', () => {
  it('renders nothing and loads no Apple script without a Services ID', () => {
    vi.stubEnv('VITE_APPLE_REDIRECT_URI', REDIRECT_URI);
    delete window.AppleID;
    const { container } = renderButton();
    expect(container.innerHTML).toBe('');
    expect(document.querySelector(`script[src="${APPLE_JS_SRC}"]`)).toBeNull();
  });

  it('renders nothing without a redirect URI', () => {
    vi.stubEnv('VITE_APPLE_SERVICES_ID', SERVICES_ID);
    const { container } = renderButton();
    expect(container.innerHTML).toBe('');
  });
});

describe('once configured', () => {
  beforeEach(configure);

  it("loads Apple's JS from appleid.cdn-apple.com when it isn't on the page", () => {
    delete window.AppleID;
    renderButton();
    expect(document.querySelector(`script[src="${APPLE_JS_SRC}"]`)).not.toBeNull();
    expect(APPLE_JS_SRC.startsWith('https://appleid.cdn-apple.com/')).toBe(true);
  });

  it('prepares popup mode with the Services ID and a hashed nonce', async () => {
    renderButton();
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(lastInit()).toMatchObject({
      clientId: SERVICES_ID,
      redirectURI: REDIRECT_URI,
      usePopup: true,
    });
    expect(lastInit().nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sends the token and the raw nonce to the server and stores the session', async () => {
    const onSuccess = vi.fn();
    renderButton(onSuccess);
    await waitFor(() => expect(button().disabled).toBe(false));
    const hashedNonce = lastInit().nonce;
    signIn.mockResolvedValue(applesAnswer('apple-identity-token'));

    fireEvent.click(button());

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(USER));
    expect(signIn).toHaveBeenCalledTimes(1);
    const [[, options]] = appleRequests();
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.identity_token).toBe('apple-identity-token');
    // Apple got sha256(raw) as hex; the server gets raw — exactly what it checks.
    expect(createHash('sha256').update(body.nonce).digest('hex')).toBe(hashedNonce);
    expect(localStorage.getItem('dm_token')).toBe('session-jwt');
  });

  it('uses a fresh nonce for every attempt', async () => {
    renderButton();
    await waitFor(() => expect(button().disabled).toBe(false));
    const first = lastInit().nonce;
    signIn.mockRejectedValue({ error: 'popup_closed_by_user' });

    fireEvent.click(button());

    await waitFor(() => expect(init).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button().disabled).toBe(false));
    expect(lastInit().nonce).not.toBe(first);
  });

  it('says nothing when the parent closes the popup', async () => {
    renderButton();
    await waitFor(() => expect(button().disabled).toBe(false));
    signIn.mockRejectedValue({ error: 'popup_closed_by_user' });

    fireEvent.click(button());

    await waitFor(() => expect(init).toHaveBeenCalledTimes(2));
    expect(appleRequests()).toEqual([]);
    expect(screen.queryByText(/did not finish/)).toBeNull();
  });

  it("refuses an answer whose state isn't this attempt's", async () => {
    renderButton();
    await waitFor(() => expect(button().disabled).toBe(false));
    signIn.mockResolvedValue({ authorization: { id_token: 't', state: 'someone-elses' } });

    fireEvent.click(button());

    expect(await screen.findByText('Apple sign-in did not finish. Please try again.')).toBeTruthy();
    expect(appleRequests()).toEqual([]);
  });

  it("shows the server's error and stores no session when it rejects the token", async () => {
    fetchMock.mockImplementation(() => jsonResponse(401, { error: 'Could not verify Apple sign-in.' }));
    const onSuccess = vi.fn();
    renderButton(onSuccess);
    await waitFor(() => expect(button().disabled).toBe(false));
    signIn.mockResolvedValue(applesAnswer());

    fireEvent.click(button());

    expect(await screen.findByText('Could not verify Apple sign-in.')).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem('dm_token')).toBeNull();
  });
});
