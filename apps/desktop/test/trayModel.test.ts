import { describe, expect, it } from 'vitest';
import type { HealthResponse } from '@homestream/shared';
import type { SupervisorStatus } from '../src/supervisor.js';
import {
  buildTrayMenu,
  menuForState,
  statusLine,
  streamLine,
  summarizeHealth,
  trayState,
  trayTooltip,
  trayView,
} from '../src/trayModel.js';

const running: SupervisorStatus = { kind: 'running', pid: 10 };
const check = (status: 'ok' | 'warn' | 'error') => ({
  id: 'x',
  name: 'x',
  status,
  message: 'm',
  checkedAt: '2026-01-01T00:00:00Z',
});
const health = (overall: 'ok' | 'warn' | 'error', statuses: Array<'ok' | 'warn' | 'error'>): HealthResponse =>
  ({ overall, checks: statuses.map(check) }) as unknown as HealthResponse;

describe('summarizeHealth', () => {
  it('counts the checks at the worst level', () => {
    expect(summarizeHealth(null)).toBeNull();
    expect(summarizeHealth(health('ok', ['ok']))).toEqual({ overall: 'ok', count: 0 });
    expect(summarizeHealth(health('warn', ['warn', 'ok', 'warn']))).toEqual({ overall: 'warn', count: 2 });
    expect(summarizeHealth(health('error', ['warn', 'error']))).toEqual({ overall: 'error', count: 1 });
    expect(summarizeHealth(health('error', []))).toEqual({ overall: 'error', count: 1 });
  });
});

describe('tray state mapping', () => {
  const warn = { overall: 'warn', count: 2 } as const;
  const bad = { overall: 'error', count: 1 } as const;

  it.each([
    [running, null, 'ok'],
    [running, { overall: 'ok', count: 0 } as const, 'ok'],
    [running, warn, 'warn'],
    [running, bad, 'warn'],
    [{ kind: 'attached' } as const, warn, 'warn'],
    [{ kind: 'attached' } as const, null, 'ok'],
    [{ kind: 'failed', code: 'EXIT_1', lastAttemptAt: 1 } as const, null, 'error'],
    [{ kind: 'crashed', attempt: 1, retryAt: 1 } as const, null, 'stopped'],
    [{ kind: 'lost' } as const, null, 'stopped'],
    [{ kind: 'starting' } as const, null, 'stopped'],
    [{ kind: 'stopped' } as const, null, 'stopped'],
  ])('%j with %j is %s', (status, summary, expected) => {
    expect(trayState(status, summary)).toBe(expected);
  });

  it('writes the tooltip as mocked', () => {
    expect(trayTooltip(running, { overall: 'ok', count: 0 }, 2)).toBe(
      'HomeStream\nAll systems healthy \u00b7 2 streaming',
    );
    expect(trayTooltip(running, null, 0)).toBe('HomeStream\nAll systems healthy');
    expect(trayTooltip(running, { overall: 'warn', count: 2 }, 1)).toBe('HomeStream\n2 warnings \u00b7 1 streaming');
    expect(trayTooltip(running, { overall: 'warn', count: 1 }, 0)).toBe('HomeStream\n1 warning');
    expect(trayTooltip(running, { overall: 'error', count: 3 }, 0)).toBe('HomeStream\n3 problems');
    expect(trayTooltip({ kind: 'failed', code: 'x', lastAttemptAt: 1 }, null, 4)).toBe(
      'HomeStream\nServer failed - see logs',
    );
    expect(trayTooltip({ kind: 'lost' }, null, 4)).toBe('HomeStream\nServer not running - reconnecting');
  });

  it('writes the status and stream lines as mocked', () => {
    expect(statusLine(running, null)).toBe('Server running \u00b7 All systems healthy');
    expect(statusLine(running, { overall: 'error', count: 2 })).toBe('Server running \u00b7 2 problems');
    expect(statusLine({ kind: 'failed', code: 'x', lastAttemptAt: 1 }, null)).toBe(
      'Server failed to start \u00b7 see logs',
    );
    expect(statusLine({ kind: 'lost' }, null)).toBe('Server not running \u00b7 reconnecting');
    expect(streamLine(0)).toBe('No active streams');
    expect(streamLine(1)).toBe('1 device streaming');
    expect(streamLine(3)).toBe('3 devices streaming');
  });
});

describe('tray menu', () => {
  const inputs = (status: SupervisorStatus, startWithWindows = false) => ({
    status,
    health: null,
    sessions: 2,
    startWithWindows,
  });

  it('lists the items in the mocked order', () => {
    const labels = menuForState(buildTrayMenu(inputs(running)));
    expect(labels.map((item) => item.label)).toEqual([
      'Open HomeStream',
      'Server running \u00b7 All systems healthy',
      '2 devices streaming',
      'Health dashboard',
      'Start with Windows',
      'Restart server',
      'Quit HomeStream',
    ]);
    expect(labels.filter((item) => !item.enabled).map((item) => item.label)).toHaveLength(2);
  });

  it('checks Start with Windows from the Run entry', () => {
    const entry = (on: boolean) =>
      menuForState(buildTrayMenu(inputs(running, on))).find((item) => item.label === 'Start with Windows');
    expect(entry(true)?.checked).toBe(true);
    expect(entry(false)?.checked).toBe(false);
  });

  it('offers the logs folder only in the Error state and Start server only when stopped', () => {
    const failed = menuForState(buildTrayMenu(inputs({ kind: 'failed', code: 'x', lastAttemptAt: 1 }))).map(
      (i) => i.label,
    );
    expect(failed).toContain('Open logs folder');
    expect(failed).toContain('Restart server');
    const lost = menuForState(buildTrayMenu(inputs({ kind: 'lost' }))).map((i) => i.label);
    expect(lost).toContain('Start server');
    expect(lost).not.toContain('Open logs folder');
  });

  it('marks the first item as the default and attaches the status dot', () => {
    const items = buildTrayMenu(inputs(running));
    expect(items[0]).toMatchObject({ id: 'open', bold: true });
    expect(items.find((item) => item.dot)).toMatchObject({ dot: 'ok', enabled: false });
  });

  it('computes icon, tooltip and menu together', () => {
    const view = trayView(inputs(running));
    expect(view.state).toBe('ok');
    expect(view.tooltip).toContain('2 streaming');
    expect(view.items.length).toBeGreaterThan(5);
  });
});
