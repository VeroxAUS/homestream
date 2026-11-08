import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { HOME_PROBE, descendantsOf, isHomeRendered, parseProcessTable, type HomeSnapshot } from './smoke/harness.js';

const home = (patch: Partial<HomeSnapshot> = {}): HomeSnapshot => ({
  marked: true,
  setupScreen: false,
  headings: ['Trending Movies', 'Trending Shows'],
  posterTitles: ['The Stub Matrix', 'Stub Reloaded'],
  ...patch,
});

describe('isHomeRendered (what the launch smoke test waits for)', () => {
  it('accepts Home once the content mark exists and a poster row has titles', () => {
    expect(isHomeRendered(home())).toBe(true);
  });

  it('rejects the first-run screen even though it also sets the content mark', () => {
    expect(isHomeRendered(home({ setupScreen: true, headings: [], posterTitles: [] }))).toBe(false);
  });

  it('rejects the loading skeleton: the mark is not set and no row has rendered', () => {
    expect(isHomeRendered(home({ marked: false, headings: [], posterTitles: [] }))).toBe(false);
  });

  it('rejects an error panel: the mark is set but there are no poster rows', () => {
    expect(isHomeRendered(home({ headings: [], posterTitles: [] }))).toBe(false);
  });

  it('rejects a row heading without any poster in it', () => {
    expect(isHomeRendered(home({ posterTitles: [] }))).toBe(false);
  });

  it('rejects a page without the Trending Movies row', () => {
    expect(isHomeRendered(home({ headings: ['Popular Movies'] }))).toBe(false);
  });
});

describe('HOME_PROBE (the expression evaluated in the window)', () => {
  const run = (page: { marks: string[]; text: string; headings: string[]; links: Array<{ text: string }> }) => {
    const context = {
      performance: { getEntriesByName: (name: string) => page.marks.filter((mark) => mark === name) },
      document: {
        body: { innerText: page.text },
        querySelectorAll: (selector: string) => {
          if (selector === 'main h2') return page.headings.map((textContent) => ({ textContent }));
          if (selector === 'main section ul a') return page.links.map(({ text }) => ({ textContent: text }));
          throw new Error(`unexpected selector ${selector}`);
        },
      },
    };
    return JSON.parse(JSON.stringify(vm.runInNewContext(HOME_PROBE, context))) as HomeSnapshot;
  };

  it('reads the mark, the headings, the poster titles and the first-run text', () => {
    const snapshot = run({
      marks: ['hs:home-content'],
      text: 'Home Trending Movies',
      headings: ['Trending Movies'],
      links: [{ text: ' The Stub Matrix 1999 8.2 ' }],
    });
    expect(snapshot).toEqual({
      marked: true,
      setupScreen: false,
      headings: ['Trending Movies'],
      posterTitles: ['The Stub Matrix 1999 8.2'],
    });
    expect(isHomeRendered(snapshot)).toBe(true);
  });

  it('flags the Finish setting up screen', () => {
    const snapshot = run({ marks: ['hs:home-content'], text: 'Finish setting up', headings: [], links: [] });
    expect(snapshot.setupScreen).toBe(true);
    expect(isHomeRendered(snapshot)).toBe(false);
  });
});

describe('process table helpers (leftover process check)', () => {
  const table = [
    { pid: 1, ppid: 0 },
    { pid: 10, ppid: 1 },
    { pid: 11, ppid: 10 },
    { pid: 12, ppid: 10 },
    { pid: 20, ppid: 11 },
    { pid: 30, ppid: 2 },
  ];

  it('lists every descendant of a process, not the process itself or unrelated ones', () => {
    expect(descendantsOf(table, 10).sort((a, b) => a - b)).toEqual([11, 12, 20]);
    expect(descendantsOf(table, 99)).toEqual([]);
  });

  it('survives a parent cycle from a reused pid', () => {
    expect(
      descendantsOf(
        [
          { pid: 5, ppid: 6 },
          { pid: 6, ppid: 5 },
        ],
        5,
      ),
    ).toEqual([6]);
  });

  it('parses the Windows JSON table, a single row or several', () => {
    expect(parseProcessTable('[{"ProcessId":4,"ParentProcessId":1},{"ProcessId":5,"ParentProcessId":4}]')).toEqual([
      { pid: 4, ppid: 1 },
      { pid: 5, ppid: 4 },
    ]);
    expect(parseProcessTable('{"ProcessId":4,"ParentProcessId":1}')).toEqual([{ pid: 4, ppid: 1 }]);
  });

  it('parses the ps table', () => {
    expect(parseProcessTable('  1     0\n 22     1\n')).toEqual([
      { pid: 1, ppid: 0 },
      { pid: 22, ppid: 1 },
    ]);
  });

  it('gives an empty table for empty output', () => {
    expect(parseProcessTable('')).toEqual([]);
  });
});
