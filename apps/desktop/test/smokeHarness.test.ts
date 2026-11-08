import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOME_PROBE,
  descendantsOf,
  isHomeRendered,
  parseProcessTable,
  stopShell,
  teardownSmoke,
  type HomeSnapshot,
  type TeardownOps,
} from './smoke/harness.js';

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

describe('smoke teardown (nothing may be left running on the gaming PC)', () => {
  const LAUNCHER = 100;
  const ELECTRON = 101;
  const SERVER = 102;
  const HUB = 200;
  const UNRELATED = 999;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  interface Fake {
    ops: TeardownOps;
    alive: Set<number>;
    calls: string[];
  }

  /** `stubborn` ignores the gentle stop, `immortal` ignores the forced kill too. */
  function fake(
    alive: number[],
    options: {
      stubborn?: number[];
      immortal?: number[];
      below?: Record<number, number[]>;
      removeDir?: (dir: string) => void;
    } = {},
  ): Fake {
    const live = new Set(alive);
    const calls: string[] = [];
    const ops: TeardownOps = {
      isAlive: (pid) => live.has(pid),
      stop: (pid) => {
        calls.push(`stop ${pid}`);
        if (!options.stubborn?.includes(pid) && !options.immortal?.includes(pid)) live.delete(pid);
      },
      kill: (pid) => {
        calls.push(`kill ${pid}`);
        if (!options.immortal?.includes(pid)) live.delete(pid);
      },
      descendants: (pid) => options.below?.[pid] ?? [],
      wait: () => Promise.resolve(),
      removeDir: (dir) => {
        calls.push(`remove ${dir}`);
        options.removeDir?.(dir);
      },
    };
    return { ops, alive: live, calls };
  }

  const shellRecord = (owned: number[]) => ({
    app: { pid: LAUNCHER },
    root: 'smoke-root',
    exitCode: () => 0 as number | null | undefined,
    owned: new Set(owned),
  });

  it('stops an owned child that outlived the launcher, even though the launcher has already exited', async () => {
    const world = fake([ELECTRON, SERVER, UNRELATED]);
    await stopShell(shellRecord([LAUNCHER, ELECTRON, SERVER]), world.ops);
    expect([...world.alive]).toEqual([UNRELATED]);
  });

  it('stops gently first and kills by pid only what ignored the gentle stop', async () => {
    const world = fake([ELECTRON, SERVER], { stubborn: [ELECTRON] });
    await stopShell(shellRecord([ELECTRON, SERVER]), world.ops);
    expect(world.alive.size).toBe(0);
    expect(world.calls.indexOf(`stop ${ELECTRON}`)).toBeLessThan(world.calls.indexOf(`kill ${ELECTRON}`));
    expect(world.calls).not.toContain(`kill ${SERVER}`);
  });

  it('picks up children that appeared below a launcher that is still running', async () => {
    const world = fake([LAUNCHER, ELECTRON, SERVER], { below: { [LAUNCHER]: [ELECTRON, SERVER] } });
    const shell = { ...shellRecord([]), exitCode: () => undefined as number | null | undefined };
    await stopShell(shell, world.ops);
    expect(world.alive.size).toBe(0);
    expect(shell.owned).toEqual(new Set([LAUNCHER, ELECTRON, SERVER]));
  });

  it('reports a process that survives the forced kill, still removes the folder and names the pid', async () => {
    const world = fake([ELECTRON], { immortal: [ELECTRON] });
    await expect(stopShell(shellRecord([ELECTRON]), world.ops)).rejects.toThrow(String(ELECTRON));
    expect(world.calls.at(-1)).toBe('remove smoke-root');
  });

  it('does not fail when the folder cannot be removed, and removes it only after the processes are gone', async () => {
    const world = fake([ELECTRON], {
      removeDir: () => {
        throw new Error('EBUSY: resource busy or locked');
      },
    });
    await expect(stopShell(shellRecord([ELECTRON]), world.ops)).resolves.toBeUndefined();
    expect(world.alive.size).toBe(0);
    expect(world.calls.at(-1)).toBe('remove smoke-root');
  });

  it('still stops the stub hub when removing the temp folder throws', async () => {
    const world = fake([ELECTRON, HUB], {
      removeDir: () => {
        throw new Error('EBUSY: resource busy or locked');
      },
    });
    await teardownSmoke({ shell: shellRecord([ELECTRON]), pids: [HUB] }, world.ops);
    expect(world.alive.size).toBe(0);
  });

  it('still stops the stub hub when the shell cannot be stopped, then reports the failure', async () => {
    const world = fake([ELECTRON, HUB], { immortal: [ELECTRON] });
    await expect(teardownSmoke({ shell: shellRecord([ELECTRON]), pids: [HUB] }, world.ops)).rejects.toThrow(
      String(ELECTRON),
    );
    expect(world.alive.has(HUB)).toBe(false);
  });

  it('ignores a hub that never started and a pid that is already gone', async () => {
    const world = fake([]);
    await teardownSmoke({ pids: [undefined, HUB] }, world.ops);
    expect(world.calls).toEqual([]);
  });
});
