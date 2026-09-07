import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

// BrowserRouter keeps the document's current scroll position when it swaps
// routes. That is useful for some web apps, but every Dragon Math route is a
// full-screen page: carrying a long page's offset into the next one can hide
// its heading and navigation controls.
export function ScrollToTop() {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
