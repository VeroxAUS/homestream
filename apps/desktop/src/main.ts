import { existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { parseCliFlags } from './cli.js';
import { dataDirFrom, loadShellEnv, portFrom, resolveEnvFile } from './envFile.js';
import { writeJson } from './jsonFile.js';
import { createServerClient } from './serverHttp.js';
import { resolveServerLaunch } from './serverLaunch.js';
import { spawnServerChild } from './serverProcess.js';
import { SettingsStore } from './settings.js';
import { Shell } from './shell/shell.js';
import { startTelemetry } from './shell/telemetry.js';
import { Supervisor } from './supervisor.js';

const flags = parseCliFlags(process.argv);

// The default folder would be named after the package ("@homestream"). --user-data-dir (used for validation runs and
// the e2e smoke test) still wins, and with it a separate single-instance lock.
app.setName('HomeStream');
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'HomeStream'));
}

/** Both switches have to be set before the app is ready. */
function loadSettings(userData: string): SettingsStore {
  const settingsFile = path.join(userData, 'desktop-settings.json');
  const firstRun = !existsSync(settingsFile);
  const settings = new SettingsStore(settingsFile);
  if (firstRun) writeJson(settingsFile, settings.get());
  if (!settings.get().hardwareAcceleration) app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  return settings;
}

async function run(): Promise<void> {
  const userData = app.getPath('userData');
  const repoRoot = app.isPackaged ? null : path.resolve(app.getAppPath(), '..', '..');
  const envFile = resolveEnvFile({
    env: process.env,
    packaged: app.isPackaged,
    repoRoot,
    appData: app.getPath('appData'),
  });
  loadShellEnv(envFile, process.env);
  const dataDir = dataDirFrom(process.env);
  const port = portFrom(process.env);

  const settings = loadSettings(userData);

  const version = app.getVersion();
  const telemetry = startTelemetry({
    env: process.env,
    packaged: app.isPackaged,
    version,
    // From a source checkout, the dependencies live in the repository's node_modules, outside the app folder.
    roots: [app.getAppPath(), process.resourcesPath, ...(repoRoot ? [repoRoot] : [])],
    dataDir,
    userDataDir: userData,
  });
  const { logger } = telemetry;
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled rejection', { error: reason instanceof Error ? reason : String(reason) });
  });

  await app.whenReady();

  const client = createServerClient(port);
  const supervisor = new Supervisor({
    spawn: () =>
      spawnServerChild(
        resolveServerLaunch({
          packaged: app.isPackaged,
          appPath: app.getAppPath(),
          resourcesPath: process.resourcesPath,
          execPath: process.execPath,
          // The server reads the file the app opens for "Open config.env", wherever that is.
          env: { ...process.env, HOMESTREAM_ENV_FILE: envFile },
        }),
      ),
    probe: () => client.probe(),
    logger,
  });
  const assets = path.join(import.meta.dirname, 'assets');
  const shell = new Shell({
    version,
    port,
    flags,
    settings,
    supervisor,
    client,
    telemetry,
    paths: {
      assets,
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      loadingHtml: path.join(assets, 'loading.html'),
      dataDir,
      envFile,
      windowStateFile: path.join(userData, 'window-state.json'),
    },
  });

  app.on('second-instance', (_event, argv) => {
    if (parseCliFlags(argv).quit) void shell.quit();
    else shell.showMain();
  });
  // Closing every window must not end the app: it lives in the tray. Anything that asks the app to quit (Windows
  // shutting down, app.quit) goes through the same graceful path as the tray's Quit.
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', (event) => {
    if (shell.isQuitting) return;
    event.preventDefault();
    void shell.quit();
  });

  await shell.start();
  void telemetry.reportTestError();
  telemetry.analytics?.capture('desktop_started', {
    version,
    os: 'windows',
    packaged: app.isPackaged,
    hidden: flags.hidden,
  });
  logger.info('desktop shell started', { hidden: flags.hidden, packaged: app.isPackaged });
}

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  void run().catch((error: unknown) => {
    console.error('HomeStream could not start:', error instanceof Error ? error.message : error);
    app.exit(1);
  });
}
