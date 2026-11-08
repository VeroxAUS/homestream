import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { castMember, media, show } from '../test/fixtures';
import { DetailsExtras } from './DetailsExtras';

function renderExtras(props: Parameters<typeof DetailsExtras>[0]) {
  return render(
    <MemoryRouter>
      <DetailsExtras {...props} />
    </MemoryRouter>,
  );
}

describe('DetailsExtras', () => {
  it('renders nothing at all when there is no cast and no similar title', () => {
    const { container } = renderExtras({ cast: [], similar: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the Cast row first and "More like this" after it, in API order', () => {
    renderExtras({
      cast: [
        castMember({ name: 'Tim Robbins', character: 'Andy Dufresne' }),
        castMember({ name: 'Morgan Freeman', character: 'Red' }),
      ],
      similar: [media({ tmdbId: 1, title: 'First Similar' }), media({ tmdbId: 2, title: 'Second Similar' })],
    });
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(['Cast', 'More like this']);

    const cast = within(screen.getByRole('region', { name: 'Cast' })).getAllByRole('listitem');
    expect(cast.map((entry) => entry.textContent)).toEqual(['Tim RobbinsAndy Dufresne', 'Morgan FreemanRed']);

    const similar = within(screen.getByRole('region', { name: 'More like this' })).getAllByRole('link');
    expect(similar.map((link) => link.textContent)).toEqual([
      expect.stringContaining('First Similar'),
      expect.stringContaining('Second Similar'),
    ]);
  });

  it('draws each photo as a lazy 96 x 96 w185 image', () => {
    const { container } = renderExtras({
      cast: [castMember({ profileUrl: 'https://image.tmdb.org/t/p/w500/tim.jpg' })],
      similar: [],
    });
    const photo = container.querySelector('img');
    expect(photo).toHaveAttribute('src', 'https://image.tmdb.org/t/p/w185/tim.jpg');
    expect(photo).toHaveAttribute('width', '96');
    expect(photo).toHaveAttribute('height', '96');
    expect(photo).toHaveAttribute('loading', 'lazy');
    expect(photo).toHaveAttribute('decoding', 'async');
    expect(photo).toHaveAttribute('alt', '');
  });

  it('shows the first and last initial, and no image, for a member without a photo', () => {
    const { container } = renderExtras({
      cast: [
        castMember({ name: 'Stub Person', profileUrl: null }),
        castMember({ name: 'madonna', profileUrl: null }),
        castMember({ name: 'Jean  Claude Van Damme', profileUrl: null }),
      ],
      similar: [],
    });
    expect(container.querySelector('img')).toBeNull();
    const circles = screen.getAllByTestId('cast-photo');
    expect(circles.map((circle) => circle.textContent)).toEqual(['SP', 'M', 'JD']);
  });

  it('falls back to the initials when a photo fails to load', () => {
    const { container } = renderExtras({ cast: [castMember({ name: 'Stub Person' })], similar: [] });
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('cast-photo')).toHaveTextContent('SP');
  });

  it('leaves out the character line when the character is empty', () => {
    renderExtras({ cast: [castMember({ name: 'Solo Name', character: '' })], similar: [] });
    expect(screen.getByRole('listitem')).toHaveTextContent(/^Solo Name$/);
  });

  it('leaves out the Cast row alone when only similar titles exist, and the reverse', () => {
    const first = renderExtras({ cast: [], similar: [show({ tmdbId: 5, title: 'Only Similar' })] });
    expect(screen.queryByRole('heading', { name: 'Cast' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More like this' })).toBeInTheDocument();
    first.unmount();

    renderExtras({ cast: [castMember()], similar: [] });
    expect(screen.getByRole('heading', { name: 'Cast' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'More like this' })).not.toBeInTheDocument();
  });

  it('links a similar title to its own details page by type', () => {
    renderExtras({
      cast: [],
      similar: [media({ tmdbId: 7, title: 'A Movie' }), show({ tmdbId: 8, title: 'A Show' })],
    });
    expect(screen.getByRole('link', { name: /A Movie/ })).toHaveAttribute('href', '/movie/7');
    expect(screen.getByRole('link', { name: /A Show/ })).toHaveAttribute('href', '/tv/8');
  });

  it('makes cast entries plain text, not links or buttons', () => {
    renderExtras({ cast: [castMember()], similar: [] });
    const region = screen.getByRole('region', { name: 'Cast' });
    expect(within(region).queryByRole('link')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });
});
