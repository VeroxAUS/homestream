import type { HealthResponse, TrayMenuEntry, TrayState } from '@homestream/shared';
import type { SupervisorStatus } from './supervisor.js';

type HealthTone = 'ok' | 'warn' | 'error';

export interface HealthSummary {
  overall: HealthTone;
  /** Checks that are not ok, counted by the worst level ("2 warnings", "1 problem"). */
  count: number;
}

export function summarizeHealth(health: HealthResponse | null): HealthSummary | null {
  if (!health) return null;
  if (health.overall === 'ok') return { overall: 'ok', count: 0 };
  const matching = health.checks.filter((check) => check.status === health.overall).length;
  const count = matching || health.checks.filter((check) => check.status !== 'ok').length || 1;
  return { overall: health.overall, count };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function healthWords(summary: HealthSummary | null): string {
  if (!summary || summary.overall === 'ok') return 'All systems healthy';
  return summary.overall === 'warn'
    ? plural(summary.count, 'warning', 'warnings')
    : plural(summary.count, 'problem', 'problems');
}

/**
 * The four icon states. Running (spawned or attached) with health ok is Healthy; with a warning or an error it is
 * Warning; a supervisor that gave up is Error; anything else (restarting, an external server that stopped) is Stopped.
 * Until the first health answer arrives a running server counts as healthy.
 */
export function trayState(status: SupervisorStatus, health: HealthSummary | null): TrayState {
  switch (status.kind) {
    case 'running':
    case 'attached':
      return health && health.overall !== 'ok' ? 'warn' : 'ok';
    case 'failed':
      return 'error';
    default:
      return 'stopped';
  }
}

export function trayTooltip(status: SupervisorStatus, health: HealthSummary | null, sessions: number): string {
  const state = trayState(status, health);
  if (state === 'error') return 'HomeStream\nServer failed - see logs';
  if (state === 'stopped') return 'HomeStream\nServer not running - reconnecting';
  return `HomeStream\n${healthWords(health)}${sessions >= 1 ? ` \u00b7 ${sessions} streaming` : ''}`;
}

export function statusLine(status: SupervisorStatus, health: HealthSummary | null): string {
  const state = trayState(status, health);
  if (state === 'error') return 'Server failed to start \u00b7 see logs';
  if (state === 'stopped') return 'Server not running \u00b7 reconnecting';
  return `Server running \u00b7 ${healthWords(health)}`;
}

export function streamLine(sessions: number): string {
  if (sessions <= 0) return 'No active streams';
  return sessions === 1 ? '1 device streaming' : `${sessions} devices streaming`;
}

export type TrayAction = 'open' | 'health' | 'logs' | 'startWithWindows' | 'restart' | 'quit';

export interface TrayMenuItem extends TrayMenuEntry {
  id?: TrayAction;
  /** The status dot beside the status line. */
  dot?: TrayState;
  separator?: boolean;
  bold?: boolean;
}

export interface TrayInputs {
  status: SupervisorStatus;
  health: HealthSummary | null;
  sessions: number;
  startWithWindows: boolean;
}

const SEPARATOR: TrayMenuItem = { label: '', enabled: false, separator: true };

/** Menu top to bottom as mocked; "Open logs folder" only in the Error state, "Start server" only when stopped. */
export function buildTrayMenu(inputs: TrayInputs): TrayMenuItem[] {
  const state = trayState(inputs.status, inputs.health);
  const items: TrayMenuItem[] = [
    { id: 'open', label: 'Open HomeStream', enabled: true, bold: true },
    SEPARATOR,
    { label: statusLine(inputs.status, inputs.health), enabled: false, dot: state },
    { label: streamLine(inputs.sessions), enabled: false },
    { id: 'health', label: 'Health dashboard', enabled: true },
  ];
  if (state === 'error') items.push({ id: 'logs', label: 'Open logs folder', enabled: true });
  items.push(
    SEPARATOR,
    { id: 'startWithWindows', label: 'Start with Windows', enabled: true, checked: inputs.startWithWindows },
    { id: 'restart', label: state === 'stopped' ? 'Start server' : 'Restart server', enabled: true },
    SEPARATOR,
    { id: 'quit', label: 'Quit HomeStream', enabled: true },
  );
  return items;
}

export interface TrayView {
  state: TrayState;
  tooltip: string;
  items: TrayMenuItem[];
}

/** Everything the tray shows for one moment, computed in one place so the icon, tooltip and menu never disagree. */
export function trayView(inputs: TrayInputs): TrayView {
  return {
    state: trayState(inputs.status, inputs.health),
    tooltip: trayTooltip(inputs.status, inputs.health, inputs.sessions),
    items: buildTrayMenu(inputs),
  };
}

/** What `getShellState().tray.menu` reports: every item except the separators. */
export function menuForState(items: readonly TrayMenuItem[]): TrayMenuEntry[] {
  return items
    .filter((item) => !item.separator)
    .map((item) => ({
      label: item.label,
      enabled: item.enabled,
      ...(item.checked !== undefined ? { checked: item.checked } : {}),
    }));
}
