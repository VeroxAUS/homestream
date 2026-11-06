import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startDiscovery } from './discovery.js';
import { recordConfigWarnings } from './events/configWarnings.js';
import { createLogger } from './logger.js';
import { displayGatewayUrl } from './redact.js';
import { createShutdown } from './shutdown.js';
import { SERVER_VERSION, serverRoot } from './version.js';

function findRepoRoot(): string | null {
  if (process.env.HOMESTREAM_PACKAGED === '1') return null;
  let dir = serverRoot;
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  const config = loadConfig({
    repoRoot,
    defaultWebDir: path.resolve(serverRoot, '..', 'web', 'dist'),
  });
  mkdirSync(config.dataDir, { recursive: true });

  const appLogger = createLogger({ dataDir: config.dataDir, level: config.logLevel });
  const { logger } = appLogger;
  for (const warning of config.warnings) logger.warn(warning);
  if (config.missingKeys.length > 0) {
    logger.warn(
      `Missing required config: ${config.missingKeys.join(', ')}. Add it to ${config.configFile.path} (restart the server afterwards).`,
    );
  }

  const app = await buildApp(config, { logger });
  // Settings problems are also kept as warn events so they show up in the log view, not only in the console.
  recordConfigWarnings({ db: app.ctx.db, bus: app.ctx.bus }, config.warnings);
  await app.ctx.playback.recoverOrphans();
  const proxyPort = await app.ctx.sourceProxy.listen();
  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info(
    { port, sourceProxyPort: proxyPort, config: config.configFile.path, gateway: displayGatewayUrl(config.gatewayManifestUrl) },
    `HomeStream server ${SERVER_VERSION} listening`,
  );

  app.ctx.health.start();
  app.ctx.downloads.start();

  const discovery = startDiscovery({
    name: config.serverName,
    version: SERVER_VERSION,
    port,
    onError: (error) => logger.warn(`mDNS advertisement problem: ${error.message}`),
  });

  const stopAll = createShutdown({
    stop: async () => {
      await discovery.stop();
      await app.close();
      await appLogger.close();
    },
    exit: (code) => process.exit(code),
    warn: (message) => logger.warn(message),
  });
  const shutdown = (reason: string): Promise<void> => {
    logger.info(`Shutting down (${reason})`);
    return stopAll(reason);
  };

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
  // Windows cannot deliver SIGTERM to a child, so a supervisor can ask for a clean stop (mDNS goodbye) this way.
  process.on('message', (message) => {
    if ((message as { type?: string } | null)?.type === 'shutdown') void shutdown('ipc');
  });
  process.stdin.on('data', (chunk) => {
    if (chunk.toString().trim() === 'shutdown') void shutdown('stdin');
  });
  process.stdin.on('error', () => undefined);
}

main().catch((error: unknown) => {
  console.error('Failed to start HomeStream server:', error instanceof Error ? error.message : error);
  process.exit(1);
});
