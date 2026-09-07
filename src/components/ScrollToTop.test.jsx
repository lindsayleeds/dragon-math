import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ScrollToTop } from './ScrollToTop';

describe('ScrollToTop', () => {
  it('resets the document scroll position when navigation changes the page', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/game-list']}>
        <ScrollToTop />
        <Routes>
          <Route path="/game-list" element={<Link to="/dragon-phonics">Dragon Phonics</Link>} />
          <Route path="/dragon-phonics" element={<h1>Pick a level</h1>} />
        </Routes>
      </MemoryRouter>,
    );

    // Ignore the initial page mount; this assertion is specifically about the
    // transition from the scrolled game list to Dragon Phonics.
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('link', { name: 'Dragon Phonics' }));

    await screen.findByRole('heading', { name: 'Pick a level' });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 0));
  });
});
