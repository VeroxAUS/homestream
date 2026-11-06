export const DASHBOARD_TABS = [
  { path: 'health', label: 'Health' },
  { path: 'activity', label: 'Activity' },
  { path: 'history', label: 'History' },
  { path: 'graphs', label: 'Graphs' },
  { path: 'stats', label: 'Stats' },
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number]['path'];
