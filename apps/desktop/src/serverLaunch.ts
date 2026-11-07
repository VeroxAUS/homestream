import path from 'node:path';

export interface LaunchInput {
  packaged: boolean;
  /** `app.getAppPath()`: `apps/desktop` in development, the app folder in resources when packaged. */
  appPath: string;
  /** `process.resourcesPath`. */
  resourcesPath: string;
  /** `process.execPath`: the Electron executable. */
  execPath: string;
  env: NodeJS.ProcessEnv;
}

export interface ServerLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * How the supervisor starts the built server. Development runs `node` on `apps/server/dist/index.js`. A packaged app has
 * no node on PATH, so it runs its own executable as plain Node (`ELECTRON_RUN_AS_NODE`) on the server bundled in
 * resources, with the bundled web UI.
 */
export function resolveServerLaunch(input: LaunchInput): ServerLaunch {
  if (input.packaged) {
    return {
      command: input.execPath,
      args: [path.join(input.resourcesPath, 'server', 'dist', 'index.js')],
      env: {
        ...input.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOMESTREAM_PACKAGED: '1',
        HOMESTREAM_WEB_DIR: input.env.HOMESTREAM_WEB_DIR ?? path.join(input.resourcesPath, 'web'),
      },
    };
  }
  const env = { ...input.env };
  // A leftover flag would turn the dev `node` child into an Electron-flavoured process.
  delete env.ELECTRON_RUN_AS_NODE;
  return { command: 'node', args: [path.resolve(input.appPath, '..', 'server', 'dist', 'index.js')], env };
}

/** The last words of the server's own error output, used to explain a failed start in plain English. */
export function failureCodeFrom(tail: readonly string[], exitCode: number | null): string {
  const text = tail.join('\n');
  if (/EADDRINUSE/.test(text)) return 'EADDRINUSE';
  if (/EACCES/.test(text)) return 'EACCES';
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/.test(text)) return 'SERVER_NOT_BUILT';
  if (/ENOENT/.test(text)) return 'ENOENT';
  return exitCode === null ? 'KILLED' : `EXIT_${exitCode}`;
}

export function failureHint(code: string, port: number): string {
  switch (code) {
    case 'EADDRINUSE':
      return `another program is already using port ${port}. Close that program, or set a different PORT in config.env, then press Retry.`;
    case 'EACCES':
      return `Windows does not let HomeStream use port ${port}. Set a different PORT in config.env, then press Retry.`;
    case 'SERVER_NOT_BUILT':
      return 'the server files are missing. Reinstall HomeStream, or run the build when working from the source.';
    default:
      return 'the server stopped right after it started. Open the logs to see why, then press Retry.';
  }
}
