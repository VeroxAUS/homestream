import type { PageRoute } from '@homestream/shared';

const TEMPLATES: ReadonlyArray<readonly [RegExp, PageRoute]> = [
  [/^\/$/, '/'],
  [/^\/search$/, '/search'],
  [/^\/movie\/[^/]+$/, '/movie/:id'],
  [/^\/tv\/[^/]+$/, '/tv/:id'],
  [/^\/play\/movie\/[^/]+$/, '/play/movie/:id'],
  [/^\/play\/tv\/[^/]+\/[^/]+\/[^/]+$/, '/play/tv/:id/:season/:episode'],
  [/^\/settings$/, '/settings'],
];

/** The route template of a path: ids are never sent. A path that matches no route is reported as `other`. */
export function routeTemplate(pathname: string): PageRoute {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const dashboard = /^\/dashboard\/(health|activity|history|graphs|stats)$/.exec(path);
  if (dashboard) return `/dashboard/${dashboard[1]}` as PageRoute;
  for (const [pattern, template] of TEMPLATES) if (pattern.test(path)) return template;
  return 'other';
}
