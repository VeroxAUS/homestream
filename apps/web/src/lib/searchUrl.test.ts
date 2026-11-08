import { afterEach, describe, expect, it } from 'vitest';
import { focusNavSearch, isSearchNow, readSearchText, searchUrl } from './searchUrl';

describe('search address', () => {
  it('reads the text of ?q= exactly as typed, spaces included', () => {
    expect(readSearchText('?q=breaking%20bad')).toBe('breaking bad');
    expect(readSearchText('?q=breaking+bad%20')).toBe('breaking bad ');
    expect(readSearchText('?q=a%2Bb%26c')).toBe('a+b&c');
    expect(readSearchText('')).toBe('');
    expect(readSearchText('?other=1')).toBe('');
  });

  it('writes the text back so that reading it gives the same text', () => {
    for (const text of ['dune', 'breaking bad ', 'a+b&c=d', 'Amélie', '100%']) {
      const url = searchUrl(text);
      expect(url.startsWith('/search?q=')).toBe(true);
      expect(readSearchText(url.slice('/search'.length))).toBe(text);
    }
  });

  it('has no ?q= for an empty text', () => {
    expect(searchUrl('')).toBe('/search');
  });
});

describe('isSearchNow', () => {
  it('is true only when the navigation state carries the same text', () => {
    expect(isSearchNow({ now: 'dune' }, 'dune')).toBe(true);
    expect(isSearchNow({ now: 'dune' }, 'dun')).toBe(false);
    expect(isSearchNow(null, 'dune')).toBe(false);
    expect(isSearchNow('dune', 'dune')).toBe(false);
    expect(isSearchNow({ now: 1 }, 'dune')).toBe(false);
  });
});

describe('focusNavSearch', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('focuses and selects the nav search field and says so', () => {
    document.body.innerHTML = '<input /><input data-nav-search value="dune" />';
    expect(focusNavSearch()).toBe(true);
    const field = document.querySelector<HTMLInputElement>('[data-nav-search]');
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(0);
    expect(field?.selectionEnd).toBe(4);
  });

  it('returns false when the field is not on the page', () => {
    document.body.innerHTML = '<input />';
    expect(focusNavSearch()).toBe(false);
  });
});
