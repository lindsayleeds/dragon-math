// Routing coverage for App.jsx.
//
// Why this file exists: react-router reaches 33 files in src/ (54 useNavigate,
// 50 Link, 35 Route) and had NO test coverage, so a react-router bump could only
// be verified by hand-clicking the app. Dependabot now proposes react and
// react-router updates weekly, and every one of them was going to land on that
// same manual check. These tests make the bump self-proving: they assert the
// route table's own decisions — which path an unauthenticated visitor is sent
// to, that a lazy chunk resolves, that :params arrive — so a router regression
// fails here instead of in production navigation.
//
// What is deliberately faked and why: <AuthProvider> is replaced with a
// passthrough that publishes a controlled value on the real AuthContext (the
// context object lives in its own module, apart from the provider, which is what
// makes this possible). The real provider calls /api/auth/me on mount, so using
// it would make every assertion wait on a mocked fetch and test the provider
// rather than the route table. Everything else — BrowserRouter, Routes, Route,
// Navigate, useParams, lazy() + Suspense — is the real library.
//
// Assertions are on window.location.pathname wherever a redirect is the
// behaviour under test. That is intentional: page copy changes, but "an
// unauthenticated visitor asking for /home ends up at /auth" is the contract.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthContext } from './contexts/AuthContext';

// Mutable so each test can set the auth state before rendering. The factory
// below closes over it, and vi.mock is hoisted, so it must be declared with var
// semantics that survive hoisting — a plain object mutated in place does.
const authState = { session: null, user: null, loading: false };

vi.mock('./contexts/AuthProvider', () => ({
  AuthProvider: ({ children }) => (
    <AuthContext.Provider value={authState}>{children}</AuthContext.Provider>
  ),
}));

// The companion provider fetches on mount and contributes nothing to routing.
vi.mock('./contexts/CompanionProvider', () => ({
  CompanionProvider: ({ children }) => children,
}));

// App is a DEFAULT export (the lazy *pages* are named — don't mix them up).
const App = (await import('./App')).default;

function goTo(path) {
  window.history.pushState({}, '', path);
}

async function renderApp() {
  await act(async () => {
    render(<App />);
  });
}

// Lazy routes resolve on their own schedule, so the chunk assertions below use
// findBy* (which retries) rather than a fixed number of ticks — a hard-coded
// wait here is the flake that shows up only on a loaded CI runner.

beforeEach(() => {
  authState.session = null;
  authState.user = null;
  authState.loading = false;
});

describe('App route table', () => {
  it('renders the eager /auth route', async () => {
    goTo('/auth');
    await renderApp();
    expect(screen.getByText('My Dragon Math')).toBeTruthy();
    expect(window.location.pathname).toBe('/auth');
  });

  it('sends an unknown path to /auth via the catch-all', async () => {
    goTo('/no-such-page');
    await renderApp();
    expect(window.location.pathname).toBe('/auth');
  });

  it('sends the root path to /auth', async () => {
    goTo('/');
    await renderApp();
    expect(window.location.pathname).toBe('/auth');
  });

  it('shows the loading screen instead of deciding while auth is resolving', async () => {
    // The guards must not redirect on a not-yet-known session, or a signed-in
    // user reloading a deep link gets bounced to /auth before their token loads.
    authState.loading = true;
    goTo('/home');
    await renderApp();
    expect(window.location.pathname).toBe('/home');
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  describe('kid routes', () => {
    it('redirects to /auth with no session', async () => {
      goTo('/home');
      await renderApp();
      expect(window.location.pathname).toBe('/auth');
    });

    it('redirects a parent away from a kid route to /parent', async () => {
      authState.session = 'tok';
      authState.user = { account_type: 'parent' };
      goTo('/home');
      await renderApp();
      expect(window.location.pathname).toBe('/parent');
    });
  });

  describe('parent routes', () => {
    it('redirects to /parent/auth with no session', async () => {
      goTo('/parent');
      await renderApp();
      expect(window.location.pathname).toBe('/parent/auth');
    });

    it('redirects a kid away from a parent route to /home', async () => {
      authState.session = 'tok';
      authState.user = { account_type: 'child' };
      goTo('/parent');
      await renderApp();
      expect(window.location.pathname).toBe('/home');
    });

    it('sends a signed-in teacher from a parent route to /teacher', async () => {
      // homePathFor() splits parents from teachers, and the guard uses it —
      // so a teacher landing on /parent must be routed on, not shown the page.
      authState.session = 'tok';
      authState.user = { account_type: 'parent', adult_role: 'teacher' };
      goTo('/parent');
      await renderApp();
      expect(window.location.pathname).toBe('/teacher');
    });
  });

  it('resolves a lazy route chunk through Suspense', async () => {
    // Every route except /auth is code-split, so this is the one that proves the
    // lazy() + Suspense + Routes combination still works — a break here would
    // leave the whole app stuck on the loading screen.
    goTo('/about');
    await renderApp();
    expect(await screen.findByText(/About My Dragon Math/)).toBeTruthy();
    expect(window.location.pathname).toBe('/about');
  });

  it('keeps a signed-in visitor off /parent/auth', async () => {
    // That route redirects rather than showing a second login to someone who
    // already has a session.
    authState.session = 'tok';
    authState.user = { account_type: 'parent' };
    goTo('/parent/auth');
    await renderApp();
    expect(window.location.pathname).toBe('/parent');
  });

  // The legal pages are the one place where "reachable with no session" is a
  // compliance requirement rather than a convenience: the signup form links to
  // them before an account exists, and a school or app-store reviewer has to be
  // able to read them cold. A guard accidentally wrapping them would send an
  // anonymous visitor to /auth — which is exactly the failure the catch-all test
  // above would NOT distinguish from a working route.
  describe.each([
    ['/privacy', /Privacy Policy/],
    ['/terms', /Terms of Service/],
  ])('%s', (path, heading) => {
    it('renders with no session at all', async () => {
      goTo(path);
      await renderApp();
      expect(await screen.findByText(heading)).toBeTruthy();
      expect(window.location.pathname).toBe(path);
    });
  });
});
