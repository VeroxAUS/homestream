/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make module load order fragile and hide the real layering.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-imports-nothing-from-apps',
      severity: 'error',
      comment: 'packages/shared is the contract every app builds on; it must not depend on any app.',
      from: { path: '^packages/shared/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-desktop-never-import-server',
      severity: 'error',
      comment: 'web and desktop talk to the server over HTTP and share types through packages/shared only.',
      from: { path: '^apps/(web|desktop)/' },
      to: { path: '^apps/server/' },
    },
    {
      name: 'web-and-desktop-never-import-each-other',
      severity: 'error',
      comment:
        'The desktop shell loads the web UI over HTTP; neither app imports the other, shared code lives in packages/shared.',
      from: { path: '^apps/web/' },
      to: { path: '^apps/desktop/' },
    },
    {
      name: 'desktop-never-imports-web',
      severity: 'error',
      comment: 'See web-and-desktop-never-import-each-other.',
      from: { path: '^apps/desktop/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'server-never-imports-clients',
      severity: 'error',
      comment: 'The server must not depend on a client app.',
      from: { path: '^apps/server/' },
      to: { path: '^apps/(web|desktop)/' },
    },
    {
      name: 'src-never-imports-tests',
      severity: 'error',
      comment: 'Production code must not import test helpers or fixtures.',
      from: { path: '^(apps|packages)/[^/]+/src/' },
      to: { path: '^(apps|packages)/[^/]+/test/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve to a file or an installed package.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage|reports|release)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'apps/server/tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
