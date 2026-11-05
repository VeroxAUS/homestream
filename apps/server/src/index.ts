import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { startDiscovery } from './discovery.js';
import { createLogger } from './logger.js';
import { displayGatewayUrl } from './redact.js';
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

  const appLogger = createLogger({ dataDir: config.dataDir });
  const { logger } = appLogger;
  for (const warning of config.warnings) logger.warn(warning);
  if (config.missingKeys.length > 0) {
    logger.warn(
      `Missing required config: ${config.missingKeys.join(', ')}. Add it to ${config.configFile.path} (restart the server afterwards).`,
    );
  }

  const app = await buildApp(config, { logger });
  await app.ctx.playback.recoverOrphans();
  await app.listen({ port: config.port, host: config.host });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  logger.info(
    { port, config: config.configFile.path, gateway: displayGatewayUrl(config.gatewayManifestUrl) },
    `HomeStream server ${SERVER_VERSION} listening`,
  );

  const discovery = startDiscovery({
    name: config.serverName,
    version: SERVER_VERSION,
    port,
    onError: (error) => logger.warn(`mDNS advertisement problem: ${error.message}`),
  });

  let stopping = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`Shutting down (${reason})`);
    await discovery.stop();
    await app.close();
    await appLogger.close();
    process.exit(0);
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
